import { useEffect, useState } from 'react'
import type { PromptTab, Run, Settings } from '../types'
import { formatSize } from '../lib/attachments'
import { modelFor, providerInfo, tabProvider } from '../lib/providers'
import type { ApiKeys } from '../lib/workspace'
import { fetchFile, markSeen, restoreRun, runTab, setInput, stopTab, useWorkspace } from '../lib/workspace'

interface Props {
  keys: ApiKeys
  settings: Settings
  tab: PromptTab
  isActive: () => boolean
  onAddRun: (tabId: string, run: Run) => void
  onClearRuns: (tabId: string) => void
  onEdit: () => void
  onDelete: () => void
}

function saveUrl(url: string, name: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
}

export default function TabRunner({ keys, settings, tab, isActive, onAddRun, onClearRuns, onEdit, onDelete }: Props) {
  // Working state lives in the workspace store, so leaving this tab does not stop a running generation.
  const { input, output, status, files, error, running, unseen } = useWorkspace(tab.id)
  const [copied, setCopied] = useState(false)

  const provider = tabProvider(tab)
  const model = modelFor(tab, settings)

  useEffect(() => {
    if (unseen) markSeen(tab.id)
  }, [tab.id, unseen])

  const run = () => runTab({ keys, settings, tab, isActive, onAddRun })

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

  const fileCount = tab.attachments.length

  return (
    <div className="runner">
      <header className="runner-head">
        <div>
          <h2>{tab.name}</h2>
          {tab.description && <p className="muted">{tab.description}</p>}
          <p className="meta">
            <span className="pill">
              {providerInfo(provider).label} · {model || 'no model'}
            </span>
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
              onChange={(e) => setInput(tab.id, e.target.value)}
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
              <button className="btn" onClick={() => stopTab(tab.id)}>
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
                        <button className="btn small" onClick={() => fetchFile(keys, tab.id, f, f.provider ?? provider)}>
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
                <button onClick={() => restoreRun(tab.id, r)} disabled={running}>
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
