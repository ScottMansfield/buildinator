import { spawn } from "node:child_process";

export function grokCliEnabled(): boolean {
  const mode = process.env.GROK_ADAPTER ?? "mock";
  return mode === "cli" || mode === "grok";
}

export function grokAcpEnabled(): boolean {
  return (process.env.GROK_ADAPTER ?? "mock") === "acp";
}

const DEFAULT_ACP_WS = "ws://127.0.0.1:2419/ws";

/**
 * Loopback WebSocket URL for `grok agent serve` (`/ws`).
 * Stale http(s) GROK_ACP_URL values (e.g. http://127.0.0.1:8080) are ignored.
 * `ws://127.0.0.1:2419` gains `/ws`; a path that already includes `/ws` is kept.
 */
export function grokAcpWsUrl(): string {
  const raw = (process.env.GROK_ACP_URL ?? "").trim();
  if (!raw || /^https?:\/\//i.test(raw)) return DEFAULT_ACP_WS;
  try {
    const u = new URL(raw);
    if (u.protocol !== "ws:" && u.protocol !== "wss:") return DEFAULT_ACP_WS;
    if (!u.pathname || u.pathname === "/") u.pathname = "/ws";
    return u.href;
  } catch {
    return DEFAULT_ACP_WS;
  }
}

/** Bearer token for grok agent serve. Prefer env; never put --secret on argv. */
export function grokAgentSecret(): string {
  return (process.env.GROK_AGENT_SECRET ?? "").trim();
}


export function grokCliConfigured(): boolean {
  return grokCliEnabled();
}

/** Grok treats GROK_HOME as the config dir (default ~/.grok), not $HOME. */
export function grokPaths(): { home: string; grokHome: string; bin: string; path: string } {
  const home = process.env.HOME && process.env.HOME !== "/" ? process.env.HOME : "/opt/buildinator";
  const raw = process.env.GROK_HOME || "";
  const grokHome = raw.endsWith("/.grok") || raw.endsWith(".grok")
    ? raw
    : `${home}/.grok`;
  const bin = process.env.GROK_BIN || `${grokHome}/bin/grok`;
  const path = `${grokHome}/bin:${process.env.PATH ?? "/usr/bin:/bin"}`;
  return { home, grokHome, bin, path };
}

export async function runGrokPrompt(prompt: string, cwd: string): Promise<{
  text: string;
  code: number;
}> {
  const { home, grokHome, bin, path } = grokPaths();
  const args = ["-p", prompt, "--always-approve", "--cwd", cwd];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: {
        ...process.env,
        HOME: home,
        GROK_HOME: grokHome,
        PATH: path,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, 240_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = stdout.trim() || stderr.trim() || "(no grok output)";
      resolve({ text, code: code ?? 1 });
    });
  });
}
