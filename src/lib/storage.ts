import type { PromptTab, Settings } from '../types'

// Everything lives in the browser. localStorage can throw (private mode,
// quota exceeded, blocked storage), so every access is guarded.

const TABS = 'ps.tabs'
const SETTINGS = 'ps.settings'
const KEY = 'ps.apiKey'

function read<T>(store: Storage, key: string, fallback: T): T {
  try {
    const raw = store.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(store: Storage, key: string, value: unknown): boolean {
  try {
    store.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function remove(store: Storage, key: string) {
  try {
    store.removeItem(key)
  } catch {
    // ignore
  }
}

export const DEFAULT_SETTINGS: Settings = { defaultModel: '', models: [], rememberKey: true }

export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...read(localStorage, SETTINGS, {}) })
export const saveSettings = (s: Settings) => write(localStorage, SETTINGS, s)

export const loadTabs = (): PromptTab[] => read(localStorage, TABS, [])
export const saveTabs = (tabs: PromptTab[]) => write(localStorage, TABS, tabs)

/** Remembered keys go to localStorage; otherwise the key lasts only for this browser tab. */
export function loadApiKey(): string {
  return read(localStorage, KEY, '') || read(sessionStorage, KEY, '')
}

export function saveApiKey(key: string, remember: boolean) {
  remove(localStorage, KEY)
  remove(sessionStorage, KEY)
  if (key) write(remember ? localStorage : sessionStorage, KEY, key)
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
