# buildinator

A browser session manager for [Grok Build](https://github.com/xai-org/grok-build).

Buildinator — the app, VM, ACP UI, and themes — was built with Grok Bot.

Scott likes the TUI. This is that session manager in a browser: projects as sandboxes, a real chat transcript, artifacts on the right, and per-conversation sharing. Metadata lives in SQLite. Live grok talks ACP over stdio (`grok agent --always-approve stdio`). Thoughts, tokens, and tool cards stream into the pane. The HTTPS UI is the only internet-facing port; grok never binds a public socket.

Four themes (localStorage `buildinator-theme`, default `tui`). **TUI:** groknight (`tui`) and grokday. **web:** dark (`web`) and light. `t` cycles; the header picker groups them. Stored `default` maps to web. Font size is `font size: 12` in the header (dropdown 12/13/14/16, default 14, `buildinator-font-size`). Typing `/` in the composer lists `/help`, `/rename`, `/compact`, and `/rewind`. `?` / Ctrl+. / F2 opens Keyboard Shortcuts. `!` on an empty composer runs a sandbox shell.

## Run it

```bash
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:3000

Production: `npm run build` then `npm start` (Next standalone). Copy `.env.example` and set `AUTH_SECRET`.

`GROK_HOME` is grok's **config dir**, not `$HOME`. Set it separately from `BUILDINATOR_ROOT` (it is not inferred). On the VM: `GROK_HOME=/mnt/buildinator/grok` (that is `$BUILDINATOR_ROOT/grok`) and `GROK_BIN` pointing at that tree's `bin/grok`. Local-dev can keep `GROK_HOME` at a `.grok` dir such as `/opt/buildinator/.grok`.

## Persistence (`BUILDINATOR_ROOT`)

Set `BUILDINATOR_ROOT` (for example `/mnt/buildinator`) so sqlite, workspaces, and grok state live on a disk that survives VM replacement. Do not hardcode `/var/lib/buildinator`.

| Path | What |
| --- | --- |
| `$BUILDINATOR_ROOT/data` | sqlite (`buildinator.sqlite`) + transcripts |
| `$BUILDINATOR_ROOT/projects` | workspaces (today's sandboxes). **Not** nested under `data/`. |
| `$BUILDINATOR_ROOT/grok` | `GROK_HOME` — login + ACP session blobs. Set `GROK_HOME` in `.env` yourself. |

If `BUILDINATOR_ROOT` is **unset** (local-dev): sqlite + transcripts at `./data`, workspaces at `./data/sandboxes`. Display cwd stays `~/projects/<name>` either way.

## Adapters (`GROK_ADAPTER`)

| Value | What it does |
| --- | --- |
| `acp` | Spawn `grok agent --always-approve stdio`. `session/new` + `session/prompt`; `session/update` streams over SSE at `GET /api/sessions/:id/events`. Default in `.env.example`. |
| `cli` / `grok` | One-shot `grok -p --always-approve`. Full reply when the process exits. |
| `mock` | Canned replies. No grok binary. |
| `remote` | Throws. HTTP/WebSocket `GROK_ACP_URL` (`grok agent serve`) is not wired. |

ACP is stdio only. Do not publish an ACP port.

## Roles

Three account roles in the same SQLite `users` table (`users.role`). Role is a ceiling: a `read` user cannot prompt even if someone later shares a conversation as write.

| Role | What they can do |
| --- | --- |
| `admin` | Everything a write user can, plus user CRUD (header **users** panel). Can manage users even without owning a session. |
| `write` | Own projects/sessions, prompt, share own conversations, compact/rewind/cancel on write sessions. Today's default. |
| `read` | Log in and see sessions shared with them. Cannot create projects or sessions. Cannot prompt, cancel, compact, rewind, or share. Composer is locked. |

Session shares stay per conversation (`read` vs `write`) for write/admin users. Only the owner may share or delete a session.

Empty database seed: `scott` / `buildinator` as **admin**, `craig` / `buildinator` as **write**. Guest is not seeded and there is no guest login. Existing databases: `scott` is promoted to admin; the `guest` user and their shares are deleted on migrate; `craig` is inserted as write if missing. Admins create further users from the **users** panel (username, password, role; change role, reset password, disable, remove). The last admin cannot be deleted, demoted, or disabled.

Write users cannot create sessions inside someone else's project. Share is per conversation, not per project.

## Sharing

1. Sign in as the owner. Open a session. **share** → username + `read-only` or `read-write`.
2. The other user sees it under **shared with me**.
3. Read-only: live chat + artifacts, composer locked. Read-write: prompt, cancel in-flight turn, rename, compact, rewind. Owner-only: share, delete, destroy sandbox.

If two people have the same session open, they share one grok ACP turn. The server fans `session/update` to every EventSource on that session. Sidebar-only is a snapshot until they click in.

## Chat behavior

- Composer stays at the bottom, including empty sessions. Extra prompts queue and send in order (TUI-like).
- Cancel an in-flight ACP turn (Esc, header **cancel**, or `POST /api/sessions/:id/actions` `{ "type": "cancel" }`). Sends ACP `session/cancel`; does not kill `grok agent`. Queued follow-ups still send after the cancelled turn settles.
- Untitled sessions (`New session`) take a title from the first prompt. `/rename` still wins. Resume/fork live on the session row, not as slashes.
- Assistant markdown renders: GFM tables, fenced code, **bold**, headings. LaTeX `\\[ \\]`, `$$`, `\\( \\)` via KaTeX. Bare `$` prices stay text.
- Thoughts are a collapsible `<details>` (diamond + `Thinking 3.1s` while that phase is live, `Thought for 4.2s` when it ends). Full thought text is inside, wrapped, never ellipsized. The dropdown stays open while that thought is streaming, then closes like the TUI.
- Header activity chip is a runtime overlay (`idle` / `thinking 4.2s` / `working 26s` / `writing`), plus `updated Ns ago` so a stall is obvious. Driven by live SSE (last event kind + timestamps), not sqlite `session.status` alone. `session.status` stays `idle|running|error` in the DB. The chip never shows idle while a turn is sending, sqlite is running, or a tool is pending.
- Transcripts persist under `dataRoot()/transcripts/<sessionId>.json` (`./data/transcripts` locally, `$BUILDINATOR_ROOT/data/transcripts` when set). SQLite indexes sessions including `acp_session_id` so `session/load` can resume grok's on-disk session under `GROK_HOME` after restart.
- Refresh keeps the ACP session; we session/load the stored id; we only session/new when grok has no such session, and then we rehydrate from the UI transcript.
- Live activity (thinking / working / writing) is pinned at the tail of the transcript, just above the composer. Consecutive identical tool runs collapse to one row (latest status); a different name starts a new line.
- Artifacts **files** list the project sandbox on disk (not transcript mining). Refresh survives bash writes. Download uses `?path=` jailed to that sandbox. Selected session stays in localStorage.

## Deploy (one VM)

HTTPS UI is the only internet port (Caddy/nginx on 443 → Next on loopback 3000). systemd `User=buildinator`, `WorkingDirectory` the app root, `BUILDINATOR_ROOT=/mnt/buildinator` on a persistent disk (`data/`, `projects/`, `grok/`). Caddy `reverse_proxy` should set `flush_interval -1` so SSE is not buffered.

Grok runs as that same user with `GROK_ADAPTER=acp` and a consumer `grok login`. Always-approve for tools in the project sandbox.

See `Dockerfile` / `docker-compose.yml` for a containerized variant. Compose still mentions `GROK_ACP_URL`; live mode is stdio, not that URL.

## What works

- Cookie JWT auth, scrypt passwords. Role is loaded from SQLite on each request (not trusted from the JWT). Google SSO is on hold. Failed logins are delayed; repeated failures 429.
- SQLite WAL at `dataRoot()/buildinator.sqlite` (`./data/...` locally, `$BUILDINATOR_ROOT/data/...` when set).
- Workspaces `projectsRoot()/<userId>/<projectId>/` (`./data/sandboxes/...` locally, `$BUILDINATOR_ROOT/projects/...` when set). Cross-project deps only via explicit links at `deps/<name>`.
- ACP stdio + SSE streaming (thoughts, tokens, tools, plan artifact). EventSource reconnects with backoff; the server replays a per-session ring of recent events, then continues live. Opening (or reconnecting) SSE also refetches `GET /api/sessions/:id` so missed chunks appear without a manual refresh.
- Cancel in-flight ACP turn via `session/cancel` (write/owner). Mock running turns go idle; one-shot `grok -p` cannot cancel mid-process.
- Session autotitle, queued composer, markdown+math in the transcript.
- Account roles admin / write / read. Session shares owner / write / read.
- Admin **users** panel (list, add, role, password, disable, remove).

## Still open

- `RemoteGrokAdapter` / `grok agent serve` (loopback WebSocket).
- Permission prompts (ACP auto-allows).
- Fork starts a new ACP session. `/compact` and `/rewind` talk to grok (`_x.ai/compact_conversation`, `_x.ai/rewind/execute` conversation_only).
- Google SSO.
- `package-lock.json` is not in git yet; `npm install` from `package.json` is enough.

See PLAN.md, DESIGN.md, and QUESTIONS.md.

## Layout

    src/app/            App Router pages plus API routes
    src/components/     Shell, sidebar, chat, artifacts, theme
    src/lib/            auth, sqlite, acl, grok ACP/cli, transcripts
    src/middleware.ts   cookie gate for /app and /api
    data/               local-dev sqlite, sandboxes, transcripts (gitignored)
    $BUILDINATOR_ROOT   VM: data/ + projects/ + grok/ on persistent disk
