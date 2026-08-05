# Desktopy OS — PHP Backend

The entire backend is **one file**: [`public/api.php`](../public/api.php). It runs
anywhere PHP runs and powers every file-system and persistence feature of the OS:

- **State persistence** — the whole desktop (theme, language, accent, open
  windows, window positions/sizes, minimized/maximized, z-order, notes,
  terminal history) survives reloads via `public/data/state.json`.
- **Sandboxed file system** — `ls`, `read`, `write`, `mkdir`, `rm`, `mv`
  scoped to `public/data/` (the OS "disk"), used by the Files app and Terminal.
- **Disk stats** — used by the desktop System widget.

## How it runs

| Mode | Command | Notes |
| --- | --- | --- |
| PHP built-in server | `php -S localhost:3000 -t public` | Preferred — serves static + PHP natively |
| Node + PHP | `node serve.mjs` | `serve.mjs` routes `*.php` requests to the PHP CLI, so the whole app works with one Node process |
| CLI (internal) | `php public/api.php '<json>'` | `serve.mjs` invokes this with a `{method, query, body}` envelope in `argv[1]` |

## Endpoints

All requests go to `api.php?action=<action>`. Every response is JSON:

```json
{ "ok": true, ... }
```

### State

| Action | Method | Params / Body | Response |
| --- | --- | --- | --- |
| `state` | GET | — | `{ ok, fresh, data }` — `fresh: true` on first run |
| `state` | POST | `{ "data": { ...snapshot } }` | `{ ok, data }` — persists the full desktop snapshot |
| `reset` | POST | — | `{ ok, fresh: true, data }` — wipes `state.json` |

The frontend always sends the **complete** snapshot, so a `windows: {}` map
genuinely persists as "nothing open". The snapshot shape:

```json
{
  "theme": "dark", "lang": "ar", "accent": "indigo",
  "launcher": false, "notes": "", "history": [],
  "zIndex": 106,
  "windows": {
    "terminal": { "x": 40, "y": 70, "w": 680, "h": 440,
                  "minimized": false, "maximized": false, "z": 100 }
  }
}
```

### File system (sandbox root: `public/data/`, default dir: `home`)

| Action | Method | Params / Body | Response |
| --- | --- | --- | --- |
| `ls` | GET | `path` (default `home`) | `{ ok, path, entries: [{ name, path, type, size, mtime }] }` |
| `read` | GET | `path` | `{ ok, path, content }` |
| `write` | POST | `{ path, content }` | `{ ok, path }` — creates parent dirs |
| `mkdir` | POST | `{ path }` | `{ ok, path }` |
| `rm` | POST | `{ path }` | `{ ok }` — files or empty dirs only |
| `mv` | POST | `{ path, dest }` | `{ ok, path }` — rename/move |
| `disk` | GET | — | `{ ok, total, files }` |

### Meta

| Action | Method | Response |
| --- | --- | --- |
| `ping` | GET | `{ ok, service, php }` |
| *(no action)* | GET | API index — `{ service, version, php, actions }` |

## Security

- **Path sandboxing** — every path is resolved with `realpath` checks and must
  stay inside `public/data/`. Traversal (`../..`, absolute paths) is rejected
  with `403` (covered by an e2e test).
- **Protected files** — `state.json` is managed only by the state API.
- **Size caps** — reads/writes are limited to 2 MB.
- **First-run seed** — `home/` is seeded with a few demo files so the Files app
  and Terminal have something to explore on first boot.

## Data layout

```
public/
  api.php          # the whole backend
  index.html       # the whole frontend
  data/            # runtime data (gitignored)
    state.json     # persisted desktop state
    home/          # the OS "disk" — user files
```
