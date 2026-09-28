export type AttachmentKind = 'text' | 'file' | 'image'

export interface Attachment {
  id: string
  name: string
  size: number
  mime: string
  kind: AttachmentKind
  /** Inline content for text files (sent as part of the instructions). */
  text?: string
  /** OpenAI Files API id for PDFs, documents and images. */
  fileId?: string
}

/** A file the model produced. Only metadata is persisted; the bytes live in memory. */
export interface GeneratedFile {
  id: string
  name: string
  source: 'container' | 'image'
  containerId?: string
  fileId?: string
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
  /** Empty string = use the default model from settings. */
  model: string
  attachments: Attachment[]
  /** Missing on tabs created before tools existed — treat as all off. */
  tools?: TabTools
  runs: Run[]
  createdAt: number
}

export interface Settings {
  defaultModel: string
  models: string[]
  rememberKey: boolean
  keyVerifiedAt?: number
}
