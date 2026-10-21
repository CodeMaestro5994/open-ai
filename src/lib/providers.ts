import type { GeneratedFile, PromptTab, ProviderId, ProviderSettings, Settings } from '../types'
import type { StreamedFile, StreamHandlers, StreamResult, TabMeta } from './openai'
import * as openai from './openai'
import { buildContent, buildInstructions, buildTools } from './attachments'
import { deleteBlob, putBlob } from './blobs'
import { uid } from './storage'

// The Claude module pulls in the Anthropic SDK, so it is loaded only when first used.
const claude = () => import('./anthropic')

// One interface over OpenAI (raw REST) and Claude (Anthropic SDK), so the UI and
// the background runner do not care which service a tab uses.

export interface ProviderInfo {
  id: ProviderId
  label: string
  keyPlaceholder: string
  keysUrl: string
  host: string
  /** Can generate images directly (separate from creating files with code). */
  images: boolean
  /** Can create downloadable files by running code. */
  files: boolean
  /** Why file creation is unavailable, shown in the tab editor. */
  filesNote?: string
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    keyPlaceholder: 'sk-...',
    keysUrl: 'https://platform.openai.com/api-keys',
    host: 'api.openai.com',
    images: true,
    files: true,
  },
  {
    id: 'anthropic',
    label: 'Claude',
    keyPlaceholder: 'sk-ant-...',
    keysUrl: 'https://platform.claude.com/settings/keys',
    host: 'api.anthropic.com',
    images: false,
    // Anthropic's Files API rejects browser (CORS) requests, so files Claude creates
    // could not be downloaded without a server in between.
    files: false,
    filesNote:
      'Not available for Claude in this app: Anthropic does not allow downloading generated files directly from a browser.',
  },
]

export const providerInfo = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!

/** Tabs saved before Claude support have no provider and use OpenAI. */
export const tabProvider = (tab: Pick<PromptTab, 'provider'>): ProviderId => tab.provider ?? 'openai'

export const isVerified = (p: ProviderSettings | undefined) => !!p?.verifiedAt

export function modelFor(tab: PromptTab, settings: Settings): string {
  return tab.model || settings.providers[tabProvider(tab)].defaultModel
}

/** Models the app can use for text generation. */
export function textModels(provider: ProviderId, ids: string[]): string[] {
  return provider === 'openai' ? openai.textModels(ids) : ids.filter((id) => id.startsWith('claude-'))
}

export interface ModelList {
  ids: string[]
  maxTokens?: Record<string, number>
}

export async function listModels(provider: ProviderId, apiKey: string): Promise<ModelList> {
  return provider === 'openai' ? { ids: await openai.listModels(apiKey) } : (await claude()).listModels(apiKey)
}

const CLAUDE_PREFERRED = ['claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']

export function pickDefaultModel(provider: ProviderId, ids: string[]): string {
  if (provider === 'openai') return openai.pickDefaultModel(ids)
  return CLAUDE_PREFERRED.find((m) => ids.includes(m)) ?? ids[0] ?? ''
}

export async function testGeneration(provider: ProviderId, apiKey: string, model: string): Promise<void> {
  return provider === 'openai' ? openai.testGeneration(apiKey, model) : (await claude()).testGeneration(apiKey, model)
}

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

/**
 * OpenAI: uploads to the Files API and returns its id.
 * Claude: keeps the file in this browser (IndexedDB) and returns a local id; it is sent inline with each request.
 */
export async function uploadFile(provider: ProviderId, apiKey: string, file: File, kind: 'file' | 'image'): Promise<string> {
  if (provider === 'openai') return openai.uploadFile(apiKey, file, kind === 'image' ? 'vision' : 'user_data')
  if (kind === 'file' && !isPdf(file)) {
    throw new Error(`${file.name}: Claude accepts PDFs, images and text files here. Save Word/Excel files as PDF first.`)
  }
  const id = `local_${uid()}`
  await putBlob(id, file)
  return id
}

export async function deleteFile(provider: ProviderId, apiKey: string, fileId: string): Promise<void> {
  return provider === 'openai' ? openai.deleteFile(apiKey, fileId) : deleteBlob(fileId)
}

export async function generateTabMeta(
  provider: ProviderId,
  apiKey: string,
  model: string,
  instructions: string,
): Promise<TabMeta> {
  return provider === 'openai'
    ? openai.generateTabMeta(apiKey, model, instructions)
    : (await claude()).generateTabMeta(apiKey, model, instructions)
}

export async function streamResponse(
  tab: PromptTab,
  apiKey: string,
  model: string,
  settings: ProviderSettings,
  userText: string,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<StreamResult> {
  if (tabProvider(tab) === 'anthropic') {
    return (await claude()).streamResponse(apiKey, tab, model, settings.maxTokens?.[model], userText, handlers, signal)
  }
  const res = await openai.streamResponse(
    apiKey,
    { model, instructions: buildInstructions(tab), content: buildContent(tab, userText), tools: buildTools(tab) },
    handlers,
    signal,
  )
  // Files the model saved without citing them in its reply.
  if (res.containerIds.length) {
    handlers.onStatus?.('Collecting files…')
    for (const cid of res.containerIds) {
      try {
        for (const f of await openai.listContainerFiles(apiKey, cid)) {
          if (!res.files.some((p) => p.fileId === f.fileId)) res.files.push(f)
        }
      } catch {
        // listing is best effort; cited files are still available
      }
    }
  }
  return res
}

export async function downloadGenerated(apiKey: string, file: GeneratedFile | StreamedFile): Promise<Blob> {
  if (file.source === 'container' && file.containerId && file.fileId) {
    return openai.downloadContainerFile(apiKey, file.containerId, file.fileId)
  }
  throw new Error('Generated images are kept only until the page is closed.')
}

// The Claude module already turns SDK errors into plain, readable Errors.
export const describeError = openai.describeError

export const isAbort = (err: unknown) => (err as Error)?.name === 'AbortError'
