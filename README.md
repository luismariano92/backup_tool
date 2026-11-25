# WebDAV Backup

A small web app for backing up local folders to a WebDAV server (Nextcloud, ownCloud, Synology,
Apache `mod_dav`, etc.). Pick directories in the browser UI and back them up on demand or on a
schedule. Backups are incremental — only new or changed files are uploaded on each run.

Built with TypeScript and Node.js 20+. Zero runtime npm dependencies: the HTTP server, WebDAV
client, and browser UI are all written from scratch with no frameworks or bundlers.

## Setup

```sh
npm install
cp backup.config.example.json backup.config.json   # then fill in your WebDAV URL and credentials
npm run dev
```

Open http://127.0.0.1:3000, browse to the folders you want, tick them, and press **Back up now**.

Alternatively, run `./start.sh` which installs dependencies if needed and starts the dev server.

## Configuration

Config is loaded from `backup.config.json` (copy `backup.config.example.json`; gitignored) or
from environment variables.

### Config file (`backup.config.json`)

| Key | Default | Description |
| --- | --- | --- |
| `host` | `127.0.0.1` | Bind address. Keep it on localhost — the server can read any folder it is allowed to browse. |
| `port` | `3000` | HTTP port for the web UI. |
| `webdav.url` | — | Base WebDAV URL (e.g. `https://dav.example.com/remote.php/dav/files/alice`). |
| `webdav.username` | — | WebDAV HTTP Basic auth username. |
| `webdav.password` | — | WebDAV HTTP Basic auth password. |
| `webdav.remoteRoot` | `backups` | Folder under `url` that holds all backups. |
| `browseRoots` | `[]` (whole machine) | Restrict browsing and backup to these directories only. |
| `stateFile` | `.backup-state.json` | Local record of what has been uploaded (drives incremental backups). |
| `schedulesFile` | `backup-schedules.json` | Local file storing scheduled backup definitions. |

### Environment variables

These override the config file:

- `WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD` — WebDAV connection details.
- `PORT` — HTTP port.
- `BACKUP_CONFIG` — Path to a custom config file (instead of `backup.config.json`).

The server starts without WebDAV configured; the UI shows "not configured" and backup is disabled.

## Features

### Manual backup

Browse your filesystem in the left panel, select folders, and press **Back up now**. Progress
is shown in real time with per-file error reporting.

### Scheduled backups

Create named backup schedules that run automatically:

- **Recurrence**: Once, Daily, or Weekly.
- **Daily schedules**: Select specific days of the week (e.g. Mon/Wed/Fri).
- **Weekly schedules**: Runs on the same weekday as when the schedule was created.
- **Time**: Set the execution time in 24-hour format.
- **Enable/Disable**: Toggle schedules on and off without deleting them.
- **Run Now**: Manually trigger any schedule immediately.

Schedules are persisted to `backup-schedules.json` and survive server restarts. The scheduler
checks for due jobs every 30 seconds. Only one backup job (manual or scheduled) runs at a time.

### Incremental backup

- Files are tracked by size and modification time in `.backup-state.json`.
- Only files whose size or mtime differ from the last run are re-uploaded.
- Failed uploads are retried on the next run (a file is recorded only after its PUT succeeds).
- Files deleted locally are **not** deleted on the server.
- Each source folder is uploaded to `<remoteRoot>/<folder-name>-<hash>/`, preserving its
  directory structure.
- To force a full re-upload, delete the state file.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Compile client once, then start the server with tsx watch (auto-reload). |
| `npm run dev:client` | Watch-mode client compilation (run alongside `dev` for live client rebuilds). |
| `npm run build` | Compile server to `dist/` and client to `public/main.js`. |
| `npm start` | Run the compiled server from `dist/`. |
| `npm test` | Run all tests with vitest. |
| `npm run typecheck` | Type-check both server and client tsconfigs without emitting. |

Run a single test file or by name:

```sh
npx vitest run test/backup.test.ts
npx vitest run -t "only changed files"
```

## Architecture

For a detailed architecture document with data-flow diagrams and component breakdowns, see
[docs/architecture.md](docs/architecture.md).

### Build system

Two separate TypeScript compilations:

- `tsconfig.json` — Server code (`src/server/**`) targeting NodeNext ESM. Emits to `dist/server/`.
- `tsconfig.client.json` — Client code (`src/client/main.ts`) compiled to `public/main.js` (no
  bundler). The HTML and CSS in `public/` are hand-written source files.

### Server (`src/server/`)

| Module | Responsibility |
| --- | --- |
| `index.ts` | HTTP routing, static file serving, input validation, job registry, schedule API routes. |
| `config.ts` | Load and merge config from file and environment variables. |
| `backup.ts` | `runBackup` — drives the backup pipeline, mutates a `Job` object for progress tracking. |
| `scanner.ts` | Filesystem walker (symlinks not followed). |
| `manifest.ts` | Diff engine — compares scanned files against the state file to find changes. Atomic state persistence. |
| `webdav.ts` | Hand-written WebDAV client (MKCOL, PUT, PROPFIND) over `node:http(s)`. |
| `browse.ts` | Folder picker listing and `browseRoots` sandbox enforcement. |
| `scheduler.ts` | Schedule persistence, `computeNextRun` logic, `Scheduler` class with 30-second tick loop and CRUD. |

### Client (`src/client/main.ts`)

Plain DOM code (no framework). Provides the folder browser, backup selection, progress display,
and schedule management UI. All user-supplied strings are rendered with `textContent` (no
`innerHTML`).

### API endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/status` | Server config status and active job ID. |
| `GET` | `/api/check` | Test WebDAV connection (PROPFIND). |
| `GET` | `/api/browse?path=` | List directories for the folder picker. |
| `POST` | `/api/backup` | Start a manual backup. Body: `{ paths: string[] }`. Returns `202 { jobId }`. |
| `GET` | `/api/jobs/:id` | Poll backup job progress. |
| `GET` | `/api/schedules` | List all scheduled backups. |
| `GET` | `/api/schedules/:id` | Get one scheduled backup. |
| `POST` | `/api/schedules` | Create a schedule. Body: `{ name, paths, time, recurrence, daysOfWeek?, enabled }`. |
| `PUT` | `/api/schedules/:id` | Update a schedule. |
| `DELETE` | `/api/schedules/:id` | Delete a schedule. |
| `POST` | `/api/schedules/:id/run` | Manually trigger a scheduled backup immediately. |

### Tests (`test/`)

| File | What it tests |
| --- | --- |
| `fake-webdav.ts` | In-memory WebDAV server (MKCOL/PUT/PROPFIND, optional injected PUT failures). |
| `backup.test.ts` | End-to-end incremental backup runs against temp directories + fake WebDAV. |
| `scheduler.test.ts` | `computeNextRun` pure function, schedule CRUD with persistence, tick integration. |
| `manifest.test.ts` | Manifest diffing and state file operations. |
| `webdav.test.ts` | WebDAV client unit tests. |

## Security

- The server binds to `127.0.0.1` by default — it can read any folder accessible to the
  process, so exposing it to the network is not recommended.
- `browseRoots` restricts which directories can be browsed and backed up.
- All API inputs are validated (paths, schedule fields, body size limits).
- The client renders all user-supplied text with `textContent`, never `innerHTML`.

## Project structure

```
backup-tool/
  public/
    index.html          # Hand-written HTML
    style.css           # Hand-written CSS
    main.js             # Compiled from src/client/ (gitignored)
  src/
    client/
      main.ts           # Browser UI
    server/
      index.ts          # HTTP server & routing
      config.ts         # Configuration loading
      backup.ts         # Backup runner
      scanner.ts        # Filesystem walker
      manifest.ts       # State diffing & persistence
      webdav.ts         # WebDAV client
      browse.ts         # Folder picker & sandbox
      scheduler.ts      # Scheduled backup engine
  test/
    fake-webdav.ts      # Test helper: in-memory WebDAV server
    backup.test.ts      # Backup integration tests
    scheduler.test.ts   # Scheduler tests
    manifest.test.ts    # Manifest tests
    webdav.test.ts      # WebDAV client tests
  backup.config.example.json
  tsconfig.json         # Server build config
  tsconfig.client.json  # Client build config
  package.json
  start.sh              # Quick-start script
```
