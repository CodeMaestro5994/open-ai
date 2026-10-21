import { useState } from 'react'
import type { ProviderId, ProviderSettings, Settings } from '../types'
import type { ProviderInfo } from '../lib/providers'
import {
  PROVIDERS,
  describeError,
  isVerified,
  listModels,
  pickDefaultModel,
  testGeneration,
  textModels,
} from '../lib/providers'
import type { ApiKeys } from '../lib/workspace'

type Status = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; message: string } | { state: 'error'; message: string }

interface Props {
  keys: ApiKeys
  settings: Settings
  onSaveKey: (provider: ProviderId, key: string, remember: boolean) => void
  onSettings: (patch: Partial<Settings>) => void
  onClose?: () => void
}

export default function ApiKeyPanel({ keys, settings, onSaveKey, onSettings, onClose }: Props) {
  const verified = PROVIDERS.filter((p) => isVerified(settings.providers[p.id]))

  const setProvider = (id: ProviderId, patch: Partial<ProviderSettings>) =>
    onSettings({ providers: { ...settings.providers, [id]: { ...settings.providers[id], ...patch } } })

  return (
    <section className="key-panel">
      <div className="card-head">
        <div>
          <h2>API keys</h2>
          <p className="muted">
            Add an OpenAI key, a Claude key, or both — each tab chooses which one it uses. Keys are stored only in this
            browser and sent directly to the provider. They never touch any other server.
          </p>
        </div>
        {onClose && (
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      {PROVIDERS.map((p) => (
        <ProviderKeyCard
          key={p.id}
          info={p}
          apiKey={keys[p.id]}
          provider={settings.providers[p.id]}
          remember={settings.rememberKey}
          onSaveKey={(key, remember) => onSaveKey(p.id, key, remember)}
          onProvider={(patch) => setProvider(p.id, patch)}
          onRemember={(remember) => {
            for (const q of PROVIDERS) if (keys[q.id]) onSaveKey(q.id, keys[q.id], remember)
            onSettings({ rememberKey: remember })
          }}
          onVerified={() => {
            // First verified provider becomes the default for new tabs.
            if (!verified.length) onSettings({ defaultProvider: p.id })
          }}
        />
      ))}

      {verified.length > 1 && (
        <section className="card">
          <label className="field">
            <span>Default for new tabs</span>
            <select
              value={settings.defaultProvider}
              onChange={(e) => onSettings({ defaultProvider: e.target.value as ProviderId })}
            >
              {verified.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}
    </section>
  )
}

interface CardProps {
  info: ProviderInfo
  apiKey: string
  provider: ProviderSettings
  remember: boolean
  onSaveKey: (key: string, remember: boolean) => void
  onProvider: (patch: Partial<ProviderSettings>) => void
  onRemember: (remember: boolean) => void
  onVerified: () => void
}

function ProviderKeyCard({ info, apiKey, provider, remember, onSaveKey, onProvider, onRemember, onVerified }: CardProps) {
  const [draft, setDraft] = useState(apiKey)
  const [show, setShow] = useState(false)
  const [keyStatus, setKeyStatus] = useState<Status>(
    isVerified(provider) && apiKey ? { state: 'ok', message: `${provider.models.length} models available` } : { state: 'idle' },
  )
  const [genStatus, setGenStatus] = useState<Status>({ state: 'idle' })
  const [showAll, setShowAll] = useState(false)

  const usable = textModels(info.id, provider.models)

  async function runGenerationTest(key: string, model: string) {
    setGenStatus({ state: 'loading' })
    try {
      await testGeneration(info.id, key, model)
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
      const { ids, maxTokens } = await listModels(info.id, key)
      const text = textModels(info.id, ids)
      const model = text.includes(provider.defaultModel) ? provider.defaultModel : pickDefaultModel(info.id, ids)
      onSaveKey(key, remember)
      onProvider({ models: ids, maxTokens, defaultModel: model, verifiedAt: Date.now() })
      onVerified()
      setKeyStatus({ state: 'ok', message: `Key is valid — ${ids.length} models available (${text.length} text models).` })
      if (model) await runGenerationTest(key, model)
    } catch (err) {
      onProvider({ verifiedAt: undefined })
      setKeyStatus({ state: 'error', message: describeError(err) })
    }
  }

  function forget() {
    setDraft('')
    onSaveKey('', false)
    onProvider({ models: [], verifiedAt: undefined })
    setKeyStatus({ state: 'idle' })
    setGenStatus({ state: 'idle' })
  }

  return (
    <section className="card">
      <div className="pane-title">
        <h3>
          {info.label} API key {isVerified(provider) && <span className="pill ok-pill">Connected</span>}
        </h3>
        <a className="link" href={info.keysUrl} target="_blank" rel="noreferrer">
          Get a key
        </a>
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
            placeholder={info.keyPlaceholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={`${info.label} API key`}
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
          <input type="checkbox" checked={remember} onChange={(e) => onRemember(e.target.checked)} />
          Remember keys on this device
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
            <span>Default {info.label} model</span>
            <div className="key-row">
              <select value={provider.defaultModel} onChange={(e) => onProvider({ defaultModel: e.target.value })}>
                {usable.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <button
                className="btn"
                disabled={genStatus.state === 'loading'}
                onClick={() => runGenerationTest(apiKey, provider.defaultModel)}
              >
                Test model
              </button>
            </div>
          </label>

          <button className="link" onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Hide' : 'Show'} all {provider.models.length} models on this key
          </button>
          {showAll && (
            <ul className="chips">
              {provider.models.map((m) => (
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
