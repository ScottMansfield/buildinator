import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import { grokPaths } from "./grok-cli";
import { newId } from "./ids";
import { jailSessionPath } from "./sandbox";
import { sessionNewMeta } from "./session-prefs";

export type AcpUpdate = {
  sessionUpdate: string;
  messageId?: string;
  content?: unknown;
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  locations?: unknown;
  entries?: unknown;
  [key: string]: unknown;
};

export class AcpError extends Error {
  readonly code: number | undefined;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "AcpError";
    this.code = code;
  }
}

export type RewindPoint = {
  promptIndex: number;
  createdAt?: string;
  numFileSnapshots?: number;
  hasFileChanges?: boolean;
  promptPreview?: string;
};

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function parseRewindPoint(raw: unknown): RewindPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const promptIndex = asFiniteNumber(o.prompt_index) ?? asFiniteNumber(o.promptIndex);
  if (promptIndex == null) return null;
  return {
    promptIndex,
    createdAt: asString(o.created_at) ?? asString(o.createdAt),
    numFileSnapshots: asFiniteNumber(o.num_file_snapshots) ?? asFiniteNumber(o.numFileSnapshots),
    hasFileChanges: asBoolean(o.has_file_changes) ?? asBoolean(o.hasFileChanges),
    promptPreview: asString(o.prompt_preview) ?? asString(o.promptPreview),
  };
}

export function parseRewindPoints(result: unknown): RewindPoint[] {
  if (Array.isArray(result)) {
    return result.map(parseRewindPoint).filter((p): p is RewindPoint => p != null);
  }
  if (!result || typeof result !== "object") return [];
  const o = result as Record<string, unknown>;
  const arr = o.rewind_points ?? o.rewindPoints;
  if (!Array.isArray(arr)) return [];
  return arr.map(parseRewindPoint).filter((p): p is RewindPoint => p != null);
}

export function highestRewindPoint(points: RewindPoint[]): RewindPoint | null {
  if (points.length === 0) return null;
  return points.reduce((best, p) => (p.promptIndex > best.promptIndex ? p : best));
}

export function compactSlashText(context?: string): string {
  const note = context?.trim();
  return note ? `/compact ${note}` : "/compact";
}

export function isMethodNotFound(err: unknown): boolean {
  if (err instanceof AcpError && err.code === -32601) return true;
  if (err && typeof err === "object" && (err as { code?: unknown }).code === -32601) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /method not found/i.test(msg);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "");
}

/** session/load when grok already has this id in the current process. */
export function isAlreadyLoadedError(err: unknown): boolean {
  const msg = errMessage(err);
  return /already loaded|already in memory|session already|duplicate session|already active/i.test(msg);
}

/** session/load when grok has no such session (files gone after restart, unknown id). */
export function isSessionNotFoundError(err: unknown): boolean {
  const msg = errMessage(err);
  return /not found|no such session|unknown session|does not exist|invalid session|no session/i.test(
    msg,
  );
}

function rewindExecuteSuccess(result: unknown): { success: boolean; message?: string } {
  if (!result || typeof result !== "object") return { success: true };
  const o = result as Record<string, unknown>;
  const message = asString(o.message) ?? asString(o.error);
  if (o.success === false) return { success: false, message };
  return { success: true, message };
}


type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

type Term = {
  child: ChildProcess;
  output: string;
  limit: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  waiters: Array<(status: { exitCode: number | null; signal: string | null }) => void>;
};

class AcpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private initialized = false;
  private starting: Promise<void> | null = null;
  private updateHandlers = new Map<string, (update: AcpUpdate) => void>();
  private terminals = new Map<string, Term>();
  /** JSON-RPC id of the in-flight session/prompt per ACP session. */
  private promptWaiters = new Map<string, number>();
  /** ACP session ids loaded in THIS grok child since last spawn. */
  private loadedSessions = new Set<string>();
  /** acpSessionId → session sandbox absolute path. */
  private sessionSandboxes = new Map<string, string>();
  private fsWriteListeners = new Set<(absPath: string, bytes: number) => void>();

  onFsWrite(fn: (absPath: string, bytes: number) => void): () => void {
    this.fsWriteListeners.add(fn);
    return () => {
      this.fsWriteListeners.delete(fn);
    };
  }

  private notifyFsWrite(absPath: string, bytes: number): void {
    for (const fn of this.fsWriteListeners) {
      try {
        fn(absPath, bytes);
      } catch (err) {
        console.error("ACP fs write listener failed", err);
      }
    }
  }

  private processLive(): boolean {
    return Boolean(
      this.child && this.initialized && this.child.exitCode === null && !this.child.killed,
    );
  }

  hasLoaded(acpId: string): boolean {
    if (!acpId || !this.processLive()) return false;
    return this.loadedSessions.has(acpId);
  }

  private markLoaded(acpId: string): void {
    if (acpId) this.loadedSessions.add(acpId);
  }

  private forgetLoaded(): void {
    this.loadedSessions.clear();
    this.sessionSandboxes.clear();
  }

  bindSandbox(acpId: string, sandbox: string): void {
    if (acpId && sandbox) this.sessionSandboxes.set(acpId, sandbox);
  }

  private sandboxFor(params: unknown): string | null {
    const sid =
      params && typeof params === "object" && typeof (params as { sessionId?: unknown }).sessionId === "string"
        ? (params as { sessionId: string }).sessionId.trim()
        : "";
    if (!sid) return null;
    return this.sessionSandboxes.get(sid) ?? null;
  }

  private jailOrError(id: number | string, params: unknown, candidate: string, label: string): string | null {
    const sandbox = this.sandboxFor(params);
    if (!sandbox) {
      this.respondError(id, -32000, "no sandbox for ACP session");
      return null;
    }
    const jailed = jailSessionPath(sandbox, candidate);
    if (!jailed) {
      this.respondError(id, -32602, `${label} outside session sandbox`);
      return null;
    }
    return jailed;
  }
