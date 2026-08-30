import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { requireAccountWrite, requireRole } from "@/lib/acl";
import { getAccessibleSummary, getProjectRow } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { newId } from "@/lib/ids";
import { pathInsideSandbox, ensureSessionSandbox } from "@/lib/sandbox";
import { emptyTranscript } from "@/lib/seed-transcripts";
import { loadTranscript, saveTranscript } from "@/lib/transcript-store";
import { getAdapter } from "@/lib/get-adapter";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const TIMEOUT_MS = 30_000;
const OUTPUT_CAP = 32_000;

function commandEscapesSandbox(command: string, sandbox: string): boolean {
  if (command.includes("\0")) return true;
  const tokens = command.split(/[\s;|&<>()'"`]+/).filter(Boolean);
  for (const raw of tokens) {
    const t = raw.replace(/^\\+/, "");
    if (!t) continue;
    if (t === ".." || t.startsWith("../") || t.includes("/../") || t.endsWith("/..")) {
      return true;
    }
    if (t.startsWith("/") && t !== sandbox && !pathInsideSandbox(sandbox, t)) {
      return true;
    }
  }
  return false;
}

function runShell(
  cwd: string,
  command: string,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], {
      cwd,
      env: { ...process.env, HOME: cwd, PWD: cwd },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    const take = (buf: Buffer, prev: string) => {
      const next = prev + buf.toString("utf8");
      if (next.length <= OUTPUT_CAP) return next;
      return next.slice(0, OUTPUT_CAP) + "\n…truncated";
    };
    child.stdout?.on("data", (b: Buffer) => {
      stdout = take(b, stdout);
    });
    child.stderr?.on("data", (b: Buffer) => {
      stderr = take(b, stderr);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: stderr || err.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

export async function POST(request: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: { command?: unknown };
  try {
    body = (await request.json()) as { command?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command) {
    return NextResponse.json({ error: "command required" }, { status: 400 });
  }
  try {
    requireAccountWrite(user.role);
    const summary = getAccessibleSummary(user.id, id);
    if (!summary) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    requireRole(summary.myRole, "write");
    const project = getProjectRow(summary.projectId);
    if (!project) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const sandbox = ensureSessionSandbox(project.owner_id, project.id, id);
    if (commandEscapesSandbox(command, sandbox)) {
      return NextResponse.json(
        { error: "command not allowed outside sandbox" },
        { status: 400 },
      );
    }
    const result = await runShell(sandbox, command);
    const now = new Date().toISOString();
    const t =
      loadTranscript(id) ??
      emptyTranscript(id, summary.projectCwd, now);
    const out = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    const status = result.timedOut
      ? "timed out"
      : `exit ${result.code ?? "?"}`;
    t.messages.push({
      id: newId(),
      role: "user",
      content: `!${command}`,
      createdAt: now,
    });
    t.messages.push({
      id: newId(),
      role: "action",
      content: `$ ${command}  (${status})`,
      createdAt: now,
    });
    t.messages.push({
      id: newId(),
      role: "action",
      content: out || "(no output)",
      createdAt: now,
    });
    saveTranscript(id, t);
    const session = await getAdapter().getSession(user, id);
    return NextResponse.json({ session });
  } catch (err) {
    return jsonError(err);
  }
}
