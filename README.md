# SBL Donation Lookup

Vercel-ready **Vite + React + TypeScript** app with serverless API using either Apps Script (private sheet access) or public Google Sheets.

## Stack

- Frontend: Vite + React (`src/`)
- Backend: Vercel Functions in TypeScript (`api/`)
- Data source: Google Apps Script (private sheets) or public Google Sheets

## Project Structure

- `src/` - React UI
- `api/lookup.ts` - donation lookup endpoint
- `api/health.ts` - health check endpoint
- `api/_lib/lookup.ts` - Google Sheets lookup logic
- `vercel.json` - Vercel build/output + SPA rewrites

## Environment Variables

Set these in Vercel Project Settings (Environment Variables):

- `APPS_SCRIPT_URL` (optional; preferred for private sheets)
- `APPS_SCRIPT_TOKEN` (optional shared secret if your Apps Script checks a token)
- `SPREADSHEET_IDS` (comma-separated)
- `SHEET_NAMES` (comma-separated)

Example values are in `.env.example`.

## Google Access Setup

Option A (private sheets, recommended):
1. Deploy a Google Apps Script Web App that reads your private sheet.
2. Set `APPS_SCRIPT_URL` (and `APPS_SCRIPT_TOKEN` if used).
3. No service account JSON key is needed in this app.

Option B (public sheets):
1. Set each target spreadsheet to **Anyone with the link can view**.
2. Keep sheet tab names in `SHEET_NAMES` exactly matching your file.

## Deploy to Vercel

1. Push this folder to GitHub.
2. Import repo to Vercel.
3. Add environment variables above.
4. Deploy.

After deploy:
- Web UI: `/`
- Health: `/api/health`
- Lookup: `/api/lookup?code=DON123...`

## Local Dev

```bash
npm install
npm run dev
```

If you also want local API behavior exactly like Vercel functions:

```bash
npm run vercel:dev
```

## Notes

- Uses a 5-minute in-memory cache in serverless runtime.
- Lookup matches donation code from column `O` and returns fields from columns `C..I`.
- If using public-sheet mode, do not store sensitive/private data there.
