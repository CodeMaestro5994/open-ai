import { useSyncExternalStore } from 'react'
import type { GeneratedFile, PromptTab, Run } from '../types'
import type { StreamedFile } from './openai'
import { describeError, downloadContainerFile, listContainerFiles, streamResponse } from './openai'
import { buildContent, buildInstructions, buildTools } from './attachments'
import { uid } from './storage'

// Per-tab working state (input draft, streaming output, generated files) lives
// here rather than in the TabRunner component, so a generation keeps running
// when the user switches to another tab — several tabs can run at once.

/** A generated file plus its in-memory download state. */
export interface LiveFile extends GeneratedFile {
  status: 'idle' | 'loading' | 'ready' | 'error'
  url?: string
  size?: number
  mime?: string
  error?: string
}

export interface Workspace {
  input: string
  output: string
  status: string
  files: LiveFile[]
  error: string
  running: boolean
  /** Finished while the user was looking at another tab. */
  unseen: boolean
}

const EMPTY: Workspace = { input: '', output: '', status: '', files: [], error: '', running: false, unseen: false }

let state: Record<string, Workspace> = {}
const controllers = new Map<string, AbortController>()
const blobUrls = new Map<string, string[]>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function patch(tabId: string, update: Partial<Workspace> | ((ws: Workspace) => Partial<Workspace>)) {
  const current = state[tabId] ?? EMPTY
  const next = typeof update === 'function' ? update(current) : update
  state = { ...state, [tabId]: { ...current, ...next } }
  listeners.forEach((l) => l())
}

function patchFile(tabId: string, fileId: string, update: Partial<LiveFile>) {
  patch(tabId, (ws) => ({ files: ws.files.map((f) => (f.id === fileId ? { ...f, ...update } : f)) }))
}

function revokeUrls(tabId: string) {
  blobUrls.get(tabId)?.forEach(URL.revokeObjectURL)
  blobUrls.delete(tabId)
}

export function useWorkspace(tabId: string): Workspace {
  return useSyncExternalStore(subscribe, () => state[tabId] ?? EMPTY)
}

export function useAllWorkspaces(): Record<string, Workspace> {
  return useSyncExternalStore(subscribe, () => state)
}

export const setInput = (tabId: string, input: string) => patch(tabId, { input })

export function markSeen(tabId: string) {
  if (state[tabId]?.unseen) patch(tabId, { unseen: false })
}

export function stopTab(tabId: string) {
  controllers.get(tabId)?.abort()
}

/** Stops any work and frees memory for a deleted tab. */
export function disposeTab(tabId: string) {
  stopTab(tabId)
  revokeUrls(tabId)
  const rest = { ...state }
  delete rest[tabId]
  state = rest
  listeners.forEach((l) => l())
}

const toMeta = ({ id, name, source, containerId, fileId }: StreamedFile | LiveFile): GeneratedFile => ({
  id,
  name,
  source,
  containerId,
  fileId,
})

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

const IMAGE_GONE = 'Generated images are kept only until the page is closed.'

export async function fetchFile(apiKey: string, tabId: string, file: LiveFile | StreamedFile) {
  patchFile(tabId, file.id, { status: 'loading', error: undefined })
  try {
    let blob: Blob
    if ('base64' in file && file.base64) blob = base64ToBlob(file.base64, file.mime ?? 'image/png')
    else if (file.containerId && file.fileId) blob = await downloadContainerFile(apiKey, file.containerId, file.fileId)
    else throw new Error(IMAGE_GONE)
    const url = URL.createObjectURL(blob)
    blobUrls.set(tabId, [...(blobUrls.get(tabId) ?? []), url])
    patchFile(tabId, file.id, { status: 'ready', url, size: blob.size, mime: blob.type })
  } catch (err) {
    const msg = describeError(err)
    patchFile(tabId, file.id, {
      status: 'error',
      error:
        file.source === 'container' && /404|expired|not found/i.test(msg)
          ? 'File expired — OpenAI deletes generated files after ~20 minutes of inactivity.'
          : msg,
    })
  }
}

interface RunOptions {
  apiKey: string
  tab: PromptTab
  model: string
  /** Is the user currently looking at this tab? Used to flag unseen results. */
  isActive: () => boolean
  onAddRun: (tabId: string, run: Run) => void
}

export async function runTab({ apiKey, tab, model, isActive, onAddRun }: RunOptions) {
  const tabId = tab.id
  const text = (state[tabId]?.input ?? '').trim()
  if (!text || state[tabId]?.running) return
  if (!apiKey || !model) {
    patch(tabId, { error: 'Add and test your API key first.' })
    return
  }

  const controller = new AbortController()
  controllers.set(tabId, controller)
  revokeUrls(tabId)
  patch(tabId, { running: true, output: '', files: [], error: '', status: '', unseen: false })

  let result = ''
  let produced: StreamedFile[] = []
  let failure = ''
  try {
    const res = await streamResponse(
      apiKey,
      { model, instructions: buildInstructions(tab), content: buildContent(tab, text), tools: buildTools(tab) },
      {
        onDelta: (delta) => {
          result += delta
          patch(tabId, (ws) => ({ output: ws.output + delta }))
        },
        onStatus: (status) => patch(tabId, { status }),
      },
      controller.signal,
    )
    produced = res.files
    // Files the model saved without citing them in its reply.
    if (res.containerIds.length) {
      patch(tabId, { status: 'Collecting files…' })
      for (const cid of res.containerIds) {
        try {
          for (const f of await listContainerFiles(apiKey, cid)) {
            if (!produced.some((p) => p.fileId === f.fileId)) produced.push(f)
          }
        } catch {
          // listing is best effort; cited files are still available
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') failure = describeError(err)
  } finally {
    controllers.delete(tabId)
  }

  // The tab may have been deleted while this was running.
  if (!(tabId in state)) return

  patch(tabId, {
    running: false,
    status: '',
    error: failure,
    unseen: !isActive(),
    files: produced.map((f) => ({ ...toMeta(f), status: 'loading' })),
  })
  // Download right away — container files expire after ~20 minutes idle.
  produced.forEach((f) => fetchFile(apiKey, tabId, f))

  if (result || failure || produced.length) {
    onAddRun(tabId, {
      id: uid(),
      input: text,
      output: result,
      model,
      at: Date.now(),
      error: failure || undefined,
      files: produced.length ? produced.map(toMeta) : undefined,
    })
  }
}

export function restoreRun(tabId: string, run: Run) {
  if (state[tabId]?.running) return
  patch(tabId, {
    input: run.input,
    output: run.output,
    error: run.error ?? '',
    files: (run.files ?? []).map((f) =>
      f.source === 'image' ? { ...f, status: 'error', error: IMAGE_GONE } : { ...f, status: 'idle' },
    ),
  })
}

export const anyRunning = () => Object.values(state).some((ws) => ws.running)
