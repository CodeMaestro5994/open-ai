export type ProviderId = 'openai' | 'anthropic'

export type AttachmentKind = 'text' | 'file' | 'image'

export interface Attachment {
  id: string
  name: string
  size: number
  mime: string
  kind: AttachmentKind
  /** Inline content for text files (sent as part of the instructions). */
  text?: string
  /** OpenAI: Files API id. Claude: id of the bytes kept in this browser (IndexedDB). */
  fileId?: string
  /** Which provider fileId belongs to. Missing on old attachments = OpenAI. */
  provider?: ProviderId
}

/** A file the model produced. Only metadata is persisted; the bytes live in memory. */
export interface GeneratedFile {
  id: string
  name: string
  /** container = Code Interpreter output, image = image generation output. */
  source: 'container' | 'image'
  containerId?: string
  fileId?: string
  /** Missing on runs recorded before Claude support = OpenAI. */
  provider?: ProviderId
}

export interface Run {
  id: string
  input: string
  output: string
  model: string
  at: number
  error?: string
  files?: GeneratedFile[]
}

export interface TabTools {
  /** Code Interpreter: lets the model create any file (PDF, DOCX, XLSX, charts…) with Python. */
  files: boolean
  /** Image generation tool. */
  images: boolean
}

export interface PromptTab {
  id: string
  name: string
  description: string
  instructions: string
  inputLabel: string
  inputPlaceholder: string
  /** Missing on tabs created before Claude support = OpenAI. */
  provider?: ProviderId
  /** Empty string = use the provider's default model from settings. */
  model: string
  attachments: Attachment[]
  /** Missing on tabs created before tools existed — treat as all off. */
  tools?: TabTools
  runs: Run[]
  createdAt: number
}

export interface ProviderSettings {
  models: string[]
  defaultModel: string
  verifiedAt?: number
  /** Per-model output cap, when the provider reports one (Claude). */
  maxTokens?: Record<string, number>
}

export interface Settings {
  providers: Record<ProviderId, ProviderSettings>
  /** Provider preselected for new tabs. */
  defaultProvider: ProviderId
  rememberKey: boolean
}
