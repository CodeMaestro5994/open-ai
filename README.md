# Prompt Studio

Turn prompts into reusable AI tools. Each prompt becomes a tab: type text into the tab and it is processed by OpenAI following that prompt's rules and attached files.

Frontend only — no backend, no database. Deploys as a static site (e.g. Vercel).

## How it works

- **API key** — entered by the user, stored only in their browser (`localStorage`, or `sessionStorage` if "Remember" is off), and sent directly to `api.openai.com`.
  - *Test key* calls `GET /v1/models` (free — validates the key and lists models), then a tiny `POST /v1/responses` call with the default model to confirm the key has quota.
- **Tabs** — created from a prompt. The tab name, description, input label and placeholder are generated from the prompt with a structured-output call (editable afterwards). Stored in `localStorage`; use **Export / Import** to back up or move them.
- **Attachments**
  - Text files (`.txt`, `.md`, `.csv`, `.json`, code…, up to 300 KB) are read locally and appended to the prompt.
  - PDFs, office documents and images are uploaded to the user's OpenAI account (Files API) and sent by file id. Removing an attachment or deleting a tab deletes the uploaded file.
- **Generation** — `POST /v1/responses` with `stream: true`, `store: false`; output streams into the tab and the last 30 runs are kept as history.
- **Generated files** (per-tab options)
  - *Create downloadable files* enables the `code_interpreter` tool: the model writes any file (PDF, DOCX, XLSX, PPTX, CSV, charts, ZIP…) with Python. The app collects the files from the container (`/v1/containers/{id}/files`) and downloads them immediately, since containers expire after ~20 minutes idle. Attached Word/Excel files are mounted into the container so Python can read them.
  - *Generate images* enables the `image_generation` tool; images arrive base64 in the response and are shown with a download button.
  - File bytes are kept in memory only; history keeps file names and can re-fetch container files while they still exist.

## Claude (Anthropic) support

Each tab runs on **OpenAI** or **Claude** — add either key, or both, on the API keys screen. Claude uses the official `@anthropic-ai/sdk` in browser mode (`dangerouslyAllowBrowser`), loaded lazily so OpenAI-only users don't download it.

- *Test key* lists models (`GET /v1/models`, retired models hidden) and makes a tiny `messages.create` call. Default model: `claude-opus-5` when available.
- Generation streams from `POST /v1/messages`. For `claude-opus-5`, `claude-opus-5-5` and `claude-fable-5-1` it opts into server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Tab names come from `messages.parse` with a Zod schema.
- **Browser limits:** Anthropic allows browser (CORS) calls to Messages and Models but **not the Files API**. So for Claude:
  - PDFs and images are stored in the browser (IndexedDB) and sent inline (base64) with each request, with prompt caching on the prompt and attachments. Word/Excel files must be saved as PDF first. These files are not part of **Export**.
  - *Create downloadable files* and *Generate images* are OpenAI-only; generated files could not be downloaded without a server.

## Development

```bash
npm install
npm run dev
```

## Deploy to Vercel

Import the repo in Vercel — it auto-detects Vite (build `npm run build`, output `dist`). No environment variables are needed.
