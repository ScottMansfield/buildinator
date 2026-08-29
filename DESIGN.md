# Design

## Locked decisions (2026-08-28)

1. One machine. HTTPS web UI is the only internet-facing port. Grok ACP
   binds 127.0.0.1. Local IPC is ACP on loopback
   (GROK_ACP_URL=http://127.0.0.1:<port>).
2. New session in the UI creates a real SQLite row + sandbox cwd.
   Rename from the UI and via /rename.
3. Multi-tenant even with one human. Sessions isolated by user.
   Owner can share a session as read-only or read-write. Only the owner
   may delete the session, revoke all shares, or destroy the sandbox.
   Read-write: prompts, rename, /compact, /rewind. Read-only: chat +
   artifacts.
4. Projects are sandboxes under data/sandboxes/<userId>/<projectId>/.
   No arbitrary host path, no `..` traversal. Cross-project in-dev deps
   are explicit links to other registered projects, mounted at
   deps/<name>. Sharing is the grok session, not a host FS login.
5. Deployable to one VM you can resize. Dockerfile / compose.
   Not Vercel-first.
6. Hold Google SSO. Username/password stays.
7. Real session/project/share/user metadata in SQLite (WAL,
   better-sqlite3). Transcripts may stay mock-in-memory.
8. TUI skin matches Grok Night (screenshot): charcoal/black, monospace,
   `>` user prefix, timestamps on the right, dim action lines, teal
   identifiers, model + variant bottom-right, path + context meter in
   the header, block cursor on the composer.

/resume and /fork are **not** in-session slashes — they live on the
session row because they deal with things outside the current session.

## Stack

Next.js App Router + TypeScript + Tailwind + better-sqlite3.

- App Router: pages and API in one process.
- Middleware: cookie JWT gate (jose). Edge-safe; sqlite stays in Node
  route handlers.
- TUI is data-theme=tui (default). web is the previous amber dark UI.

## Information architecture

Unauthenticated → /login. Authenticated → /app.

Three panes:

1. Left — owned projects (new session lives here) and **shared with me**.
2. Center — transcript + composer (`>` in TUI). Read-only replaces the
   composer.
3. Right — artifacts. Collapsible (`[` / `]`).

## Data model (SQLite)

data/buildinator.sqlite (gitignored). WAL + busy_timeout=5000.

- users — id, username, scrypt password hash, role (admin|write|read),
  disabled
- projects — id, owner_id, name (sandbox path derived, never stored
  as an arbitrary host path)
- project_links — host project → other registered project as deps/<name>
- sessions — id, project_id, owner_id, title, status, model, variant,
  approval, timestamps, token counters
- session_shares — session_id, user_id, role read | write

Transcripts/tool calls/artifacts stay in the mock adapter memory Map.
Seeded session ids get their demo transcripts on process start.

## ACL

requireRole(have, read|write|owner). Missing access is 404;
insufficient role is 403. Owner satisfies write and read.

## Adapter

GrokBuildAdapter is user-scoped. Mock implementation persists index
mutations to sqlite and keeps transcripts in memory.

RemoteGrokAdapter throws with a pointer at loopback ACP. Never expose
that port.

## Auth

Cookie JWT (HS256, jose). sub = user id, username claim. httpOnly,
SameSite=lax, 7-day expiry. Authorization uses `users.role` from
SQLite on each request, not the JWT. Seeded user hashed with scrypt.

## TUI

Not a second app. ThemeProvider writes data-theme + localStorage.
Default is TUI (Grok Night). Keyboard: j/k sessions, n new, [ ]
artifacts, t theme, / composer. Ignored while typing.

## What we did not copy

xai-org/grok-build source stays out of this repo.
