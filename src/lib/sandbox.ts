import fs from "node:fs";
import path from "node:path";

const SAFE = /^[A-Za-z0-9_-]+$/;

export function assertSafeSegment(segment: string, label = "segment"): string {
  if (!segment || !SAFE.test(segment)) {
    throw new Error(`invalid ${label}`);
  }
  return segment;
}

/** Absolute BUILDINATOR_ROOT when set (e.g. /mnt/buildinator). Unset in local-dev. */
export function buildinatorRoot(): string | undefined {
  const raw = process.env.BUILDINATOR_ROOT?.trim();
  if (!raw) return undefined;
  return path.resolve(raw);
}

/**
 * sqlite + transcripts.
 * BUILDINATOR_ROOT set → $BUILDINATOR_ROOT/data
 * unset → ./data
 */
export function dataRoot(): string {
  const root = buildinatorRoot();
  if (root) return path.join(root, "data");
  return path.resolve(process.cwd(), "data");
}

/**
 * Project workspaces (today's sandboxes).
 * BUILDINATOR_ROOT set → $BUILDINATOR_ROOT/projects  (not nested under data/)
 * unset → ./data/sandboxes
 */
export function projectsRoot(): string {
  const root = buildinatorRoot();
  if (root) return path.join(root, "projects");
  return path.join(dataRoot(), "sandboxes");
}

export function sandboxRoot(): string {
  return projectsRoot();
}

/**
 * Documented GROK_HOME location when BUILDINATOR_ROOT is set:
 * $BUILDINATOR_ROOT/grok. GROK_HOME is still read from env separately.
 */
export function grokRoot(): string | undefined {
  const root = buildinatorRoot();
  if (root) return path.join(root, "grok");
  return undefined;
}

export function sandboxPath(ownerId: string, projectId: string): string {
  assertSafeSegment(ownerId, "userId");
  assertSafeSegment(projectId, "projectId");
  const root = path.resolve(sandboxRoot());
  const dir = path.resolve(root, ownerId, projectId);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (dir !== root && !dir.startsWith(prefix)) {
    throw new Error("sandbox path escape");
  }
  return dir;
}

export function displayCwd(projectName: string): string {
  return `~/projects/${projectName}`;
}

export function ensurePersistenceDirs(): void {
  fs.mkdirSync(dataRoot(), { recursive: true });
  fs.mkdirSync(projectsRoot(), { recursive: true });
}

export function ensureSandbox(ownerId: string, projectId: string): string {
  const dir = sandboxPath(ownerId, projectId);
  fs.mkdirSync(path.join(dir, "deps"), { recursive: true });
  return dir;
}

export type ProjectLinkTarget = {
  name: string;
  targetOwnerId: string;
  targetProjectId: string;
};

let projectLinkLister: ((projectId: string) => ProjectLinkTarget[]) | undefined;

/** db.ts registers this so session sandboxes can apply project_links without a cycle. */
export function setProjectLinkLister(fn: (projectId: string) => ProjectLinkTarget[]): void {
  projectLinkLister = fn;
}

export function sessionSandboxPath(ownerId: string, projectId: string, sessionId: string): string {
  assertSafeSegment(ownerId, "userId");
  assertSafeSegment(projectId, "projectId");
  assertSafeSegment(sessionId, "sessionId");
  const root = path.resolve(sandboxRoot());
  const dir = path.resolve(root, ownerId, projectId, "sessions", sessionId);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (dir !== root && !dir.startsWith(prefix)) {
    throw new Error("sandbox path escape");
  }
  return dir;
}

/**
 * Per-session grok cwd. Isolated from sibling sessions and the parent project
 * workspace unless an explicit project_links dep is mounted at deps/<name>.
 */
export function ensureSessionSandbox(ownerId: string, projectId: string, sessionId: string): string {
  const dir = sessionSandboxPath(ownerId, projectId, sessionId);
  fs.mkdirSync(path.join(dir, "deps"), { recursive: true });
  const links = projectLinkLister?.(projectId) ?? [];
  for (const link of links) {
    try {
      linkDepInto(dir, link.name, link.targetOwnerId, link.targetProjectId);
    } catch {
      // skip a bad/missing link; session dir still usable
    }
  }
  return dir;
}

export function linkDepInto(
  hostDir: string,
  name: string,
  targetOwnerId: string,
  targetProjectId: string,
): void {
  assertSafeSegment(name, "dep name");
  const host = path.resolve(hostDir);
  const target = ensureSandbox(targetOwnerId, targetProjectId);
  const dest = path.join(host, "deps", name);
  const destResolved = path.resolve(dest);
  const hostPrefix = host.endsWith(path.sep) ? host : host + path.sep;
  if (!destResolved.startsWith(hostPrefix)) {
    throw new Error("dep path escape");
  }
  try {
    fs.lstatSync(dest);
    fs.rmSync(dest, { recursive: true, force: true });
  } catch {
    // dest missing is fine
  }
  fs.symlinkSync(path.relative(path.dirname(dest), target), dest);
}

export function linkDep(
  hostOwnerId: string,
  hostProjectId: string,
  name: string,
  targetOwnerId: string,
  targetProjectId: string,
): void {
  const host = ensureSandbox(hostOwnerId, hostProjectId);
  linkDepInto(host, name, targetOwnerId, targetProjectId);
}

export function destroySandbox(ownerId: string, projectId: string): string {
  const dir = sandboxPath(ownerId, projectId);
  fs.rmSync(dir, { recursive: true, force: true });
  return ensureSandbox(ownerId, projectId);
}

function resolvedUnderRoot(root: string, candidate: string, allowRoot: boolean): string | null {
  if (!candidate || typeof candidate !== "string") return null;
  const base = path.resolve(root);
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(base, candidate);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (resolved === base) return allowRoot ? resolved : null;
  if (!resolved.startsWith(prefix)) return null;
  return resolved;
}

/** Absolute path if `candidate` resolves inside sandbox; otherwise null. */
export function pathInsideSandbox(sandbox: string, candidate: string): string | null {
  return resolvedUnderRoot(sandbox, candidate, false);
}

/**
 * Jail an ACP fs/terminal path to a session sandbox.
 * Logical path must be under the sandbox (root allowed).
 * realpath may land in another project only via deps/<name> (explicit project_links).
 */
export function jailSessionPath(sandbox: string, candidate: string): string | null {
  const logical = resolvedUnderRoot(sandbox, candidate, true);
  if (!logical) return null;
  const root = path.resolve(sandbox);
  const rel = path.relative(root, logical).split(path.sep).join("/");
  const viaDeps = rel === "deps" || rel.startsWith("deps/");
  try {
    const real = fs.realpathSync(logical);
    if (resolvedUnderRoot(sandbox, real, true)) return real;
    if (viaDeps) return real;
    return null;
  } catch {
    return logical;
  }
}

/** POSIX-style path relative to sandbox, or null if outside. */
export function relativeSandboxPath(sandbox: string, candidate: string): string | null {
  const inside = pathInsideSandbox(sandbox, candidate);
  if (!inside) return null;
  return path.relative(path.resolve(sandbox), inside).split(path.sep).join("/");
}

const SKIP_DIR_NAMES = new Set([
  "deps",
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".bzr",
  "dist",
  ".next",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".cache",
  "build",
]);

const SKIP_FILE_NAMES = new Set([".DS_Store", "Thumbs.db"]);

const SANDBOX_FILE_CAP = 200;
const SANDBOX_WALK_CAP = 5000;

export type SandboxFileEntry = {
  rel: string;
  size: number;
  mtimeMs: number;
};

/**
 * Regular files under a sandbox (session dir). Newest mtime first, capped.
 * Does not follow directory symlinks. Skips deps/ and other junk dirs.
 * Never walks outside `sandbox`.
 */
export function listSandboxFiles(sandbox: string): SandboxFileEntry[] {
  const root = path.resolve(sandbox);
  const out: SandboxFileEntry[] = [];
  let visited = 0;

  function walk(dir: string): void {
    if (visited >= SANDBOX_WALK_CAP) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (visited >= SANDBOX_WALK_CAP) return;
      if (SKIP_FILE_NAMES.has(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (!pathInsideSandbox(root, abs) && abs !== root) continue;
      let st: fs.Stats;
      try {
        st = fs.lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (SKIP_DIR_NAMES.has(ent.name)) continue;
        walk(abs);
        continue;
      }
      if (!st.isFile()) continue;
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (!rel || rel.startsWith("..")) continue;
      visited += 1;
      out.push({ rel, size: st.size, mtimeMs: st.mtimeMs });
    }
  }

  try {
    const rootSt = fs.lstatSync(root);
    if (!rootSt.isDirectory()) return [];
  } catch {
    return [];
  }
  walk(root);
  out.sort((a, b) => b.mtimeMs - a.mtimeMs || a.rel.localeCompare(b.rel));
  return out.slice(0, SANDBOX_FILE_CAP);
}
