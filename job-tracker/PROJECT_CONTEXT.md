# Job Tracker Project Context

This document is the handoff note for future Codex work on the Job Tracker.

## Purpose

The tracker is a personal job-search command center. It keeps one local master data file, shows a dense browser dashboard for daily use, exports an Excel workbook, and is updated by a daily Codex automation that scans Gmail for job-search emails.

The project is intentionally practical rather than generalized. Prefer small bug fixes over broad refactors unless the user asks for new features that make the current shape hard to maintain.

## Current Architecture

- Treat `C:\Users\ronha\OneDrive\Documents\New project\job-tracker` as the project root for Job Tracker work. Put code, scripts, tests, docs, and source assets for this app under `job-tracker/`.
- The repository root `docs/` folder is generated GitHub Pages publishing output only. Do not hand-edit it unless the user explicitly asks to work on GitHub Pages output; edit `job-tracker/readonly-site/` and run `npm run build:readonly` instead.
- `app/server.mjs`: local HTTP server, static file serving, JSON save endpoint, Excel export endpoint.
- `app/app.js`: dashboard controller for state, filters, row actions, saving, selection, and Excel sync.
- `app/views.js`: renders High Priority, Application Tracker, and Trash tables.
- `app/view-helpers.js`: display helpers, status badges, filtering, sorting, date-age badges.
- `app/tracker-model.js`: source-of-truth model behavior for counts, trash, restore, high-priority actions, record types, and row factories.
- `scripts/build-master-workbook.mjs`: manual dashboard export for `Job Application Tracker.xlsx`; it merges workbook edits when appropriate, completes done items, moves rejected rows to Trash, and renders previews.
- `scripts/update-tracker-from-gmail.mjs`: helper/update script pattern for applying Gmail-derived updates.
- `scripts/file-io.mjs`: shared OneDrive-safe JSON writer.
- `readonly-site/`: source for the mobile-friendly read-only remote view.
- `scripts/build-readonly-site.mjs`: copies `readonly-site/` plus `job-tracker.json` into repo-root `docs/` for the read-only GitHub Pages snapshot.
- `install-startup-task.ps1`: creates a per-user Windows Startup shortcut that runs `start-job-tracker.ps1`.
- `tests/tracker-model.test.mjs`: model behavior tests.

## Core Data Model

`job-tracker.json` is the master file.

Important collections:

- `applications[]`: active rows and the source of truth.
- `trash[]`: deleted rows retained to prevent recreated duplicates.
- `permanentlyDeletedItems[]`: permanent delete history for counting/suppression details.
- `completedActions[]`: history of High Priority items marked done.
- `processedEmailIds[]`: processed Gmail IDs.
- `needsAttention[]`: legacy only; should normally be empty.

High Priority is not a separate row store. It is a view of rows in `applications[]` where `isHighPriority === true`.

## Counts

- Total is active Application Tracker rows plus Trash rows, excluding recruiter messages. Permanently deleted rows do not count in Total.
- Tracking counts only active Application Tracker rows, excluding recruiter messages.
- High Priority counts active rows with `isHighPriority`.
- Trash counts rows currently in Trash.
- Rejected counts rejected rows in Trash plus any legacy active rejected rows, not permanently deleted rows.

## Status And Record Type Rules

Statuses:

- `Assessment / interview`
- `Reply needed`
- `Reply recruiter`
- `Rejected`
- `Applied / waiting`

Record types:

- `application`: normal submitted application.
- `recruiter_message`: pure recruiter outreach not tied to a submitted application.

Recruiter-only messages should appear in High Priority when action is needed, but not in Application Tracker, Tracking, or Total counts.

Explicit `recordType: "application"` must be respected even if the company/role text looks recruiter-like. This lets user corrections persist.

## Important Behaviors

- Marking Done in High Priority asks for confirmation, clears priority fields, records completion history, and returns the row to `Applied / waiting`.
- Moving a High Priority row to Trash moves the underlying application row, so it disappears from both High Priority and Application Tracker.
- Restoring from Trash returns rows according to their stored priority and record-type state.
- Setting an application status to `Rejected` moves it to Trash.
- Deleted rows are retained in Trash so future scans do not recreate them.
- Permanent delete asks for confirmation and moves suppression details into `permanentlyDeletedItems[]`.

## Save And OneDrive Safety

The current approach is optimistic concurrency, not lock files.

- `meta.revision` is the conflict token.
- The dashboard/server rejects stale saves with a revision conflict.
- Scripts should read revision, do their work, re-check revision immediately before writing, then increment on success.
- JSON writes should go through `scripts/file-io.mjs`.
- Temp filenames are unique, so leftover temp files do not block future runs.
- Writers only read `job-tracker.json`, never `*.tmp`.
- Writers try rename first, retry bounded transient OneDrive errors, then use copy-overwrite fallback if rename remains blocked.
- Temp cleanup is best-effort. Cleanup failure must not block a successful report.
- Do not reintroduce a long lock/retry loop unless the user explicitly chooses that tradeoff.

This was chosen because the tracker is personal and simultaneous edits are rare. It avoids stuck locks and token-heavy recovery loops with OneDrive.

## Automation Expectations

The daily Codex automation should:

- run at 12 PM
- use `C:\Users\ronha\OneDrive\Documents\New project\job-tracker` as its working directory
- use local paths such as `job-tracker.json`
- use a two-stage workflow: high-recall collection/labeling first, then classification/tracker updates
- scan incrementally by timestamp, with overlap days from `meta.incrementalScanOverlapDays`
- full scan only when `meta.nextScanMode === "full"` or no `meta.lastSuccessfulScanAt` exists
- label all plausible job-search operational emails as `Jobs`, even if they later produce no tracker row
- preserve user edits
- suppress duplicates using email/thread IDs across active rows, Trash, permanent deletes, completed actions, and processed IDs
- inspect full body/snippet/subject/URLs for rejection signals
- update JSON with revision protection
- email a concise summary as `JOB report - YYYY-MM-DD`
- do not generate or attach `Job Application Tracker.xlsx` during the daily automation

Known rejection examples that must be caught include GlossGenius, Brillio, and GraceMark Solutions.

PNC exposed an important retrieval bug: Workday emails from `pnc@myworkday.com` with subject `Thank you for your interest in PNC` were not labeled `Jobs`, so the tracker never classified the rejection. Later misses included Criteria Corp/Rokt assessment reminders, IBM Talent Acquisition/Avature confirmations, Greenhouse security-code/application emails, Leidos Workday application/rejection messages, and DEKA/ApplyToJob `we've received your resume`. Future automation should not depend only on obvious subject keywords. It should broadly inspect ATS/portal/assessment/recruiter/company-domain emails, vague job-related subjects like `thank you for your interest`, `your submission`, `candidate profile`, `application status`, `security code`, `complete the next steps`, `reminder`, `we've received your resume`, `resume received`, and existing tracker company names/requisition IDs. For job-related operational mail, over-labeling as `Jobs` is acceptable; missing rejections/interviews/verification/assessment reminders/application confirmations is worse.

LinkedIn exposed a second bug shape: its rejection emails can look like neutral updates in the subject, such as `Your application to <role> at <company>` or `Your update from <company>`, while the body and URL template clearly indicate rejection. The automation must explicitly retrieve and classify LinkedIn Jobs templates such as `email_jobs_application_rejected_01` and `eml-email_jobs_application_rejected_01`, and it must move an existing application to Trash when one of those emails says `Unfortunately, we will not be moving forward with your application`. Known misses included Envision Technology Solutions, Next Gen Software Solutions LLC, Red Oak Technologies, Sibitalent Corp, and SoTalent.

## User Preferences

- Do not restart the local server unless the user explicitly asks.
- If a restart is needed, ask the user to run:

```powershell
.\job-tracker\restart-job-tracker-3000.ps1
```

- Keep the dense single-theme dashboard.
- Use `job-tracker/` as the working folder for all Job Tracker code-related work. The parent `New project` folder is only the git repository wrapper and may contain generated publishing output.
- The dashboard should auto-start on Windows login via the Startup shortcut created by `install-startup-task.ps1`.
- The `Last updated` metric should reflect automation/backend data changes, not normal dashboard edits such as status changes.
- Prefer stability over refactoring because the app is now mostly done.
- Fix bugs surgically.
- If `rg` is unavailable or returns Access denied, use PowerShell `Select-String`.
- Avoid inline `node -e` module imports during automation; run existing `.mjs` scripts from the tracker folder.

## Verification

Useful checks:

```powershell
node --check app\server.mjs
node --check app\app.js
node --check app\views.js
node --check scripts\build-master-workbook.mjs
node --check scripts\update-tracker-from-gmail.mjs
npm test
```
