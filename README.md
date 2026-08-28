# buildinator

A browser frontend for managing Grok Build sessions
(https://github.com/xai-org/grok-build).

Scott likes the TUI. This is the session manager in a browser: every
session grouped by project sandbox, a real chat transcript, artifacts
on the right, and session sharing. Metadata lives in SQLite. Grok ACP
is still a loopback stub — nothing is spawned yet.

## Run it

Copy .env.example to .env. Then fetch packages and start Next in dev mode (see package.json scripts). Production uses the build and start scripts.

Open http://localhost:3000

## Demo users

- `scott` / `buildinator` — owns both projects and all seed sessions
- `guest` / `guest` — read-write on "Bootstrap grok host on Fly.io",
  read-only on "nginx ACP reverse proxy"

## Sharing demo

1. Sign in as scott. Open an infra session. Share is already seeded,
   or use **share** to add `guest` as read-only / read-write.
2. Log out, sign in as guest. Sidebar **shared with me** lists those
   two infra sessions. Read-write can prompt / rename / compact /
   rewind. Read-only sees chat + artifacts; the composer says
   `read only`.
3. New session: **+ new** (or `n`) and pick a project you **own**.
   That writes a SQLite row and creates
   `data/sandboxes/<userId>/<projectId>/`.

Session sharing shares the grok session (chat / tools / artifacts),
not a second login on the host filesystem.

## Deploy (one VM)

`web` publishes 3000. Put Caddy/nginx in front for HTTPS on 443 — that
is the only port that should face the internet.

Grok ACP is a sidecar bound to 127.0.0.1 (`GROK_ACP_URL`). Do not
publish that port. See `docker-compose.yml`.

## What you get in v1

- Cookie JWT auth. Passwords hashed with scrypt. Google SSO is on hold.
- SQLite at `data/buildinator.sqlite` (WAL). Users, projects, links,
  sessions, shares persist. Transcripts are still mock/in-memory.
- Multi-tenant ACL: owner / read-write / read-only.
- Sandboxes under `data/sandboxes/<userId>/<projectId>/`. Cross-project
  deps mount at `deps/<name>` (seed: buildinator → infra).
- Grok Night TUI is the default theme (screenshot-matched). Previous
  dark UI is the `web` theme (`t`).
- Slash commands in the composer: `/help`, `/rename`, `/compact`,
  `/rewind`. **resume** and **fork** are session-row actions.
- `RemoteGrokAdapter` stub. Loopback ACP only, not live.

## Limitations

- Mock backend. Nothing speaks ACP, nothing starts grok.
- Transcripts reset on process restart; session index does not.
- Prompt replies are canned.

See PLAN.md, DESIGN.md, and QUESTIONS.md.

## Layout

    src/app/            App Router pages plus API routes
    src/components/     Shell, sidebar, chat, artifacts, theme
    src/lib/            auth, sqlite, acl, adapter
    src/middleware.ts   cookie gate for /app and /api
    data/               sqlite + sandboxes (gitignored)
