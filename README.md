# GrowEasy AI CSV Importer

AI-powered CSV importer for GrowEasy CRM. The frontend previews any uploaded CSV locally, and the backend uses an LLM to map messy columns into the required CRM schema only after the user confirms the import.

## Features

- Drag-and-drop or file picker upload
- Local CSV preview before AI processing
- Responsive table with horizontal and vertical scrolling
- AI-backed CRM field extraction in batches
- Imported and skipped record summaries
- AI extraction when `OPENAI_API_KEY` is configured, with heuristic fallback for demo/offline mode
- CSV validation before preview/import to reject non-CSV uploads clearly
- Preview truncation notice when only the first 25 rows are shown

## Tech Stack

- Next.js frontend
- Express backend
- TypeScript throughout
- OpenAI-compatible LLM integration

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your environment file:

```bash
copy .env.example .env
```

3. Add your LLM key and, if needed, adjust the API base URL.

4. Start both apps:

```bash
npm run dev
```

The frontend runs on `http://localhost:3000` and the backend runs on `http://localhost:4000`.

## Environment Variables

- `OPENAI_API_KEY`: optional; enables live AI extraction when configured
- `OPENAI_MODEL`: optional, defaults to `gpt-4o-mini`
- `NEXT_PUBLIC_API_BASE_URL`: backend URL used by the frontend
- `PORT`: backend port
- `CORS_ORIGIN`: allowed frontend origin for the API

## Build

```bash
npm run build
```

## Notes

- The importer skips rows that do not contain either an email address or a mobile number.
- Allowed CRM statuses are limited to `GOOD_LEAD_FOLLOW_UP`, `DID_NOT_CONNECT`, `BAD_LEAD`, and `SALE_DONE`.
- Allowed data sources are limited to the values requested in the assignment.
- `created_at` values are normalized before being returned so downstream JavaScript date parsing stays safe.
