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

export interface Run {
  id: string
  input: string
  output: string
  model: string
  at: number
  error?: string
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
  runs: Run[]
  createdAt: number
}

export interface Settings {
  defaultModel: string
  models: string[]
  rememberKey: boolean
  keyVerifiedAt?: number
}
