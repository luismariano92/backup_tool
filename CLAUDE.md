# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small demo web app (TypeScript, Node.js 20+) that lets a user pick local directories in a browser
UI and back them up incrementally to a WebDAV server. Runtime has **zero npm dependencies**: the
server is plain `node:http`, the WebDAV client is hand-written on `node:http(s)`, and the frontend is
plain DOM code with no framework or bundler. Keep it that way unless asked: minimal setup is a goal.

## Commands

```sh
npm install
npm run dev            # compiles the client once, then runs the server with tsx watch (http://127.0.0.1:3000)
npm run dev:client     # run alongside `dev` to recompile the client on change
npm run build          # tsc server -> dist/, client -> public/main.js
npm start              # run the compiled server
npm test               # vitest, all tests
npx vitest run test/backup.test.ts            # one file
npx vitest run -t "only changed files"        # tests matching a name
npm run typecheck      # both tsconfigs, no emit (vitest does not type-check)
```

Config comes from `backup.config.json` (copy `backup.config.example.json`; gitignored) or
`WEBDAV_URL` / `WEBDAV_USERNAME` / `WEBDAV_PASSWORD` / `PORT` / `BACKUP_CONFIG` env vars. The server
starts without WebDAV configured; the UI then shows "not configured" and backup is disabled.

## Architecture

Two separate TypeScript builds:
- `tsconfig.json` → `src/server/**` (NodeNext ESM; relative imports must use `.js` extensions).
- `tsconfig.client.json` → `src/client/main.ts` compiled straight into `public/main.js` (generated,
  gitignored). `public/index.html` and `public/style.css` are hand-written source files.
  The server finds `public/` as `../../public` relative to its own module, which holds for both
  `src/server` (tsx) and `dist/server` (compiled).

Server flow (`src/server/`):
- `index.ts` — HTTP routing, static files, input validation, and the in-memory job registry.
  API: `GET /api/status`, `GET /api/check` (PROPFIND), `GET /api/browse?path=`,
  `POST /api/backup {paths}` → `202 {jobId}`, `GET /api/jobs/:id`. Only **one backup job runs at a
  time** (409 otherwise) because jobs read-modify-write the shared state file.
- `backup.ts` — `runBackup` mutates a `Job` object in place; the UI polls `/api/jobs/:id` every
  500 ms to show progress. Per-file errors go into `job.failed` and the job continues; only an
  unexpected error marks the whole job `failed`.
- `scanner.ts` → `manifest.ts` → `webdav.ts`: walk the source (symlinks not followed), diff against
  the state file, upload with `MKCOL` (mkdir -p) + streamed `PUT`.
- `browse.ts` — folder picker listing and the `browseRoots` sandbox check (`isAllowed`), applied to
  both browsing and backup requests.

Incremental backup semantics (important when changing `backup.ts`/`manifest.ts`):
- The local state file (`.backup-state.json`) is the only source of truth. A file is re-uploaded
  when its size or mtime differs from what was recorded. The remote is never listed or compared.
- A file is recorded **only after** its PUT succeeds, so failed uploads retry next run. State is
  saved after each source and written atomically (temp file + rename).
- Remote layout: `<remoteRoot>/<basename>-<8-char sha1 of absolute path>/<relPath>`
  (`remoteNameFor`). Changing this function orphans existing remote backups.
- Nothing is ever deleted on the server.
- A `WebDavClient` caches which collections exist, so a new client is created per job.

Security: the server can read any folder the user can, so it binds to `127.0.0.1` by default and
`browseRoots` can restrict it further. Client code renders file names with `textContent`, not
`innerHTML`.

## Tests

`test/fake-webdav.ts` is an in-memory WebDAV server (MKCOL/PUT/PROPFIND, optional injected PUT
failures) on a random port. `backup.test.ts` uses it for end-to-end incremental runs against
temp directories. Prefer it over mocking `WebDavClient`.

## Agent Teams — Implementation Pipeline

All implementation tasks (new features, bug fixes, refactors that change behavior) MUST use the
four-agent pipeline defined in `.claude/agents/`. The pipeline runs automatically — do not skip
stages or combine agents.

### Pipeline stages

1. **Researcher** (`.claude/agents/researcher.md`)
   Analyzes the task, studies the codebase, and produces a detailed implementation plan.
   Does NOT write code. Output: structured plan with files, steps, tests, security notes.

2. **Implementer** (`.claude/agents/implementer.md`)
   Implements the Researcher's plan step by step. Writes code and tests. Updates `README.md`
   to reflect any user-visible changes (new features, endpoints, config, modules). Runs
   typecheck, tests, and build to verify. Fixes any issues the Validator reports.

3. **Validator** (`.claude/agents/validator.md`)
   Reviews for correctness, security, performance, and clean code. Verifies test coverage
   >= 80% and that `README.md` accurately reflects the implemented changes. If defects are
   found, sends them back to the Implementer. Repeats until all criteria pass.
   Output: Validation Report (PASSED/FAILED).

4. **Finalizer** (`.claude/agents/finalizer.md`)
   Commits with a conventional commit message and pushes. No user confirmation needed.
   Never pushes to main/master directly.

### How to run the pipeline

When an implementation task is received, execute the pipeline in order:

```
User request
  → spawn Researcher agent → receives implementation plan
  → spawn Implementer agent (with the plan) → code is written
  → spawn Validator agent → reviews code
     ↳ if defects found → send back to Implementer → re-validate (loop)
  → spawn Finalizer agent → commit & push
```

Each agent is spawned via the `Agent` tool with `subagent_type` matching the agent name
(`researcher`, `implementer`, `validator`, `finalizer`). Pass the full context each agent
needs in the prompt — agents start fresh with no prior conversation context.

### When NOT to use the pipeline

- Questions, explanations, or exploratory discussions (no code changes)
- Trivial fixes (typos, comment-only changes, config tweaks)
- When the user explicitly says to skip the pipeline
