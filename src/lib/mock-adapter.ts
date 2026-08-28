import type {
  Artifact,
  ChatMessage,
  GrokBuildAdapter,
  Project,
  SessionDetail,
  SessionSummary,
  ToolCall,
} from "./types";
import { projectName } from "./format";

type Store = {
  projects: Project[];
  sessions: Map<string, SessionDetail>;
};

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function encodeCwd(cwd: string): string {
  return Buffer.from(cwd).toString("base64url");
}

function newId(): string {
  const ts = Date.now().toString(16).padStart(12, "0");
  const rand = crypto.randomUUID().replace(/-/g, "");
  return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-7${rand.slice(0, 3)}-${rand.slice(3, 7)}-${rand.slice(7, 19)}`;
}

function cloneSession(s: SessionDetail): SessionDetail {
  return {
    ...s,
    tokenUsage: s.tokenUsage ? { ...s.tokenUsage } : undefined,
    messages: s.messages.map((m) => ({ ...m })),
    toolCalls: s.toolCalls.map((t) => ({ ...t, input: { ...t.input } })),
    artifacts: s.artifacts.map((a) => ({ ...a })),
  };
}

function summaryOf(s: SessionDetail): SessionSummary {
  return {
    id: s.id,
    projectId: s.projectId,
    title: s.title,
    status: s.status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    model: s.model,
    tokenUsage: s.tokenUsage ? { ...s.tokenUsage } : undefined,
  };
}

const REPLIES = [
  "I'll take a look at the current session layout and sketch a three-pane shell around it.",
  "Mock adapter accepted the prompt. In v1 this would go out as ACP session/prompt.",
  "Noted. I would grep the repo, then propose a patch — here is a plausible next step.",
  "Done in the mock. Artifacts pane should pick up any tool output I just invented.",
];

function seed(): Store {
  const buildinatorCwd = "/home/scott/src/buildinator";
  const infraCwd = "/home/scott/src/infra";
  const pBuild: Project = {
    id: encodeCwd(buildinatorCwd),
    cwd: buildinatorCwd,
    name: projectName(buildinatorCwd),
  };
  const pInfra: Project = {
    id: encodeCwd(infraCwd),
    cwd: infraCwd,
    name: projectName(infraCwd),
  };

  const richId = "0193b8e0-4a11-7c00-8000-000000000001";
  const authId = "0193b8e0-4a11-7c00-8000-000000000002";
  const tuiId = "0193b8e0-4a11-7c00-8000-000000000003";
  const flyId = "0193b8e0-4a11-7c00-8000-000000000011";
  const nginxId = "0193b8e0-4a11-7c00-8000-000000000012";
  const tailscaleId = "0193b8e0-4a11-7c00-8000-000000000013";

  const rich: SessionDetail = {
    id: richId,
    projectId: pBuild.id,
    title: "Three-pane session manager UI",
    status: "idle",
    createdAt: hoursAgo(30),
    updatedAt: hoursAgo(0.4),
    model: "grok-4",
    tokenUsage: { input: 18420, output: 6230 },
    messages: [
      {
        id: "m1",
        role: "user",
        createdAt: hoursAgo(30),
        content:
          "Build a web frontend for managing grok sessions on a remote box. Group every session by project, with a real chat and artifacts on the right.",
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
        id: "m4",
        role: "assistant",
        createdAt: hoursAgo(27.8),
        content:
          "Plan:\n1. GrokBuildAdapter with mock plus remote stub\n2. Cookie JWT around a seeded user\n3. Sidebar grouped by cwd, chat, collapsible artifacts\n4. data-theme=tui as a skin, not a second app",
      },
    ],
    toolCalls: [],
    artifacts: [],
  };

  rich.toolCalls = [
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
        '{ "id": "0193b8e0-4a11-7c00-8000-000000000001", "title": "Three-pane session manager UI", "cwd": "/home/scott/src/buildinator" }',
    },
    {
      id: "t3",
      name: "write_file",
      status: "completed",
      createdAt: hoursAgo(27.9),
      input: { path: "src/lib/types.ts" },
      output: "wrote GrokBuildAdapter interface",
    },
  ];

  rich.artifacts = [
    {
      id: "a1",
      sessionId: richId,
      kind: "file",
      title: "src/lib/types.ts",
      createdAt: hoursAgo(27.9),
      content:
        "export interface GrokBuildAdapter {\n  listProjects(): Promise<Project[]>;\n  sendPrompt(sessionId: string, prompt: string): Promise<SessionDetail>;\n}",
    },
    {
      id: "a2",
      sessionId: richId,
      kind: "diff",
      title: "src/app/globals.css",
      createdAt: hoursAgo(6),
      content:
        "@@ html[data-theme=\"tui\"]\n+  --font: ui-monospace, Menlo, monospace;\n+  --accent: #5dff5d;",
    },
    {
      id: "a3",
      sessionId: richId,
      kind: "plan",
      title: "Session manager v0",
      createdAt: hoursAgo(28),
      content:
        "[x] Adapter interface plus mock seed\n[x] Cookie auth\n[x] Three-pane shell\n[x] TUI theme toggle\n[ ] Remote ACP transport\n[ ] Google SSO\n[ ] Live session/update stream",
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
        "model: grok-4\ncwd: /home/scott/src/buildinator\ntokens: 18420 in / 6230 out\nstatus: idle",
    },
  ];

  const authSess: SessionDetail = {
    id: authId,
    projectId: pBuild.id,
    title: "Cookie JWT auth for the web UI",
    status: "idle",
    createdAt: hoursAgo(20),
    updatedAt: hoursAgo(8),
    model: "grok-4",
    tokenUsage: { input: 4100, output: 1800 },
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
          "Cookie-signed JWT with jose, httpOnly, 7-day expiry. Login route issues it; middleware gates /app and /api. SSO later still mints the same cookie.",
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
        content: "signSession / verifyCredentials / getSessionUser",
      },
    ],
  };

  const tui: SessionDetail = {
    id: tuiId,
    projectId: pBuild.id,
    title: "TUI skin over the same routes",
    status: "running",
    createdAt: hoursAgo(5),
    updatedAt: hoursAgo(0.05),
    model: "grok-4",
    tokenUsage: { input: 2200, output: 900 },
    messages: [
      {
        id: "tm1",
        role: "user",
        createdAt: hoursAgo(5),
        content:
          "I want a mode that LOOKS like the grok TUI but is only a CSS/keyboard skin.",
      },
      {
        id: "tm2",
        role: "assistant",
        createdAt: hoursAgo(4.9),
        content:
          "data-theme on html, persist in localStorage. Monospace, high contrast, light scanlines, j/k in the sidebar. Same React tree.",
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
  };

  const fly: SessionDetail = {
    id: flyId,
    projectId: pInfra.id,
    title: "Bootstrap grok host on Fly.io",
    status: "idle",
    createdAt: hoursAgo(72),
    updatedAt: hoursAgo(12),
    model: "grok-4",
    tokenUsage: { input: 8000, output: 2400 },
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
          "Fly machine, volume for grok state, private IPv6, auth wrapper in front of session/prompt. Open question: spawn grok or only attach?",
      },
    ],
    toolCalls: [],
    artifacts: [
      {
        id: "fa1",
        sessionId: flyId,
        kind: "file",
        title: "fly.toml",
        createdAt: hoursAgo(71),
        content: 'app = "scott-grok-host"\nprimary_region = "sjc"',
      },
    ],
  };

  const nginx: SessionDetail = {
    id: nginxId,
    projectId: pInfra.id,
    title: "nginx ACP reverse proxy",
    status: "error",
    createdAt: hoursAgo(40),
    updatedAt: hoursAgo(3),
    model: "grok-4",
    tokenUsage: { input: 1500, output: 400 },
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
          "Failed to bind 127.0.0.1:8443 — certificate path not mounted. Mocking the error so the UI has a red status.",
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
  };

  const tail: SessionDetail = {
    id: tailscaleId,
    projectId: pInfra.id,
    title: "Tailscale ACL for the grok box",
    status: "idle",
    createdAt: hoursAgo(96),
    updatedAt: hoursAgo(50),
    model: "grok-4",
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
          "Added an ACL stanza: tag:scott can dest proto:tcp port 8080 on tag:grok-host.",
      },
    ],
    toolCalls: [],
    artifacts: [],
  };

  const sessions = new Map<string, SessionDetail>();
  for (const s of [rich, authSess, tui, fly, nginx, tail]) {
    sessions.set(s.id, s);
  }
  return { projects: [pBuild, pInfra], sessions };
}

export class MockGrokBuildAdapter implements GrokBuildAdapter {
  private store: Store;
  private replyAt = 0;

  constructor() {
    this.store = seed();
  }

  async listProjects(): Promise<Project[]> {
    return this.store.projects.map((p) => ({ ...p }));
  }

  async listSessions(projectId?: string): Promise<SessionSummary[]> {
    const all = [...this.store.sessions.values()].map(summaryOf);
    const filtered = projectId
      ? all.filter((s) => s.projectId === projectId)
      : all;
    return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getSession(id: string): Promise<SessionDetail | null> {
    const s = this.store.sessions.get(id);
    return s ? cloneSession(s) : null;
  }

  async createSession(
    projectId: string,
    title?: string,
  ): Promise<SessionDetail> {
    const project = this.store.projects.find((p) => p.id === projectId);
    if (!project) throw new Error(`unknown project ${projectId}`);
    const now = new Date().toISOString();
    const session: SessionDetail = {
      id: newId(),
      projectId,
      title: title?.trim() || "New session",
      status: "idle",
      createdAt: now,
      updatedAt: now,
      model: "grok-4",
      tokenUsage: { input: 0, output: 0 },
      messages: [
        {
          id: newId(),
          role: "system",
          createdAt: now,
          content: `Mock session in ${project.cwd}. /rename to set a title.`,
        },
      ],
      toolCalls: [],
      artifacts: [
        {
          id: newId(),
          sessionId: "pending",
          kind: "info",
          title: "Session info",
          createdAt: now,
          content: `model: grok-4\ncwd: ${project.cwd}\ntokens: 0 in / 0 out\nstatus: idle`,
        },
      ],
    };
    session.artifacts[0].sessionId = session.id;
    this.store.sessions.set(session.id, session);
    return cloneSession(session);
  }

  async renameSession(
    sessionId: string,
    title: string,
  ): Promise<SessionSummary> {
    const s = this.store.sessions.get(sessionId);
    if (!s) throw new Error("session not found");
    s.title = title.trim() || s.title;
    s.updatedAt = new Date().toISOString();
    return summaryOf(s);
  }

  async listArtifacts(sessionId: string): Promise<Artifact[]> {
    const s = this.store.sessions.get(sessionId);
    if (!s) throw new Error("session not found");
    return s.artifacts.map((a) => ({ ...a }));
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<SessionDetail> {
    const s = this.store.sessions.get(sessionId);
    if (!s) throw new Error("session not found");
    const now = new Date().toISOString();
    const userMsg: ChatMessage = {
      id: newId(),
      role: "user",
      content: prompt,
      createdAt: now,
    };
    s.messages.push(userMsg);
    s.status = "running";
    s.updatedAt = now;

    await new Promise((r) => setTimeout(r, 550));

    const reply = REPLIES[this.replyAt % REPLIES.length];
    this.replyAt += 1;
    s.messages.push({
      id: newId(),
      role: "assistant",
      content: reply,
      createdAt: new Date().toISOString(),
    });

    if (this.replyAt % 2 === 0) {
      const tool: ToolCall = {
        id: newId(),
        name: "read_file",
        status: "completed",
        createdAt: new Date().toISOString(),
        input: { path: "README.md" },
        output: "# buildinator\nmock read of README.md",
      };
      s.toolCalls.push(tool);
      s.artifacts.push({
        id: newId(),
        sessionId: s.id,
        kind: "tool_output",
        title: "read_file README.md",
        createdAt: tool.createdAt,
        content: tool.output ?? "",
      });
    }

    s.status = "idle";
    s.updatedAt = new Date().toISOString();
    s.tokenUsage = {
      input: (s.tokenUsage?.input ?? 0) + Math.min(prompt.length, 400),
      output: (s.tokenUsage?.output ?? 0) + reply.length,
    };
    const info = s.artifacts.find((a) => a.kind === "info");
    if (info) {
      const project = this.store.projects.find((p) => p.id === s.projectId);
      info.content = `model: ${s.model}\ncwd: ${project?.cwd ?? "?"}\ntokens: ${s.tokenUsage.input} in / ${s.tokenUsage.output} out\nstatus: ${s.status}`;
    }
    return cloneSession(s);
  }
}

const globalForGrok = globalThis as unknown as {
  __buildinatorMock?: MockGrokBuildAdapter;
};

export function getMockAdapter(): MockGrokBuildAdapter {
  if (!globalForGrok.__buildinatorMock) {
    globalForGrok.__buildinatorMock = new MockGrokBuildAdapter();
  }
  return globalForGrok.__buildinatorMock;
}
