# WebDAV Backup

A small web app for demos: pick local folders in the browser and back them up to a WebDAV server
(Nextcloud, ownCloud, Synology, Apache `mod_dav`, …). Backups are incremental — only new or
changed files are uploaded on each run.

## Setup

Requires Node.js 20+.

```sh
npm install
cp backup.config.example.json backup.config.json   # then fill in your WebDAV URL and credentials
npm run dev
```

Open http://127.0.0.1:3000, browse to the folders you want, tick them, and press **Back up now**.

Credentials can also come from the environment instead of the config file:
`WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD` (and `PORT`, `BACKUP_CONFIG` for the config path).

## Configuration (`backup.config.json`)

| Key | Default | Meaning |
| --- | --- | --- |
| `host` / `port` | `127.0.0.1` / `3000` | Where the web UI listens. Keep it on localhost: the server can read any folder it is allowed to browse. |
| `webdav.url` | — | Base WebDAV URL. |
| `webdav.username` / `password` | — | HTTP Basic auth. |
| `webdav.remoteRoot` | `backups` | Folder under `url` that holds all backups. |
| `browseRoots` | `[]` (whole machine) | Restrict browsing and backup to these directories. |
| `stateFile` | `.backup-state.json` | Local record of what has been uploaded. |

## How it works

Each selected folder is uploaded to `<remoteRoot>/<folder-name>-<hash>/`, keeping its structure.
After each successful upload the file's size and modification time are stored in the state file;
next time, only files whose size or mtime differ are sent again. Files deleted locally are **not**
deleted on the server. If the remote copy is wiped, delete the state file to force a full re-upload.

## Scripts

`npm run dev` · `npm run build` / `npm start` · `npm test` · `npm run typecheck`
