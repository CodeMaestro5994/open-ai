import { useState } from 'react'
import type { Settings } from '../types'
import { describeError, listModels, pickDefaultModel, testGeneration, textModels } from '../lib/openai'

type Status = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; message: string } | { state: 'error'; message: string }

interface Props {
  apiKey: string
  settings: Settings
  onSaveKey: (key: string, remember: boolean) => void
  onSettings: (patch: Partial<Settings>) => void
  onClose?: () => void
}

export default function ApiKeyPanel({ apiKey, settings, onSaveKey, onSettings, onClose }: Props) {
  const [draft, setDraft] = useState(apiKey)
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(settings.rememberKey)
  const [keyStatus, setKeyStatus] = useState<Status>(
    settings.keyVerifiedAt && apiKey ? { state: 'ok', message: `${settings.models.length} models available` } : { state: 'idle' },
  )
  const [genStatus, setGenStatus] = useState<Status>({ state: 'idle' })
  const [showAll, setShowAll] = useState(false)

  const models = settings.models
  const usable = textModels(models)

  async function runGenerationTest(key: string, model: string) {
    setGenStatus({ state: 'loading' })
    try {
      await testGeneration(key, model)
      setGenStatus({ state: 'ok', message: `${model} responded — this key can generate text.` })
    } catch (err) {
      setGenStatus({ state: 'error', message: `${model}: ${describeError(err)}` })
    }
  }

  async function testKey() {
    const key = draft.trim()
    if (!key) return
    setKeyStatus({ state: 'loading' })
    setGenStatus({ state: 'idle' })
    try {
      const ids = await listModels(key)
      const text = textModels(ids)
      const model = text.includes(settings.defaultModel) ? settings.defaultModel : pickDefaultModel(ids)
      onSaveKey(key, remember)
      onSettings({ models: ids, defaultModel: model, rememberKey: remember, keyVerifiedAt: Date.now() })
      setKeyStatus({ state: 'ok', message: `Key is valid — ${ids.length} models available (${text.length} text models).` })
      if (model) await runGenerationTest(key, model)
    } catch (err) {
      onSettings({ keyVerifiedAt: undefined })
      setKeyStatus({ state: 'error', message: describeError(err) })
    }
  }

  function forget() {
    setDraft('')
    onSaveKey('', false)
    onSettings({ models: [], keyVerifiedAt: undefined })
    setKeyStatus({ state: 'idle' })
    setGenStatus({ state: 'idle' })
  }

  return (
    <section className="card key-panel">
      <div className="card-head">
        <div>
          <h2>OpenAI API key</h2>
          <p className="muted">
            Your key is stored only in this browser and sent directly to <code>api.openai.com</code>. It never touches any
            other server.
          </p>
        </div>
        {onClose && (
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      <form
        className="key-row"
        onSubmit={(e) => {
          e.preventDefault()
          testKey()
        }}
      >
        <div className="input-with-action">
          <input
            type={show ? 'text' : 'password'}
            placeholder="sk-..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="OpenAI API key"
          />
          <button type="button" className="btn ghost small" onClick={() => setShow((s) => !s)}>
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        <button type="submit" className="btn primary" disabled={!draft.trim() || keyStatus.state === 'loading'}>
          {keyStatus.state === 'loading' ? 'Testing…' : 'Test key'}
        </button>
      </form>

      <div className="key-options">
        <label className="check">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => {
              setRemember(e.target.checked)
              if (apiKey) onSaveKey(apiKey, e.target.checked)
              onSettings({ rememberKey: e.target.checked })
            }}
          />
          Remember on this device
        </label>
        {apiKey && (
          <button className="link danger" onClick={forget}>
            Forget key
          </button>
        )}
      </div>

      <StatusLine status={keyStatus} />
      <StatusLine status={genStatus} />

      {usable.length > 0 && (
        <div className="models">
          <label className="field">
            <span>Default model</span>
            <div className="key-row">
              <select value={settings.defaultModel} onChange={(e) => onSettings({ defaultModel: e.target.value })}>
                {usable.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <button
                className="btn"
                disabled={genStatus.state === 'loading'}
                onClick={() => runGenerationTest(apiKey, settings.defaultModel)}
              >
                Test model
              </button>
            </div>
          </label>

          <button className="link" onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Hide' : 'Show'} all {models.length} models on this key
          </button>
          {showAll && (
            <ul className="chips">
              {models.map((m) => (
                <li key={m} className={usable.includes(m) ? 'chip on' : 'chip'}>
                  {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function StatusLine({ status }: { status: Status }) {
  if (status.state === 'idle') return null
  if (status.state === 'loading') return <p className="status loading">Checking…</p>
  return <p className={`status ${status.state}`}>{status.message}</p>
}
