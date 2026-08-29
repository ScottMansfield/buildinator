import type { Artifact, ChatMessage, SessionDetail, ToolCall } from "./types";
import {
  SESSION_AUTH,
  SESSION_FLY,
  SESSION_NGINX,
  SESSION_RICH,
  SESSION_TAIL,
  SESSION_TUI,
} from "./db";

export type Transcript = {
  messages: ChatMessage[];
  toolCalls: ToolCall[];
  artifacts: Artifact[];
  acpSessionId?: string;
};

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

export function cloneTranscript(t: Transcript): Transcript {
  return {
    messages: t.messages.map((m) => ({ ...m })),
    toolCalls: t.toolCalls.map((c) => ({ ...c, input: { ...c.input } })),
    artifacts: t.artifacts.map((a) => ({ ...a })),
    acpSessionId: t.acpSessionId,
  };
}

export function emptyTranscript(sessionId: string, cwd: string, now: string): Transcript {
  return {
    messages: [],
    toolCalls: [],
    artifacts: [
      {
        id: `${sessionId}-info`,
        sessionId,
        kind: "info",
        title: "Session info",
        createdAt: now,
        content: `model: grok-4.6 (high)\ncwd: ${cwd}
tokens: 0 in / 0 out\nstatus: idle`,
      },
    ],
  };
}

export function seedTranscripts(): Map<string, Transcript> {
  const richId = SESSION_RICH;
  const authId = SESSION_AUTH;
  const tuiId = SESSION_TUI;
  const flyId = SESSION_FLY;
  const nginxId = SESSION_NGINX;
  const tailscaleId = SESSION_TAIL;

  const map = new Map<string, Transcript>();

  map.set(richId, {
    messages: [
      {
        id: "m1",
        role: "user",
        createdAt: hoursAgo(30),
        content:
          "Build a web frontend for managing grok sessions on a remote box. Group every session by project, with a real chat and artifacts on the right.",
      },
      {
        id: "m1a",
        role: "action",
        createdAt: hoursAgo(29.95),
        content: "Thought for 4.2s",
      },
      {
        id: "m2",
        role: "assistant",
        createdAt: hoursAgo(29.9),
        content:
          "I'll map how grok persists sessions, then sketch a three-pane IA. Group by working directory. Manual /rename wins over autogen titles.",
      },
      {
        id: "m3",
        role: "user",
        createdAt: hoursAgo(28),
        content:
          "Keep v0 on a mock adapter. Cookie auth now, Google later. TUI skin is CSS plus keybinds over the same routes.",
      },
      {
        id: "m3a",
        role: "action",
        createdAt: hoursAgo(27.95),
        content: "Searched 10 websites",
      },
      {
        id: "m4",
        role: "assistant",
        createdAt: hoursAgo(27.8),
        content:
          "Plan:\n1. GrokBuildAdapter with mock plus remote stub\n2. Cookie JWT around seeded users\n3. Sidebar grouped by sandbox, chat, collapsible artifacts\n4. data-theme=tui as Grok Night — identifiers like `audio_transcription_config` in teal",
      },
    ],
    toolCalls: [
      {
        id: "t1",
        name: "glob_search",
        status: "completed",
        createdAt: hoursAgo(29.85),
        input: { pattern: "**/summary.json" },
        output: "2 summary.json files (buildinator, infra)",
      },
      {
        id: "t2",
        name: "read_file",
        status: "completed",
        createdAt: hoursAgo(29.7),
        input: { path: "summary.json" },
        output:
          '{ "id": "0193b8e0-4a11-7c00-8000-000000000001", "title": "Three-pane session manager UI" }',
      },
      {
        id: "t3",
        name: "write_file",
        status: "completed",
        createdAt: hoursAgo(27.9),
        input: { path: "src/lib/types.ts" },
        output: "wrote GrokBuildAdapter interface",
      },
    ],
    artifacts: [
      {
        id: "a1",
        sessionId: richId,
        kind: "file",
        title: "src/lib/types.ts",
        createdAt: hoursAgo(27.9),
        content:
          "export interface GrokBuildAdapter {\n  listProjects(user: SessionUser): Promise<Project[]>;\n  sendPrompt(user: SessionUser, sessionId: string, prompt: string): Promise<SessionDetail>;\n}",
      },
      {
        id: "a2",
        sessionId: richId,
        kind: "diff",
        title: "src/app/globals.css",
        createdAt: hoursAgo(6),
        content:
          "@@ html[data-theme=\"tui\"]\n+  --bg: #0a0a0a;\n+  --accent: #4fd1c5;",
      },
      {
        id: "a3",
        sessionId: richId,
        kind: "plan",
        title: "Session manager v1",
        createdAt: hoursAgo(28),
        content:
          "[x] Adapter interface plus sqlite metadata\n[x] Cookie auth, scrypt passwords\n[x] Three-pane shell\n[x] Grok Night TUI default\n[x] Session sharing\n[ ] Remote ACP transport (loopback sidecar)\n[ ] Live session/update stream",
      },
      {
        id: "a4",
        sessionId: richId,
        kind: "tool_output",
        title: "glob_search summary.json",
        createdAt: hoursAgo(29.85),
        content: "2 files (buildinator, infra)",
      },
      {
        id: "a5",
        sessionId: richId,
        kind: "terminal",
        title: "next build",
        createdAt: hoursAgo(1),
        content: "Next.js build\nCompiled successfully",
      },
      {
        id: "a6",
        sessionId: richId,
        kind: "info",
        title: "Session info",
        createdAt: hoursAgo(0.4),
        content:
          "model: grok-4.6 (high)\ncwd: ~/projects/buildinator\ntokens: 18420 in / 6230 out\nstatus: idle",
      },
    ],
  });

  map.set(authId, {
    messages: [
      {
        id: "am1",
        role: "user",
        createdAt: hoursAgo(20),
        content:
          "Username plus password now. Leave a door for Google SSO later. Do not implement Google yet.",
      },
      {
        id: "am2",
        role: "assistant",
        createdAt: hoursAgo(19.9),
        content:
          "Cookie-signed JWT with jose, httpOnly, 7-day expiry. Passwords hashed with scrypt. Login route issues the cookie; middleware gates /app and /api. SSO later still mints the same cookie.",
      },
    ],
    toolCalls: [],
    artifacts: [
      {
        id: "aa1",
        sessionId: authId,
        kind: "file",
        title: "src/lib/auth.ts",
        createdAt: hoursAgo(19.8),
        content: "signSession / authenticate / getSessionUser",
      },
    ],
  });

  map.set(tuiId, {
    messages: [
      {
        id: "tm1",
        role: "user",
        createdAt: hoursAgo(5),
        content:
          "I want a mode that LOOKS like the grok TUI but is only a CSS/keyboard skin.",
      },
      {
        id: "tm1a",
        role: "action",
        createdAt: hoursAgo(4.95),
        content: "Thought for 1.1s",
      },
      {
        id: "tm2",
        role: "assistant",
        createdAt: hoursAgo(4.9),
        content:
          "data-theme on html, persist in localStorage. Grok Night: charcoal, monospace, `>` user prefix, timestamps on the right, dim ◆ action lines. Same React tree.",
      },
    ],
    toolCalls: [
      {
        id: "tt1",
        name: "edit_file",
        status: "running",
        createdAt: hoursAgo(0.05),
        input: { path: "src/app/globals.css" },
      },
    ],
    artifacts: [],
  });

  map.set(flyId, {
    messages: [
      {
        id: "fm1",
        role: "user",
        createdAt: hoursAgo(72),
        content:
          "Sketch a Fly.io machine that runs grok and exposes ACP over an authenticated HTTP bridge.",
      },
      {
        id: "fm2",
        role: "assistant",
        createdAt: hoursAgo(71.8),
        content:
          "One VM, volume for grok state. Grok ACP binds 127.0.0.1 only. HTTPS web UI is the only port on the internet. Share this session as write for a second account.",
      },
    ],
    toolCalls: [],
    artifacts: [
      {
        id: "fa1",
        sessionId: flyId,
        kind: "file",
        title: "docker-compose.yml",
        createdAt: hoursAgo(71),
        content:
          "services:\n  web:\n    ports: [\"3000:3000\"]\n  # grok sidecar: 127.0.0.1 only, not published",
      },
    ],
  });

  map.set(nginxId, {
    messages: [
      {
        id: "nm1",
        role: "user",
        createdAt: hoursAgo(40),
        content: "Put nginx in front of the grok ACP port with mTLS.",
      },
      {
        id: "nm2",
        role: "assistant",
        createdAt: hoursAgo(3),
        content:
          "Failed to bind 127.0.0.1:8443 — certificate path not mounted. Mocking the error so the UI has a red status. Share this session as read for a second account.",
      },
    ],
    toolCalls: [
      {
        id: "nt1",
        name: "bash",
        status: "error",
        createdAt: hoursAgo(3),
        input: { command: "nginx -t" },
        output: "nginx: cannot load certificate",
      },
    ],
    artifacts: [
      {
        id: "na1",
        sessionId: nginxId,
        kind: "terminal",
        title: "nginx -t",
        createdAt: hoursAgo(3),
        content: "nginx: cannot load certificate",
      },
    ],
  });

  map.set(tailscaleId, {
    messages: [
      {
        id: "sm1",
        role: "user",
        createdAt: hoursAgo(96),
        content: "Restrict the grok host to my tailnet tag:scott.",
      },
      {
        id: "sm2",
        role: "assistant",
        createdAt: hoursAgo(95.7),
        content:
          "Added an ACL stanza: tag:scott can dest proto:tcp port 443 on tag:buildinator. ACP stays on loopback.",
      },
    ],
    toolCalls: [],
    artifacts: [],
  });

  return map;
}
