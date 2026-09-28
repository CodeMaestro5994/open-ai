import { useEffect, useRef, useState } from 'react'
import type { GeneratedFile, PromptTab, Run } from '../types'
import type { StreamedFile } from '../lib/openai'
import { describeError, downloadContainerFile, listContainerFiles, streamResponse } from '../lib/openai'
import { buildContent, buildInstructions, buildTools, formatSize } from '../lib/attachments'
import { uid } from '../lib/storage'

interface Props {
  apiKey: string
  defaultModel: string
  tab: PromptTab
  onAddRun: (tabId: string, run: Run) => void
  onClearRuns: (tabId: string) => void
  onEdit: () => void
  onDelete: () => void
}

/** A generated file plus its in-memory download state. */
interface LiveFile extends GeneratedFile {
  status: 'idle' | 'loading' | 'ready' | 'error'
  url?: string
  size?: number
  mime?: string
  error?: string
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

function saveUrl(url: string, name: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
}

export default function TabRunner({ apiKey, defaultModel, tab, onAddRun, onClearRuns, onEdit, onDelete }: Props) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState('')
  const [files, setFiles] = useState<LiveFile[]>([])
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const urls = useRef<string[]>([])

  const model = tab.model || defaultModel

  // On leaving the tab: stop generation and free downloaded file blobs.
  useEffect(
    () => () => {
      abort.current?.abort()
      urls.current.forEach(URL.revokeObjectURL)
    },
    [],
  )

  const patchFile = (id: string, patch: Partial<LiveFile>) =>
    setFiles((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  async function fetchFile(file: LiveFile | StreamedFile) {
    patchFile(file.id, { status: 'loading', error: undefined })
    try {
      let blob: Blob
      if ('base64' in file && file.base64) blob = base64ToBlob(file.base64, file.mime ?? 'image/png')
      else if (file.containerId && file.fileId) blob = await downloadContainerFile(apiKey, file.containerId, file.fileId)
      else throw new Error('Generated images are kept only until the page is closed.')
      const url = URL.createObjectURL(blob)
      urls.current.push(url)
      patchFile(file.id, { status: 'ready', url, size: blob.size, mime: blob.type })
    } catch (err) {
      const msg = describeError(err)
      patchFile(file.id, {
        status: 'error',
        error:
          file.source === 'container' && /404|expired|not found/i.test(msg)
            ? 'File expired — OpenAI deletes generated files after ~20 minutes of inactivity.'
            : msg,
      })
    }
  }

  async function run() {
    const text = input.trim()
    if (!text || running) return
    if (!apiKey || !model) {
      setError('Add and test your API key first.')
      return
    }
    const controller = new AbortController()
    abort.current = controller
    setRunning(true)
    setOutput('')
    setFiles([])
    setError('')
    setStatus('')
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
            setOutput((o) => o + delta)
          },
          onStatus: setStatus,
        },
        controller.signal,
      )
      produced = res.files
      // Files the model saved without citing them in its reply.
      if (res.containerIds.length) {
        setStatus('Collecting files…')
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
      if ((err as Error).name !== 'AbortError') {
        failure = describeError(err)
        setError(failure)
      }
    } finally {
      setRunning(false)
      setStatus('')
      abort.current = null
    }

    if (produced.length) {
      setFiles(produced.map((f) => ({ ...toMeta(f), status: 'loading' })))
      // Download right away — container files expire after ~20 minutes idle.
      produced.forEach(fetchFile)
    }
    if (result || failure || produced.length) {
      onAddRun(tab.id, {
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

  async function copy() {
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked
    }
  }

  function saveText() {
    const url = URL.createObjectURL(new Blob([output], { type: 'text/markdown' }))
    saveUrl(url, `${tab.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'output'}.md`)
    URL.revokeObjectURL(url)
  }

  function restore(r: Run) {
    setInput(r.input)
    setOutput(r.output)
    setError(r.error ?? '')
    setFiles(
      (r.files ?? []).map((f) =>
        f.source === 'image'
          ? { ...f, status: 'error', error: 'Generated images are kept only until the page is closed.' }
          : { ...f, status: 'idle' },
      ),
    )
  }

  const fileCount = tab.attachments.length

  return (
    <div className="runner">
      <header className="runner-head">
        <div>
          <h2>{tab.name}</h2>
          {tab.description && <p className="muted">{tab.description}</p>}
          <p className="meta">
            <span className="pill">{model || 'no model'}</span>
            {tab.tools?.files && <span className="pill">Creates files</span>}
            {tab.tools?.images && <span className="pill">Generates images</span>}
            {fileCount > 0 && (
              <span className="pill" title={tab.attachments.map((a) => a.name).join('\n')}>
                {fileCount} attachment{fileCount > 1 ? 's' : ''}
              </span>
            )}
          </p>
        </div>
        <div className="row">
          <button className="btn small" onClick={onEdit}>
            Edit prompt
          </button>
          <button
            className="btn small ghost danger"
            onClick={() => confirm(`Delete the “${tab.name}” tab?`) && onDelete()}
          >
            Delete
          </button>
        </div>
      </header>

      <div className="io">
        <section className="card pane">
          <label className="field">
            <span>{tab.inputLabel || 'Input'}</span>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={tab.inputPlaceholder}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  run()
                }
              }}
            />
          </label>
          <div className="actions">
            <span className="muted small">Ctrl + Enter</span>
            {running ? (
              <button className="btn" onClick={() => abort.current?.abort()}>
                Stop
              </button>
            ) : (
              <button className="btn primary" onClick={run} disabled={!input.trim()}>
                Generate
              </button>
            )}
          </div>
        </section>

        <section className="card pane">
          <div className="field">
            <div className="pane-title">
              <span>Output</span>
              {output && !running && (
                <span className="row">
                  <button className="link" onClick={copy}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button className="link" onClick={saveText}>
                    Save .md
                  </button>
                </span>
              )}
            </div>
            <div className={`output ${running ? 'streaming' : ''}`} aria-live="polite">
              {output ||
                (!error && !files.length && (
                  <span className="muted">{running ? status || 'Thinking…' : 'The result will appear here.'}</span>
                ))}
            </div>
            {running && status && output && <p className="muted small">{status}</p>}

            {files.length > 0 && (
              <ul className="gen-files">
                {files.map((f) => (
                  <li key={f.id}>
                    {f.url && f.mime?.startsWith('image/') && <img src={f.url} alt={f.name} />}
                    <div className="gen-row">
                      <span className="file-name" title={f.name}>
                        {f.name}
                      </span>
                      {f.size != null && <span className="muted small">{formatSize(f.size)}</span>}
                      {f.status === 'ready' && (
                        <button className="btn primary small" onClick={() => saveUrl(f.url!, f.name)}>
                          Download
                        </button>
                      )}
                      {f.status === 'loading' && <span className="muted small">Preparing…</span>}
                      {(f.status === 'idle' || f.status === 'error') && (
                        <button className="btn small" onClick={() => fetchFile(f)}>
                          {f.status === 'error' ? 'Retry' : 'Fetch'}
                        </button>
                      )}
                    </div>
                    {f.error && <p className="small error-text">{f.error}</p>}
                  </li>
                ))}
              </ul>
            )}
            {error && <p className="status error">{error}</p>}
          </div>
        </section>
      </div>

      {tab.runs.length > 0 && (
        <section className="history">
          <div className="pane-title">
            <h3>History</h3>
            <button className="link danger" onClick={() => onClearRuns(tab.id)}>
              Clear
            </button>
          </div>
          <ul>
            {tab.runs.map((r) => (
              <li key={r.id}>
                <button onClick={() => restore(r)}>
                  <span className="h-input">{r.input}</span>
                  <span className={r.error ? 'h-output error' : 'h-output'}>
                    {r.error ?? (r.output || r.files?.map((f) => f.name).join(', '))}
                  </span>
                  <span className="muted small">
                    {new Date(r.at).toLocaleString()} · {r.model}
                    {r.files?.length ? ` · ${r.files.length} file${r.files.length > 1 ? 's' : ''}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
