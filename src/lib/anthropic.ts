// Claude support via the official Anthropic SDK, called straight from the
// user's browser with their own key — there is no backend. This module is
// loaded lazily (see providers.ts) so the SDK is only downloaded when used.
//
// Anthropic allows browser calls to the Messages and Models APIs but not to the
// Files API, so attachments (PDFs, images) are stored in the browser and sent
// inline as base64, and server-side file creation is not offered for Claude.

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { PromptTab } from '../types'
import type { StreamHandlers, StreamResult, TabMeta } from './openai'
import { referenceText } from './attachments'
import { getBlob, toBase64 } from './blobs'

function client(apiKey: string) {
  // The key belongs to the person using the page and is only ever sent to api.anthropic.com.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

/** Runs an SDK call, rethrowing API errors as plain Errors with readable messages. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw friendlyError(err)
  }
}

function friendlyError(err: unknown): unknown {
  if (err instanceof Anthropic.APIUserAbortError) {
    const abort = new Error('Stopped.')
    abort.name = 'AbortError'
    return abort
  }
  // Connection errors are APIErrors too, so check them first.
  if (err instanceof Anthropic.APIConnectionError) {
    return new Error('Could not reach api.anthropic.com — check your network connection.')
  }
  if (!(err instanceof Anthropic.APIError)) return err
  const detail = (err.error as { error?: { message?: string } } | undefined)?.error?.message ?? err.message
  if (err instanceof Anthropic.AuthenticationError) {
    return new Error('Invalid Claude API key (401). Check that the key is correct and not revoked.')
  }
  if (err instanceof Anthropic.PermissionDeniedError) return new Error(`This key is not allowed to do that (403): ${detail}`)
  if (err instanceof Anthropic.NotFoundError) return new Error(`Not found (404): ${detail}`)
  if (err instanceof Anthropic.RateLimitError) return new Error(`Rate limited (429): ${detail}`)
  return new Error(detail)
}

/* ---------- Models ---------- */

export interface ClaudeModels {
  ids: string[]
  /** Per-model output cap from the Models API. */
  maxTokens: Record<string, number>
}

export function listModels(apiKey: string): Promise<ClaudeModels> {
  return call(async () => {
    const ids: string[] = []
    const maxTokens: Record<string, number> = {}
    for await (const m of client(apiKey).models.list()) {
      if (m.lifecycle === 'retired') continue
      ids.push(m.id)
      if (m.max_tokens) maxTokens[m.id] = m.max_tokens
    }
    return { ids, maxTokens }
  })
}

/** Cheapest possible generation call — proves the key has credit for this model. */
export async function testGeneration(apiKey: string, model: string): Promise<void> {
  await call(() =>
    client(apiKey).messages.create({
      model,
      max_tokens: 32,
      messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
    }),
  )
}

/* ---------- Messages ---------- */

// Models that support server-side refusal fallbacks: a declined request is re-run
// on Anthropic's recommended model for that refusal category instead of failing.
const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-opus-5-5', 'claude-fable-5-1'])

type ImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

async function buildContent(tab: PromptTab, userText: string): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const parts: Anthropic.Beta.BetaContentBlockParam[] = []
  for (const a of tab.attachments) {
    if (!a.fileId || a.provider !== 'anthropic') continue
    const blob = await getBlob(a.fileId)
    if (!blob) throw new Error(`${a.name} is no longer stored in this browser. Edit the tab and add it again.`)
    const data = await toBase64(blob)
    parts.push(
      a.kind === 'image'
        ? { type: 'image', source: { type: 'base64', media_type: (a.mime || 'image/png') as ImageType, data } }
        : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: a.name },
    )
  }
  // The attachments are identical on every run of a tab — cache them so repeat runs bill them at the cached rate.
  const last = parts.at(-1)
  if (last && (last.type === 'image' || last.type === 'document')) last.cache_control = { type: 'ephemeral' }
  parts.push({ type: 'text', text: userText })
  return parts
}

/** Streams a Claude response for one tab run. */
export function streamResponse(
  apiKey: string,
  tab: PromptTab,
  model: string,
  maxTokens: number | undefined,
  userText: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<StreamResult> {
  return call(async () => {
    const stream = client(apiKey).beta.messages.stream(
      {
        model,
        max_tokens: Math.min(maxTokens ?? 64000, 64000),
        system: [{ type: 'text', text: tab.instructions + referenceText(tab), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: await buildContent(tab, userText) }],
        ...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    )

    let text = ''
    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'thinking') handlers.onStatus?.('Thinking…')
        else if (event.content_block.type === 'text') handlers.onStatus?.('')
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
        handlers.onDelta(event.delta.text)
      }
    }

    const message = await stream.finalMessage()
    if (message.stop_reason === 'refusal') {
      const why = message.stop_details?.explanation
      throw new Error(`Claude declined this request${why ? `: ${why}` : '.'}`)
    }
    if (message.stop_reason === 'max_tokens' && !text) throw new Error('Claude hit the output limit before answering.')
    return { text, files: [], containerIds: [] }
  })
}

/* ---------- Tab metadata from a prompt ---------- */

const TabMetaSchema = z.object({
  name: z.string().describe('Short tab title, 1-3 words, Title Case. e.g. "Correct Sentence", "Bid Writer".'),
  description: z.string().describe('One sentence describing what this tool does for the user.'),
  inputLabel: z.string().describe('Label for the text box the user types into, 1-4 words.'),
  inputPlaceholder: z.string().describe('Example placeholder text for that box, under 90 characters.'),
})

export async function generateTabMeta(apiKey: string, model: string, instructions: string): Promise<TabMeta> {
  const response = await call(() =>
    client(apiKey).messages.parse({
      model,
      max_tokens: 16000,
      system:
        'You design small single-purpose AI tools. Given the system prompt a user wrote for a tool, ' +
        'describe the tool so it can be shown as a tab in an app. The user will paste text into the tool ' +
        'and receive output that follows the prompt.',
      messages: [{ role: 'user', content: `System prompt:\n"""\n${instructions}\n"""` }],
      output_config: { format: zodOutputFormat(TabMetaSchema) },
    }),
  )
  if (!response.parsed_output) throw new Error('Claude did not return tab details.')
  return response.parsed_output
}
