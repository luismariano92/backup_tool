# Architecture

This document describes the internal architecture of the WebDAV Backup tool.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser UI                           │
│              src/client/main.ts → public/main.js            │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Folder       │  │ Backup       │  │ Schedule          │  │
│  │ Browser      │  │ Controls     │  │ Manager           │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘  │
└─────────┼─────────────────┼───────────────────┼─────────────┘
          │ fetch           │ fetch             │ fetch
          ▼                 ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│                     HTTP Server (node:http)                  │
│                     src/server/index.ts                      │
│                                                             │
│  Routes:                                                    │
│    /api/browse    /api/backup    /api/schedules              │
│    /api/status    /api/jobs/:id  /api/schedules/:id/run     │
│    /api/check     Static files   /api/schedules/:id         │
└──────┬──────────────┬──────────────────┬────────────────────┘
       │              │                  │
       ▼              ▼                  ▼
┌────────────┐ ┌─────────────┐  ┌──────────────┐
│  browse.ts │ │  backup.ts  │  │ scheduler.ts │
│            │ │             │  │              │
│ Folder     │ │ Job runner  │  │ CRUD +       │
│ picker &   │ │ orchestrates│  │ 30s tick     │
│ sandbox    │ │ the backup  │  │ loop         │
│ check      │ │ pipeline    │  │              │
└────────────┘ └──────┬──────┘  └──────┬───────┘
                      │                │
                      │  triggers backup via
                      │  runBackupFn callback
                      │◄───────────────┘
                      │
              ┌───────┼───────┐
              ▼       ▼       ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐
       │scanner.ts│ │manifest.ts│ │ webdav.ts│
       │          │ │          │ │          │
       │ Walk     │ │ Diff     │ │ MKCOL    │
       │ local    │ │ against  │ │ PUT      │
       │ files    │ │ state    │ │ PROPFIND │
       └──────────┘ └──────────┘ └──────────┘
                        │              │
                        ▼              ▼
                 .backup-state.json   Remote WebDAV
                 (local truth)         server
```

## Component Details

### Client — `src/client/main.ts`

A single TypeScript file compiled to `public/main.js` (no bundler, no framework). Uses the DOM API
directly. Three main UI concerns:

| Concern | What it does |
| --- | --- |
| **Folder browser** | Calls `/api/browse` to let the user navigate directories. Maintains a `selected` set persisted in `localStorage`. |
| **Backup controls** | Posts to `/api/backup`, then polls `/api/jobs/:id` every 500ms to show live progress (file count, bytes, failures). |
| **Schedule manager** | CRUD against `/api/schedules`. Renders schedule cards with enable/disable toggle, edit, run-now, and delete actions. |

All user-supplied strings are rendered with `textContent` (never `innerHTML`).

### Server — `src/server/`

Built entirely on `node:http` with zero runtime npm dependencies.

#### `index.ts` — HTTP Router & Entry Point

- Creates the HTTP server bound to `127.0.0.1` by default.
- Routes API requests to handler logic; serves static files from `public/`.
- Owns the in-memory **job registry** (`Map<string, Job>`), capped at 20 entries.
- Enforces a **single active job** constraint — returns `409` if a backup is already running.
- Validates all inputs (paths, schedule bodies, request size ≤ 1 MB).
- Instantiates the `Scheduler` and starts its tick loop on boot.

#### `config.ts` — Configuration

Loads settings from `backup.config.json` (or `$BACKUP_CONFIG`), with environment variable overrides
(`WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD`, `PORT`). A missing config file is non-fatal;
the server starts in "not configured" mode.

#### `backup.ts` — Backup Runner

`runBackup` is the core pipeline. For each source directory:

```
scanDirectory(source)
  → changedFiles(scanned, stateFile)
    → ensureDir + putFile for each changed file
      → record success in state → saveState
```

It mutates a `Job` object in place so the HTTP layer can serve live progress via polling.
Per-file errors are recorded in `job.failed`; only an unexpected error marks the whole job `failed`.

#### `scanner.ts` — Filesystem Walker

Recursively lists regular files under a root directory. Symlinks are not followed.
Unreadable entries are reported as `skipped`, not fatal.

#### `manifest.ts` — State & Diff Engine

- **`loadState` / `saveState`**: Reads and writes `.backup-state.json` atomically (temp file + rename).
- **`changedFiles`**: Compares scanned files against previously recorded `{size, mtimeMs}` entries.
  A file is re-uploaded when either value differs or the file is new.

The state file is the **sole source of truth** for incremental logic. The remote server is never listed.

#### `webdav.ts` — WebDAV Client

Hand-written on `node:http(s)`. Supports three operations:

| Method | Purpose |
| --- | --- |
| `MKCOL` | Create collections (directories), `mkdir -p` style. Caches known dirs per client instance. |
| `PUT` | Stream a local file to the remote. Uses `createReadStream` so large files aren't buffered. |
| `PROPFIND` | Connection check only (`Depth: 0` on the base URL). |

A new `WebDavClient` is created per backup job to reset the directory cache.

#### `browse.ts` — Folder Picker & Sandbox

- **`isAllowed`**: Checks whether a path falls inside the configured `browseRoots`. Empty roots = no restriction.
- **`listRoots`**: Returns configured roots, or drive letters on Windows / `"/"` on Unix.
- **`listDirs`**: Lists immediate subdirectories, sorted case-insensitively.

Applied to both browsing and backup requests.

#### `scheduler.ts` — Scheduled Backups

- **Persistence**: Schedules are stored in `backup-schedules.json` (atomic writes via temp + rename).
- **`computeNextRun`**: Pure function. Calculates the next run time based on recurrence, time, and
  days-of-week. "Once" schedules disable themselves after running.
- **`Scheduler` class**: CRUD operations plus a 30-second `setInterval` tick loop. On each tick,
  checks for due schedules and fires them through a `runBackupFn` callback (the same `triggerBackup`
  function used by manual backups). Respects the single-active-job constraint.

## Data Flow — Manual Backup

```
User clicks "Back up now"
  │
  ▼
POST /api/backup { paths: ["/home/user/docs"] }
  │
  ├─ Validate paths (absolute, allowed, exist)
  ├─ Check no active job (else 409)
  ├─ createJob(paths) → Job { id, status: "running", ... }
  ├─ Register in jobRegistry
  ├─ 202 { jobId } ← immediate response
  │
  └─ async: runBackup(job, { client, remoteRoot, stateFile })
       │
       ├─ loadState(".backup-state.json")
       │
       └─ for each source path:
            ├─ scanDirectory(source)         → FileEntry[]
            ├─ changedFiles(files, state)    → changed FileEntry[]
            ├─ client.ensureDir(remoteBase)
            └─ for each changed file:
                 ├─ client.ensureDir(parent)
                 ├─ client.putFile(remote, local, size)
                 ├─ update state entry on success
                 └─ record in job.failed on error
            └─ saveState() after each source

Client polls GET /api/jobs/:id every 500ms
  → reads the mutating Job object
  → renders progress bar, file counts, failures
  → stops polling when status ≠ "running"
```

## Data Flow — Scheduled Backup

```
Scheduler.tick() fires every 30 seconds
  │
  ├─ for each enabled schedule with nextRunAt ≤ now:
  │    ├─ skip if jobRegistry.active (another job is running)
  │    ├─ call runBackupFn(schedule.paths)
  │    │    └─ same triggerBackup() as manual backups
  │    ├─ update lastRunAt, lastRunStatus
  │    ├─ if recurrence = "once": disable schedule
  │    └─ else: computeNextRun() → update nextRunAt
  │
  └─ saveSchedules() if anything changed
```

## Remote Layout

Each source directory maps to a unique remote folder:

```
<remoteRoot>/
  <basename>-<8-char sha1>/
    <relative file paths...>
```

Example: backing up `/home/alice/Documents` with `remoteRoot = "backups"`:

```
backups/
  Documents-a1b2c3d4/
    report.pdf
    photos/
      vacation.jpg
```

The 8-character SHA-1 hash is derived from the absolute source path, so two folders named
`Documents` on different paths get distinct remote names.

## Build System

Two independent TypeScript compilations, no bundler:

```
tsconfig.json              tsconfig.client.json
  │                          │
  │ NodeNext ESM             │ ES2020, DOM
  │ src/server/**            │ src/client/main.ts
  │                          │
  ▼                          ▼
dist/server/               public/main.js
  index.js                   (single file, no bundle)
  backup.js
  scanner.js
  manifest.js
  webdav.js
  browse.js
  config.js
  scheduler.js
```

The server resolves `public/` as `../../public` relative to its own module, which works from both
`src/server/` (dev with tsx) and `dist/server/` (compiled).

## Security Boundaries

```
┌──────────────────────────────────────────┐
│            Trusted zone                  │
│                                          │
│  Server process (127.0.0.1 only)         │
│    ├─ browseRoots sandbox                │
│    │   (restricts FS access)             │
│    ├─ input validation                   │
│    │   (paths, body size, schedule       │
│    │    fields)                           │
│    └─ textContent rendering              │
│        (no innerHTML in client)          │
│                                          │
├──────────────────────────────────────────┤
│            System boundary               │
│                                          │
│  Local filesystem ◄── read-only scan     │
│  .backup-state.json ◄── atomic writes    │
│  backup-schedules.json ◄── atomic writes │
│                                          │
├──────────────────────────────────────────┤
│            External boundary             │
│                                          │
│  WebDAV server ◄── HTTPS + Basic Auth    │
│    (write-only: MKCOL, PUT, PROPFIND)    │
│    (nothing is ever deleted remotely)    │
│                                          │
└──────────────────────────────────────────┘
```

## Test Architecture

Tests use vitest with a custom in-memory WebDAV server (`test/fake-webdav.ts`) that handles
MKCOL, PUT, and PROPFIND on a random local port. This avoids mocking and tests the real HTTP path.

| Test file | Scope |
| --- | --- |
| `backup.test.ts` | End-to-end: creates temp directories, runs full backup cycles against fake WebDAV, verifies incremental logic and failure handling. |
| `scheduler.test.ts` | `computeNextRun` pure function, schedule CRUD with file persistence, tick integration. |
| `manifest.test.ts` | Manifest diffing (`changedFiles`) and atomic state file operations. |
| `webdav.test.ts` | WebDAV client unit tests (MKCOL, PUT, PROPFIND, error handling). |
| `fake-webdav.ts` | Test helper, not a test. In-memory WebDAV server with optional injected PUT failures. |
