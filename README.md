# buildinator

A browser session manager for [Grok Build](https://github.com/xai-org/grok-build).

Scott likes the TUI. This is that session manager in a browser: projects as sandboxes, a real chat transcript, artifacts on the right, and per-conversation sharing. Metadata lives in SQLite. Live grok talks ACP over stdio (`grok agent --always-approve stdio`). Thoughts, tokens, and tool cards stream into the pane. The HTTPS UI is the only internet-facing port; grok never binds a public socket.

Default theme is Grok Night (charcoal, `>` prompts, teal identifiers). `t` flips to the older `web` theme.

## Run it

```bash
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:3000

Production: `npm run build` then `npm start` (Next standalone). Copy `.env.example` and set `AUTH_SECRET`.

`GROK_HOME` is grok's **config dir** (`~/.grok`), not `$HOME`. A logged-in grok CLI needs `GROK_HOME=/path/to/.grok` (for example `/opt/buildinator/.grok`) and `GROK_BIN` pointing at that tree's `bin/grok`.

## Adapters (`GROK_ADAPTER`)

| Value | What it does |
| --- | --- |
| `acp` | Spawn `grok agent --always-approve stdio`. `session/new` + `session/prompt`; `session/update` streams over SSE at `GET /api/sessions/:id/events`. Default in `.env.example`. |
| `cli` / `grok` | One-shot `grok -p --always-approve`. Full reply when the process exits. |
| `mock` | Canned replies. No grok binary. |
| `remote` | Throws. HTTP/WebSocket `GROK_ACP_URL` (`grok agent serve`) is not wired. |

ACP is stdio only. Do not publish an ACP port.

## Demo users

Seeded on an empty database:

- `scott` / `buildinator` — owns the seed projects
- `guest` / `guest` — used for share demos

Anyone can create **their own** projects and sessions. They cannot create sessions inside someone else's project. Share is per conversation, not per project.

## Sharing

1. Sign in as the owner. Open a session. **share** → username + `read-only` or `read-write`.
2. The other user sees it under **shared with me**.
3. Read-only: live chat + artifacts, composer locked. Read-write: prompt, rename, compact, rewind. Owner-only: share, delete, destroy sandbox.

If two people have the same session open, they share one grok ACP turn. The server fans `session/update` to every EventSource on that session. Sidebar-only is a snapshot until they click in.

## Chat behavior

- Composer stays at the bottom, including empty sessions. Extra prompts queue and send in order (TUI-like).
- Untitled sessions (`New session`) take a title from the first prompt. `/rename` still wins. Resume/fork live on the session row, not as slashes.
- Assistant markdown renders: GFM tables, fenced code, **bold**, headings. LaTeX `\\[ \\]`, `$$`, `\\( \\)` via KaTeX. Bare `$` prices stay text.
- Transcripts persist at `data/transcripts/<sessionId>.json` (survive process restart). SQLite holds users, projects, sessions, shares.

## Deploy (one VM)

HTTPS UI is the only internet port (Caddy/nginx on 443 → Next on loopback 3000). systemd `User=buildinator`, `WorkingDirectory` the app root, `data/` on a persistent disk (sqlite + sandboxes + transcripts).

Grok runs as that same user with `GROK_ADAPTER=acp` and a consumer `grok login`. Always-approve for tools in the project sandbox.

See `Dockerfile` / `docker-compose.yml` for a containerized variant. Compose still mentions `GROK_ACP_URL`; live mode is stdio, not that URL.

## What works

- Cookie JWT auth, scrypt passwords. Google SSO is on hold.
- SQLite WAL at `data/buildinator.sqlite`.
- Sandboxes `data/sandboxes/<userId>/<projectId>/`. Cross-project deps only via explicit links at `deps/<name>`.
- ACP stdio + SSE streaming (thoughts, tokens, tools, plan artifact).
- Session autotitle, queued composer, markdown+math in the transcript.
- Share roles owner / write / read.

## Still open

- `RemoteGrokAdapter` / `grok agent serve` (loopback WebSocket).
- Permission prompts (ACP auto-allows).
- `/compact` and `/rewind` are stubs. Fork starts a new ACP session.
- Google SSO.
- `package-lock.json` is not in git yet; `npm install` from `package.json` is enough.

See PLAN.md, DESIGN.md, and QUESTIONS.md.

## Layout

    src/app/            App Router pages plus API routes
    src/components/     Shell, sidebar, chat, artifacts, theme
    src/lib/            auth, sqlite, acl, grok ACP/cli, transcripts
    src/middleware.ts   cookie gate for /app and /api
    data/               sqlite, sandboxes, transcripts (gitignored)
