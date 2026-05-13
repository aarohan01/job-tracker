# Job Tracker

A personal job-search command center built to turn scattered application emails into a clear, searchable workflow.

This project combines a local dashboard, structured JSON data, Gmail-driven automation, Excel export support, and a read-only mobile snapshot hosted with GitHub Pages. I built it to solve a real problem in my own search: keeping applications, recruiter messages, assessments, rejections, and follow-ups organized without relying on a spreadsheet as the primary interface.

## Live Snapshot

View the read-only mobile snapshot here:

[https://aarohan01.github.io/job-tracker/](https://aarohan01.github.io/job-tracker/)

The hosted snapshot is intentionally read-only. The editable dashboard runs locally, while the public view gives a quick mobile-friendly look at the current tracker state.

## What It Does

- Tracks active applications, high-priority follow-ups, rejected roles, and trash/suppression history.
- Separates recruiter-only outreach from submitted applications so counts stay accurate.
- Uses Gmail-derived updates to keep the tracker current while preserving manual edits.
- Supports incremental scans with overlap windows to reduce missed job-search emails.
- Keeps deleted rows available for suppression so old emails do not recreate removed applications.
- Exports an Excel workbook manually when a spreadsheet version is useful.
- Publishes a static read-only snapshot for remote viewing.

## Why I Built It

Job-search tracking gets messy fast because the source data is not one clean system. Updates arrive from LinkedIn, Workday, Greenhouse, recruiters, assessment vendors, company domains, and vague automated email templates.

The interesting engineering challenge was not just displaying rows. It was designing a small system that could:

- preserve user corrections,
- avoid duplicate rows,
- catch subtle status updates like neutral-looking rejection emails,
- keep local data safe while OneDrive syncs files,
- and still be easy to use every day.

## Engineering Highlights

- **Local-first architecture:** the dashboard uses `job-tracker.json` as the source of truth, with a small Node HTTP server for reads, saves, and export actions.
- **Optimistic conflict protection:** saves use `meta.revision` to avoid overwriting newer data from another writer.
- **OneDrive-safe writes:** JSON updates go through a temp-file and retry flow designed for transient sync conflicts.
- **Derived views:** High Priority is not duplicated data; it is a filtered view of application rows.
- **Data hygiene:** trash and permanent-delete history suppress duplicate recreation from old emails.
- **Static publishing path:** `job-tracker/readonly-site/` is the source for the GitHub Pages snapshot, and `docs/` is generated output.

## Tech Stack

- JavaScript ES modules
- Node.js local server
- Plain HTML/CSS/JS dashboard
- JSON source-of-truth data model
- PowerShell startup helpers for Windows
- Node-based scripts for automation helpers and snapshot generation
- GitHub Pages for the read-only remote view

## Repository Layout

```text
job-tracker/
  app/                 local editable dashboard and Node server
  scripts/             Gmail update, workbook, file I/O, and snapshot helpers
  readonly-site/       source for the read-only GitHub Pages view
  tests/               model and file-write behavior tests
  job-tracker.json     tracker data
docs/                  generated GitHub Pages output
```

The operational developer notes live in [job-tracker/README.md](job-tracker/README.md).

## Current Status

The local dashboard is the main working app. The GitHub Pages site is a snapshot preview for remote viewing and recruiter-friendly browsing.
