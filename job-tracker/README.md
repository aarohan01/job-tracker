# Job Tracker

Local personal job-search tracker with a browser dashboard, JSON master data file, Excel export, backups, and a daily Codex automation.

## Main Files

- `job-tracker.json` is the source of truth for the dashboard and automation.
- `Job Application Tracker.xlsx` is the generated Excel workbook.
- `backups/` stores dated Excel and JSON backups.
- `previews/` stores rendered workbook preview images.
- `app/` contains the local dashboard and server.
- `scripts/` contains workbook and Gmail update helpers.
- `tests/` contains model behavior tests.
- `scripts/file-io.mjs` contains the shared OneDrive-safe JSON write helper.

## Run Locally

Start the dashboard:

```powershell
.\start-job-tracker.ps1
```

Stop the dashboard:

```powershell
.\stop-job-tracker.ps1
```

Stop existing tracker servers and start exactly one on port `3000`:

```powershell
.\restart-job-tracker-3000.ps1
```

The dashboard runs at:

```text
http://localhost:3000
```

Build the read-only GitHub Pages snapshot:

```powershell
npm run build:readonly
```

The generated mobile-friendly static site lives in `..\docs` and is safe for GitHub Pages.

Start the dashboard automatically after Windows login:

```powershell
.\install-startup-task.ps1
```

## Data Rules

- `applications[]` is the active source of truth.
- High Priority is a view of application rows where `isHighPriority` is `true`.
- `needsAttention[]` is legacy and should normally remain empty.
- Trash suppresses deleted rows so scans do not recreate them from the same emails.
- Permanently deleted rows remain in `permanentlyDeletedItems[]` for suppression details, but they do not count in Total.
- Rejected applications are moved to Trash automatically.

## Counts

- Total: active Application Tracker rows plus Trash rows, excluding recruiter-only messages.
- High Priority: active rows where `isHighPriority` is `true`.
- Tracking: active Application Tracker rows only, excluding recruiter-only messages.
- Trash: all rows currently in Trash.
- Rejected: rejected rows in Trash plus any legacy active rejected rows, excluding permanently deleted rows.

## Record Types

- `application`: normal submitted application; appears in Application Tracker and counts.
- `recruiter_message`: pure recruiter outreach not tied to a submitted application; appears only in High Priority when action is needed and is excluded from Tracking and Total.

If a recruiter or portal message clearly belongs to an existing submitted application, update the matching application row instead of creating a recruiter-message row.

## Statuses

- `Assessment / interview`: amber
- `Reply needed`: blue
- `Reply recruiter`: slate
- `Rejected`: red
- `Applied / waiting`: green

When a High Priority item is marked done, it is confirmed, removed from High Priority, recorded in completion history, and the matching row returns to `Applied / waiting`.

## Save Safety

The tracker uses optimistic conflict protection plus OneDrive-safe writes:

- `meta.revision` is read before saving.
- Saves are accepted only if the file revision has not changed.
- Successful saves increment `meta.revision`.
- If the file changed underneath the dashboard or automation, the save is rejected instead of overwriting newer data.
- JSON writes use uniquely named temp files.
- Writers try temp-file rename first.
- If OneDrive blocks rename with a transient file error, writers use bounded retries and a copy-overwrite fallback.
- Temp cleanup is best-effort; leftover `job-tracker.json.*.tmp` files are harmless because only `job-tracker.json` is read as tracker data.
- Old temp files may be cleaned best-effort on later writes.

## Automation

The daily automation is named `Daily JOB report` and is scheduled for 12 PM.

Its working directory should be:

```text
C:\Users\ronha\OneDrive\Documents\New project\job-tracker
```

Expected behavior:

- scan Gmail incrementally by default
- run a full scan only when requested or when no previous successful scan exists
- label matching job-search emails as `Jobs`
- preserve user edits
- update `job-tracker.json`
- email a concise summary with subject `JOB report - YYYY-MM-DD`
- do not generate or attach `Job Application Tracker.xlsx` during the daily automation

Excel remains available from the dashboard's manual `Sync Excel now` button when needed.

Important scan rules:

- scan from `meta.lastSuccessfulScanAt - meta.incrementalScanOverlapDays` through now for incremental runs
- scan from `meta.scanWindowStart` for full runs
- after success, update `meta.lastSuccessfulScanAt`, reset `meta.nextScanMode` to `incremental`, and clear `meta.fullScanRequestedAt`

## Tests

Run behavior tests:

```powershell
npm test
```

If `rg` is blocked with Access denied in this environment, use PowerShell `Select-String` instead.
