import { useEffect, useRef, useState } from 'react'
import type { PromptTab, Run } from '../types'
import { describeError, streamResponse } from '../lib/openai'
import { buildContent, buildInstructions } from '../lib/attachments'
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

export default function TabRunner({ apiKey, defaultModel, tab, onAddRun, onClearRuns, onEdit, onDelete }: Props) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const model = tab.model || defaultModel

  // Stop any in-flight generation when leaving the tab.
  useEffect(() => () => abort.current?.abort(), [])

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
    setError('')
    let result = ''
    let failure = ''
    try {
      await streamResponse(
        apiKey,
        { model, instructions: buildInstructions(tab), content: buildContent(tab, text) },
        (delta) => {
          result += delta
          setOutput((o) => o + delta)
        },
        controller.signal,
      )
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        failure = describeError(err)
        setError(failure)
      }
    } finally {
      setRunning(false)
      abort.current = null
    }
    if (result || failure) {
      onAddRun(tab.id, { id: uid(), input: text, output: result, model, at: Date.now(), error: failure || undefined })
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

  function restore(r: Run) {
    setInput(r.input)
    setOutput(r.output)
    setError(r.error ?? '')
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
                <button className="link" onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
            <div className={`output ${running ? 'streaming' : ''}`} aria-live="polite">
              {output || (!error && <span className="muted">{running ? 'Thinking…' : 'The result will appear here.'}</span>)}
            </div>
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
                  <span className={r.error ? 'h-output error' : 'h-output'}>{r.error ?? r.output}</span>
                  <span className="muted small">
                    {new Date(r.at).toLocaleString()} · {r.model}
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
