// Thin browser client for the OpenAI REST API. Calls go straight from the
// user's browser to api.openai.com with their own key — there is no backend.

const BASE = 'https://api.openai.com/v1'

export class OpenAIError extends Error {
  status?: number
  code?: string

  constructor(message: string, status?: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function toError(res: Response): Promise<OpenAIError> {
  let message = `HTTP ${res.status}`
  let code: string | undefined
  try {
    const body = await res.json()
    message = body?.error?.message || message
    code = body?.error?.code || body?.error?.type
  } catch {
    // non-JSON error body
  }
  return new OpenAIError(message, res.status, code)
}

async function request(apiKey: string, path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, ...init.headers },
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new OpenAIError('Network error — could not reach api.openai.com.')
  }
  if (!res.ok) throw await toError(res)
  return res
}

function jsonInit(body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }
}

/* ---------- Models ---------- */

export async function listModels(apiKey: string): Promise<string[]> {
  const res = await request(apiKey, '/models')
  const body = (await res.json()) as { data: { id: string }[] }
  return body.data.map((m) => m.id).sort()
}

const NON_TEXT = /(audio|realtime|tts|transcribe|whisper|image|dall-e|embedding|moderation|instruct|search-api|sora)/

/** Models that can produce text through the Responses API. */
export function textModels(ids: string[]): string[] {
  return ids.filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !NON_TEXT.test(id))
}

const PREFERRED = ['gpt-5-mini', 'gpt-5', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o']

export function pickDefaultModel(ids: string[]): string {
  const text = textModels(ids)
  return PREFERRED.find((m) => text.includes(m)) ?? text[0] ?? ''
}

/** Cheapest possible generation call — proves the key has quota for this model. */
export async function testGeneration(apiKey: string, model: string): Promise<void> {
  await request(
    apiKey,
    '/responses',
    jsonInit({ model, input: 'Reply with the single word: OK', max_output_tokens: 16, store: false }),
  )
}

/* ---------- Files ---------- */

export async function uploadFile(apiKey: string, file: File, purpose: 'user_data' | 'vision'): Promise<string> {
  const form = new FormData()
  form.append('purpose', purpose)
  form.append('file', file)
  const res = await request(apiKey, '/files', { method: 'POST', body: form })
  const body = (await res.json()) as { id: string }
  return body.id
}

export async function deleteFile(apiKey: string, fileId: string): Promise<void> {
  try {
    await request(apiKey, `/files/${fileId}`, { method: 'DELETE' })
  } catch {
    // best effort — the file may already be gone
  }
}

/* ---------- Responses ---------- */

export type ContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_file'; file_id: string }
  | { type: 'input_image'; file_id: string }

export interface GenerateParams {
  model: string
  instructions: string
  content: ContentPart[]
}

interface OutputItem {
  type: string
  content?: { type: string; text?: string }[]
}

function outputText(output: OutputItem[] | undefined): string {
  return (output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text ?? '')
    .join('')
}

/** Streams a Responses API call, invoking onDelta with each text chunk. Returns the full text. */
export async function streamResponse(
  apiKey: string,
  params: GenerateParams,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await request(
    apiKey,
    '/responses',
    jsonInit(
      {
        model: params.model,
        instructions: params.instructions,
        input: [{ role: 'user', content: params.content }],
        stream: true,
        store: false,
      },
      signal,
    ),
  )

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  const handle = (data: string) => {
    if (!data || data === '[DONE]') return
    const event = JSON.parse(data)
    switch (event.type) {
      case 'response.output_text.delta':
        text += event.delta
        onDelta(event.delta)
        break
      case 'response.failed':
        throw new OpenAIError(event.response?.error?.message ?? 'The response failed.')
      case 'response.incomplete': {
        const reason = event.response?.incomplete_details?.reason
        if (!text) throw new OpenAIError(`Response incomplete${reason ? `: ${reason}` : ''}.`)
        break
      }
      case 'error':
        throw new OpenAIError(event.message ?? event.error?.message ?? 'Stream error.', undefined, event.code)
    }
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      handle(data)
    }
  }
  return text
}

/* ---------- Tab metadata from a prompt ---------- */

export interface TabMeta {
  name: string
  description: string
  inputLabel: string
  inputPlaceholder: string
}

const META_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'inputLabel', 'inputPlaceholder'],
  properties: {
    name: { type: 'string', description: 'Short tab title, 1-3 words, Title Case. e.g. "Correct Sentence", "Bid Writer".' },
    description: { type: 'string', description: 'One sentence describing what this tool does for the user.' },
    inputLabel: { type: 'string', description: 'Label for the text box the user types into, 1-4 words.' },
    inputPlaceholder: { type: 'string', description: 'Example placeholder text for that box, under 90 characters.' },
  },
}

/** Asks the model to name and describe a tab based on the user's system prompt. */
export async function generateTabMeta(apiKey: string, model: string, instructions: string): Promise<TabMeta> {
  const res = await request(
    apiKey,
    '/responses',
    jsonInit({
      model,
      store: false,
      instructions:
        'You design small single-purpose AI tools. Given the system prompt a user wrote for a tool, ' +
        'describe the tool so it can be shown as a tab in an app. The user will paste text into the tool ' +
        'and receive output that follows the prompt.',
      input: `System prompt:\n"""\n${instructions}\n"""`,
      text: { format: { type: 'json_schema', name: 'tab_meta', strict: true, schema: META_SCHEMA } },
    }),
  )
  const body = (await res.json()) as { output?: OutputItem[] }
  return JSON.parse(outputText(body.output)) as TabMeta
}

export function describeError(err: unknown): string {
  if (err instanceof OpenAIError) {
    if (err.status === 401) return 'Invalid API key (401). Check that the key is correct and not revoked.'
    if (err.code === 'insufficient_quota') return 'This key has no remaining quota. Check billing on platform.openai.com.'
    if (err.status === 429) return `Rate limited (429): ${err.message}`
    if (err.status === 404) return `Not found (404): ${err.message}`
    return err.message
  }
  return (err as Error)?.message ?? String(err)
}
