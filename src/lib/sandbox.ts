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

export function linkDep(
  hostOwnerId: string,
  hostProjectId: string,
  name: string,
  targetOwnerId: string,
  targetProjectId: string,
): void {
  assertSafeSegment(name, "dep name");
  const host = ensureSandbox(hostOwnerId, hostProjectId);
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

export function destroySandbox(ownerId: string, projectId: string): string {
  const dir = sandboxPath(ownerId, projectId);
  fs.rmSync(dir, { recursive: true, force: true });
  return ensureSandbox(ownerId, projectId);
}

/** Absolute path if `candidate` resolves inside sandbox; otherwise null. */
export function pathInsideSandbox(sandbox: string, candidate: string): string | null {
  if (!candidate || typeof candidate !== "string") return null;
  const root = path.resolve(sandbox);
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(root, candidate);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) return null;
  if (resolved === root) return null;
  return resolved;
}

/** POSIX-style path relative to sandbox, or null if outside. */
export function relativeSandboxPath(sandbox: string, candidate: string): string | null {
  const inside = pathInsideSandbox(sandbox, candidate);
  if (!inside) return null;
  return path.relative(path.resolve(sandbox), inside).split(path.sep).join("/");
}
