import type { PromptTab, ProviderId, ProviderSettings, Settings } from '../types'

// Everything lives in the browser. localStorage can throw (private mode,
// quota exceeded, blocked storage), so every access is guarded.

const TABS = 'ps.tabs'
const SETTINGS = 'ps.settings'
// The OpenAI key keeps its original storage name so existing users stay signed in.
const KEYS: Record<ProviderId, string> = { openai: 'ps.apiKey', anthropic: 'ps.apiKey.anthropic' }

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

const EMPTY_PROVIDER: ProviderSettings = { models: [], defaultModel: '' }

export const DEFAULT_SETTINGS: Settings = {
  providers: { openai: EMPTY_PROVIDER, anthropic: EMPTY_PROVIDER },
  defaultProvider: 'openai',
  rememberKey: true,
}

/** Shape saved before Claude support: OpenAI-only fields at the top level. */
interface LegacySettings {
  defaultModel?: string
  models?: string[]
  keyVerifiedAt?: number
}

export function loadSettings(): Settings {
  const saved = read<Partial<Settings> & LegacySettings>(localStorage, SETTINGS, {})
  const providers = { ...DEFAULT_SETTINGS.providers, ...saved.providers }
  if (!saved.providers && saved.models) {
    providers.openai = { models: saved.models, defaultModel: saved.defaultModel ?? '', verifiedAt: saved.keyVerifiedAt }
  }
  return {
    providers,
    defaultProvider: saved.defaultProvider ?? 'openai',
    rememberKey: saved.rememberKey ?? true,
  }
}

export const saveSettings = (s: Settings) => write(localStorage, SETTINGS, s)

export const loadTabs = (): PromptTab[] => read(localStorage, TABS, [])
export const saveTabs = (tabs: PromptTab[]) => write(localStorage, TABS, tabs)

/** Remembered keys go to localStorage; otherwise the key lasts only for this browser tab. */
export function loadApiKey(provider: ProviderId): string {
  const name = KEYS[provider]
  return read(localStorage, name, '') || read(sessionStorage, name, '')
}

export function saveApiKey(provider: ProviderId, key: string, remember: boolean) {
  const name = KEYS[provider]
  remove(localStorage, name)
  remove(sessionStorage, name)
  if (key) write(remember ? localStorage : sessionStorage, name, key)
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

/** Current time in ms (kept out of components so render-purity lint rules stay quiet). */
export const timestamp = () => Date.now()
