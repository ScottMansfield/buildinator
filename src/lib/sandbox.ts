import fs from "node:fs";
import path from "node:path";

const SAFE = /^[A-Za-z0-9_-]+$/;

export function assertSafeSegment(segment: string, label = "segment"): string {
  if (!segment || !SAFE.test(segment)) {
    throw new Error(`invalid ${label}`);
  }
  return segment;
}

export function dataRoot(): string {
  return path.resolve(process.cwd(), "data");
}

export function sandboxRoot(): string {
  return path.join(dataRoot(), "sandboxes");
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
