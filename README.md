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

## Development

```bash
npm install
npm run dev
```

## Deploy to Vercel

Import the repo in Vercel — it auto-detects Vite (build `npm run build`, output `dist`). No environment variables are needed.
