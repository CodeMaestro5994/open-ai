import { useRef, useState } from 'react'
import type { Attachment, PromptTab, ProviderId, Settings, TabTools } from '../types'
import {
  PROVIDERS,
  deleteFile,
  describeError,
  generateTabMeta,
  isVerified,
  providerInfo,
  tabProvider,
  textModels,
  uploadFile,
} from '../lib/providers'
import { ACCEPT, createAttachment, foreignAttachments, formatSize } from '../lib/attachments'
import type { ApiKeys } from '../lib/workspace'
import { timestamp, uid } from '../lib/storage'
import { TEMPLATES } from '../lib/templates'

interface Props {
  keys: ApiKeys
  settings: Settings
  tab?: PromptTab
  onSave: (tab: PromptTab) => void
  onCancel: () => void
}

interface Pending {
  id: string
  name: string
  error?: string
}

export default function TabEditor({ keys, settings, tab, onSave, onCancel }: Props) {
  const [instructions, setInstructions] = useState(tab?.instructions ?? '')
  const [name, setName] = useState(tab?.name ?? '')
  const [description, setDescription] = useState(tab?.description ?? '')
  const [inputLabel, setInputLabel] = useState(tab?.inputLabel ?? '')
  const [inputPlaceholder, setInputPlaceholder] = useState(tab?.inputPlaceholder ?? '')
  const [provider, setProvider] = useState<ProviderId>(tab ? tabProvider(tab) : settings.defaultProvider)
  const [model, setModel] = useState(tab?.model ?? '')
  const [attachments, setAttachments] = useState<Attachment[]>(tab?.attachments ?? [])
  const [tools, setTools] = useState<TabTools>(tab?.tools ?? { files: !tab, images: false })
  const [pending, setPending] = useState<Pending[]>([])
  const [busy, setBusy] = useState<'' | 'suggest' | 'save'>('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const apiKey = keys[provider]
  const info = providerInfo(provider)
  const providerModels = settings.providers[provider]
  const effectiveModel = model || providerModels.defaultModel
  const uploading = pending.some((p) => !p.error)
  const originalFileIds = new Set((tab?.attachments ?? []).map((a) => a.fileId).filter(Boolean))
  // Uploaded files belong to one provider; switching the tab's provider means re-adding them.
  const foreign = foreignAttachments({ attachments, provider })
  const providerChoices = PROVIDERS.filter((p) => p.id === provider || isVerified(settings.providers[p.id]))

  /** Deletes an uploaded attachment from whichever provider holds it. */
  const discard = (a: Attachment) => {
    const owner = a.provider ?? 'openai'
    if (a.fileId) deleteFile(owner, keys[owner], a.fileId)
  }

  async function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const p: Pending = { id: uid(), name: file.name }
      setPending((list) => [...list, p])
      try {
        const att = await createAttachment(file, provider, (f, kind) => uploadFile(provider, apiKey, f, kind))
        setAttachments((list) => [...list, att])
        setPending((list) => list.filter((x) => x.id !== p.id))
      } catch (err) {
        setPending((list) => list.map((x) => (x.id === p.id ? { ...x, error: describeError(err) } : x)))
      }
    }
  }

  function removeAttachment(att: Attachment) {
    setAttachments((list) => list.filter((a) => a.id !== att.id))
    // Files uploaded during this edit can be deleted right away; originals are deleted on save.
    if (att.fileId && !originalFileIds.has(att.fileId)) discard(att)
  }

  function cancel() {
    for (const a of attachments) if (a.fileId && !originalFileIds.has(a.fileId)) discard(a)
    onCancel()
  }

  async function suggest() {
    setBusy('suggest')
    setError('')
    try {
      const meta = await generateTabMeta(provider, apiKey, effectiveModel, instructions)
      setName(meta.name)
      setDescription(meta.description)
      setInputLabel(meta.inputLabel)
      setInputPlaceholder(meta.inputPlaceholder)
    } catch (err) {
      setError(`Could not generate tab details: ${describeError(err)}`)
    } finally {
      setBusy('')
    }
  }

  async function save() {
    if (foreign.length) {
      setError(`Remove and re-add ${foreign.map((a) => a.name).join(', ')} — they were uploaded for another provider.`)
      return
    }
    setBusy('save')
    setError('')
    let meta = { name, description, inputLabel, inputPlaceholder }
    if (!name.trim()) {
      try {
        meta = await generateTabMeta(provider, apiKey, effectiveModel, instructions)
      } catch (err) {
        setBusy('')
        setError(`Could not name the tab automatically (${describeError(err)}). Enter a name below.`)
        return
      }
    }
    const kept = new Set(attachments.map((a) => a.fileId))
    for (const a of tab?.attachments ?? []) if (a.fileId && !kept.has(a.fileId)) discard(a)

    onSave({
      id: tab?.id ?? uid(),
      createdAt: tab?.createdAt ?? timestamp(),
      runs: tab?.runs ?? [],
      instructions: instructions.trim(),
      provider,
      model,
      attachments,
      tools: { files: tools.files && info.files, images: tools.images && info.images },
      name: meta.name.trim(),
      description: meta.description.trim(),
      inputLabel: meta.inputLabel.trim() || 'Input',
      inputPlaceholder: meta.inputPlaceholder.trim(),
    })
  }

  return (
    <section className="card editor">
      <div className="card-head">
        <div>
          <h2>{tab ? `Edit “${tab.name}”` : 'New tab'}</h2>
          <p className="muted">
            Write the rules the AI must follow. Every time you type into this tab, your text is processed with this prompt
            and the attached files.
          </p>
        </div>
      </div>

      {!tab && !instructions && (
        <div className="templates">
          <span className="muted small">Start from an example:</span>
          {TEMPLATES.map((t) => (
            <button key={t.title} className="template" onClick={() => setInstructions(t.instructions)}>
              <strong>{t.title}</strong>
              <span>{t.summary}</span>
            </button>
          ))}
        </div>
      )}

      {providerChoices.length > 1 && (
        <div className="field">
          <span>AI provider</span>
          <div className="segmented" role="radiogroup" aria-label="AI provider">
            {providerChoices.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={provider === p.id}
                className={provider === p.id ? 'on' : ''}
                onClick={() => {
                  setProvider(p.id)
                  setModel('')
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="field">
        <span>Prompt</span>
        <textarea
          className="prompt"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. You are an English editor. Rewrite whatever I send so it sounds like a native speaker wrote it…"
          rows={10}
        />
      </label>

      <div className="field">
        <span>Attachments</span>
        <div
          className={`dropzone ${dragging ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            addFiles(e.dataTransfer.files)
          }}
          onClick={() => fileInput.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current?.click()}
        >
          <strong>Drop files here or click to browse</strong>
          <span className="muted small">
            Your résumé, portfolio, past bids, style guides… Text files are added to the prompt;{' '}
            {provider === 'openai'
              ? 'PDFs, documents and images are uploaded to your OpenAI account.'
              : 'PDFs and images are kept in this browser and sent to Claude with each request.'}
          </span>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        {(attachments.length > 0 || pending.length > 0) && (
          <ul className="files">
            {attachments.map((a) => (
              <li key={a.id} className={foreign.includes(a) ? 'error' : ''}>
                <span className={`badge ${a.kind}`}>{a.kind === 'text' ? 'TEXT' : a.kind === 'image' ? 'IMG' : 'FILE'}</span>
                <span className="file-name">{a.name}</span>
                {foreign.includes(a) ? (
                  <span className="small">Uploaded for {providerInfo(a.provider ?? 'openai').label} — remove and re-add</span>
                ) : (
                  <span className="muted small">{formatSize(a.size)}</span>
                )}
                <button className="link danger" onClick={() => removeAttachment(a)}>
                  Remove
                </button>
              </li>
            ))}
            {pending.map((p) => (
              <li key={p.id} className={p.error ? 'error' : ''}>
                <span className="badge">{p.error ? 'ERR' : '…'}</span>
                <span className="file-name">{p.name}</span>
                <span className="small">{p.error ?? 'Uploading…'}</span>
                {p.error && (
                  <button className="link" onClick={() => setPending((l) => l.filter((x) => x.id !== p.id))}>
                    Dismiss
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="field">
        <span>Output</span>
        <label className={`check option ${info.files ? '' : 'disabled'}`}>
          <input
            type="checkbox"
            checked={tools.files && info.files}
            disabled={!info.files}
            onChange={(e) => setTools((t) => ({ ...t, files: e.target.checked }))}
          />
          <span>
            <strong>Create downloadable files</strong>
            <span className="muted small">
              {info.files
                ? 'The AI can generate any file — PDF, Word, Excel, PowerPoint, CSV, charts, ZIP — with Code Interpreter, and read attached Word/Excel files. Adds a small per-session fee on your OpenAI account.'
                : info.filesNote}
            </span>
          </span>
        </label>
        <label className={`check option ${info.images ? '' : 'disabled'}`}>
          <input
            type="checkbox"
            checked={tools.images && info.images}
            disabled={!info.images}
            onChange={(e) => setTools((t) => ({ ...t, images: e.target.checked }))}
          />
          <span>
            <strong>Generate images</strong>
            <span className="muted small">
              {info.images
                ? 'Uses OpenAI image generation (billed separately; may require a verified organization).'
                : 'Not available for Claude — it reads images but does not generate them.'}
            </span>
          </span>
        </label>
      </div>

      <details className="details" open={!!tab}>
        <summary>
          Tab details <span className="muted small">— leave the name empty to generate everything from the prompt</span>
        </summary>
        <div className="grid">
          <label className="field">
            <span>Tab name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto-generated" />
          </label>
          <label className="field">
            <span>Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Default ({providerModels.defaultModel || 'none'})</option>
              {textModels(provider, providerModels.models).map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="field wide">
            <span>Description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="field">
            <span>Input label</span>
            <input value={inputLabel} onChange={(e) => setInputLabel(e.target.value)} placeholder="Input" />
          </label>
          <label className="field">
            <span>Input placeholder</span>
            <input value={inputPlaceholder} onChange={(e) => setInputPlaceholder(e.target.value)} />
          </label>
        </div>
        <button className="btn small" onClick={suggest} disabled={!instructions.trim() || !!busy}>
          {busy === 'suggest' ? 'Generating…' : 'Generate details from prompt'}
        </button>
      </details>

      {error && <p className="status error">{error}</p>}

      <div className="actions">
        <button className="btn ghost" onClick={cancel} disabled={busy === 'save'}>
          Cancel
        </button>
        <button className="btn primary" onClick={save} disabled={!instructions.trim() || uploading || !!busy}>
          {busy === 'save' ? (name.trim() ? 'Saving…' : 'Creating tab…') : tab ? 'Save changes' : 'Create tab'}
        </button>
      </div>
    </section>
  )
}
