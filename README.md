# buildinator

A browser frontend for managing Grok Build sessions
(https://github.com/xai-org/grok-build).

Scott likes the TUI. This is the session manager he wanted in a browser:
every session grouped by project, a real chat transcript, and artifacts
in a side pane. v0 is a mock. No grok process is spawned and nothing
talks ACP yet, but the UI, auth, and adapter boundary are real.

## Run it

    cp .env.example .env
    npm install
    npm run dev

Production: npm run build && npm start.

Open http://localhost:3000

Demo user: scott (see the example environment file).

## What you get in v0

- Cookie JWT auth. Structured so Google SSO can plug in later.
- Three-pane shell: projects on the left, chat center, artifacts right.
- A TUI skin: same routes and state, CSS plus keyboard overlay.
- Slash commands: /help, /new, /rename, plus stubs.
- In-memory MockGrokBuildAdapter with seeded projects.
- RemoteGrokAdapter stub for the future ACP/HTTP path.

## Limitations

- Mock backend. Nothing speaks ACP, nothing starts grok.
- Mock data does not survive process restart.
- One seeded user. Prompt replies are canned.
- TUI mode is a theme, not a pixel clone of grok-build.

See PLAN.md, DESIGN.md, and QUESTIONS.md.

## Layout

    src/app/            App Router pages plus API routes
    src/components/     Shell, sidebar, chat, artifacts, theme
    src/lib/            auth, types, adapter plus mock/remote
    src/middleware.ts   cookie gate for /app and /api
