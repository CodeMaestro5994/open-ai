import { useEffect, useRef, useState } from 'react'
import type { PromptTab, Run, Settings } from './types'
import ApiKeyPanel from './components/ApiKeyPanel'
import TabEditor from './components/TabEditor'
import TabRunner from './components/TabRunner'
import { loadApiKey, loadSettings, loadTabs, saveApiKey, saveSettings, saveTabs } from './lib/storage'
import { deleteFile } from './lib/openai'

type View = { kind: 'settings' } | { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'run'; id: string }

const MAX_RUNS = 30

export default function App() {
  const [apiKey, setApiKey] = useState(loadApiKey)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [tabs, setTabs] = useState<PromptTab[]>(loadTabs)
  const [view, setView] = useState<View>(() => {
    const first = tabs[0]
    if (!apiKey || !settings.keyVerifiedAt) return { kind: 'settings' }
    return first ? { kind: 'run', id: first.id } : { kind: 'new' }
  })
  const [storageWarning, setStorageWarning] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  const skipFirstSave = useRef(true)
  useEffect(() => {
    if (skipFirstSave.current) {
      skipFirstSave.current = false
      return
    }
    if (!saveTabs(tabs)) queueMicrotask(() => setStorageWarning(true))
  }, [tabs])

  const verified = !!apiKey && !!settings.keyVerifiedAt
  const activeId = view.kind === 'run' || view.kind === 'edit' ? view.id : ''
  const activeTab = tabs.find((t) => t.id === activeId)

  function saveKey(key: string, remember: boolean) {
    setApiKey(key)
    saveApiKey(key, remember)
  }

  function upsertTab(tab: PromptTab) {
    setTabs((list) => (list.some((t) => t.id === tab.id) ? list.map((t) => (t.id === tab.id ? tab : t)) : [...list, tab]))
    setView({ kind: 'run', id: tab.id })
  }

  function deleteTab(tab: PromptTab) {
    for (const a of tab.attachments) if (a.fileId) deleteFile(apiKey, a.fileId)
    const rest = tabs.filter((t) => t.id !== tab.id)
    setTabs(rest)
    setView(rest[0] ? { kind: 'run', id: rest[0].id } : { kind: 'new' })
  }

  function addRun(tabId: string, run: Run) {
    setTabs((list) => list.map((t) => (t.id === tabId ? { ...t, runs: [run, ...t.runs].slice(0, MAX_RUNS) } : t)))
  }

  function clearRuns(tabId: string) {
    setTabs((list) => list.map((t) => (t.id === tabId ? { ...t, runs: [] } : t)))
  }

  function exportTabs() {
    const blob = new Blob([JSON.stringify({ version: 1, tabs }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `prompt-studio-tabs-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importTabs(file: File) {
    try {
      const data = JSON.parse(await file.text()) as { tabs?: PromptTab[] }
      const incoming = (data.tabs ?? []).filter((t) => t && t.id && t.instructions)
      if (!incoming.length) throw new Error('No tabs found in this file.')
      setTabs((list) => [...list.filter((t) => !incoming.some((i) => i.id === t.id)), ...incoming])
      setView({ kind: 'run', id: incoming[0].id })
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ✦
          </span>
          <span>Prompt Studio</span>
        </div>
        <div className="row">
          <button className="btn ghost small" onClick={exportTabs} disabled={!tabs.length}>
            Export
          </button>
          <button className="btn ghost small" onClick={() => importInput.current?.click()}>
            Import
          </button>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importTabs(f)
              e.target.value = ''
            }}
          />
          <button
            className={`key-pill ${verified ? 'ok' : 'missing'}`}
            onClick={() => setView({ kind: 'settings' })}
            title="API key settings"
          >
            <span className="dot" />
            {verified ? settings.defaultModel || 'Key connected' : 'Add API key'}
          </button>
        </div>
      </header>

      <nav className="tabbar" aria-label="Prompt tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`tab ${t.id === activeId ? 'active' : ''}`}
            onClick={() => setView({ kind: 'run', id: t.id })}
            title={t.description}
          >
            {t.name}
          </button>
        ))}
        <button
          className={`tab add ${view.kind === 'new' ? 'active' : ''}`}
          onClick={() => setView({ kind: 'new' })}
          disabled={!verified}
          title={verified ? 'Create a new tab from a prompt' : 'Test your API key first'}
        >
          + New tab
        </button>
      </nav>

      <main className="main">
        {storageWarning && (
          <p className="status error">
            Browser storage is full or blocked — changes may not be saved. Use Export to keep a backup.
          </p>
        )}

        {view.kind === 'settings' && (
          <ApiKeyPanel
            apiKey={apiKey}
            settings={settings}
            onSaveKey={saveKey}
            onSettings={(patch) => setSettings((s) => ({ ...s, ...patch }))}
            onClose={
              verified ? () => setView(tabs[0] ? { kind: 'run', id: tabs[0].id } : { kind: 'new' }) : undefined
            }
          />
        )}

        {view.kind === 'new' && (
          <TabEditor
            key="new"
            apiKey={apiKey}
            settings={settings}
            onSave={upsertTab}
            onCancel={() => setView(tabs[0] ? { kind: 'run', id: tabs[0].id } : { kind: 'settings' })}
          />
        )}

        {view.kind === 'edit' && activeTab && (
          <TabEditor
            key={activeTab.id}
            apiKey={apiKey}
            settings={settings}
            tab={activeTab}
            onSave={upsertTab}
            onCancel={() => setView({ kind: 'run', id: activeTab.id })}
          />
        )}

        {view.kind === 'run' && activeTab && (
          <TabRunner
            key={activeTab.id}
            apiKey={apiKey}
            defaultModel={settings.defaultModel}
            tab={activeTab}
            onAddRun={addRun}
            onClearRuns={clearRuns}
            onEdit={() => setView({ kind: 'edit', id: activeTab.id })}
            onDelete={() => deleteTab(activeTab)}
          />
        )}
      </main>
    </div>
  )
}
