import type { Attachment, PromptTab } from '../types'
import type { ContentPart, Tool } from './openai'
import { uploadFile } from './openai'
import { uid } from './storage'

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|ya?ml|log|ini|toml|js|jsx|ts|tsx|py|java|c|cpp|cs|go|rs|rb|php|sql|sh|css)$/i
const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif)$/

export const MAX_TEXT_BYTES = 300 * 1024
export const MAX_FILE_BYTES = 32 * 1024 * 1024

export const ACCEPT =
  '.txt,.md,.csv,.tsv,.json,.xml,.html,.yaml,.yml,.log,.pdf,.docx,.doc,.pptx,.xlsx,.xls,.rtf,.odt,.zip,.png,.jpg,.jpeg,.webp,.gif,text/*'

/**
 * Text files are read locally and inlined into the instructions.
 * PDFs, office documents and images are uploaded to the OpenAI Files API and referenced by id.
 */
export async function createAttachment(apiKey: string, file: File): Promise<Attachment> {
  const base = { id: uid(), name: file.name, size: file.size, mime: file.type }

  if (file.type.startsWith('text/') || TEXT_EXT.test(file.name)) {
    if (file.size > MAX_TEXT_BYTES) {
      throw new Error(`${file.name} is larger than ${MAX_TEXT_BYTES / 1024} KB. Trim it or save it as a PDF.`)
    }
    return { ...base, kind: 'text', text: await file.text() }
  }

  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 32 MB.`)

  if (IMAGE_MIME.test(file.type)) {
    return { ...base, kind: 'image', fileId: await uploadFile(apiKey, file, 'vision') }
  }
  return { ...base, kind: 'file', fileId: await uploadFile(apiKey, file, 'user_data') }
}

const FILE_GUIDE = `

# Creating files
You have a Python tool. When the task calls for a file (PDF, DOCX, XLSX, PPTX, CSV, chart, image, ZIP…), create it with Python and save it in /mnt/data/ with a short, descriptive filename. The user downloads it directly from the app, so do not paste the file's content as text or show sandbox links — just say briefly what the file contains.`

export function buildInstructions(tab: PromptTab): string {
  let out = tab.instructions
  const texts = tab.attachments.filter((a) => a.kind === 'text')
  if (texts.length) {
    const blocks = texts.map((a) => `## ${a.name}\n\`\`\`\n${a.text}\n\`\`\``).join('\n\n')
    out += `\n\n# Reference material\nThe user attached these files as context. Use them when relevant.\n\n${blocks}`
  }
  if (tab.tools?.files) out += FILE_GUIDE
  return out
}

const isPdf = (a: Attachment) => a.mime === 'application/pdf' || /\.pdf$/i.test(a.name)

export function buildContent(tab: PromptTab, userText: string): ContentPart[] {
  const parts: ContentPart[] = []
  for (const a of tab.attachments) {
    if (!a.fileId) continue
    if (a.kind === 'image') parts.push({ type: 'input_image', file_id: a.fileId })
    // With Code Interpreter on, non-PDF documents (DOCX, XLSX…) are read by Python from the container instead.
    else if (isPdf(a) || !tab.tools?.files) parts.push({ type: 'input_file', file_id: a.fileId })
  }
  parts.push({ type: 'input_text', text: userText })
  return parts
}

export function buildTools(tab: PromptTab): Tool[] {
  const tools: Tool[] = []
  if (tab.tools?.files) {
    const fileIds = tab.attachments.filter((a) => a.fileId && a.kind === 'file').map((a) => a.fileId!)
    tools.push({ type: 'code_interpreter', container: { type: 'auto', file_ids: fileIds.length ? fileIds : undefined } })
  }
  if (tab.tools?.images) tools.push({ type: 'image_generation' })
  return tools
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
