# Design

## Why this stack

Next.js App Router + TypeScript + Tailwind is enough to ship a usable v0 tonight:

- App Router gives file-based pages and API routes in one process.
- Middleware runs on the edge, which is a natural cookie gate.
- jose signs JWTs without a database.
- Tailwind (and a small CSS variable layer) lets the TUI skin be a theme, not a fork.

No extra UI kit. No database. Mock state lives in a module singleton.

## Information architecture

Unauthenticated users hit /login. Authenticated users live on /app.

Three panes, always:

1. Left — every session, grouped by project (working directory). Search. New session under a project.
2. Center — transcript (user, assistant, tool-call cards) plus composer.
3. Right — artifacts for the selected session (files, diffs, plan, tool output, terminals, session info). Collapsible.

Same routes and React state in both themes. The TUI mode sets data-theme="tui" on html and restyles.

## Data model

Project: id (encoded cwd), cwd, name.
Session: UUIDv7-ish id, projectId, title, status (idle/running/error), timestamps, model, token usage.
Message: id, role, content, createdAt.
ToolCall: name, status, input, output.
Artifact: kind + title + content.

Grouping by project equals grouping by cwd, matching how grok stores sessions under encoded-cwd / session-id.

## Adapter interface

GrokBuildAdapter:

- listProjects
- listSessions
- getSession
- createSession
- sendPrompt
- listArtifacts
- renameSession (needed for /rename)

MockGrokBuildAdapter: in-memory Maps, seeded on first import, surviving HMR via globalThis. Mutations last until the Node process restarts.

RemoteGrokAdapter: throws with a pointer at ACP session/new, session/load, session/prompt, session/update and GROK_REMOTE_URL. v1 fills this in.

API routes are a thin translation of the adapter. Swap the adapter, keep the UI.

## Auth

Cookie JWT (HS256, jose). httpOnly, SameSite=lax, 7-day expiry. Seeded user from AUTH_USERNAME / AUTH_PASSWORD / AUTH_SECRET.

Middleware protects /app and /api except login/logout. getSessionUser() is the server-side check.

Google SSO later is another identity provider that mints the same cookie. Do not implement Google in v0.

## TUI skin

Not a second app. ThemeProvider writes data-theme to html and localStorage.

Default: modern dark, system sans, amber accent.

TUI: monospace, green-on-black, light CRT scanlines, square corners, keyboard-first (j/k, n, [/], t, slash focuses composer). Readable, not a novelty filter.

Keybinds are ignored while typing in an input or textarea.

## What we did not copy

xai-org/grok-build source stays out of this repo. Session layout, ACP method names, and slash commands are described, not vendored.
