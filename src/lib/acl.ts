import type { AccessRole, ShareRole, UserRole } from "./types";
import { AclError } from "./errors";

const RANK: Record<AccessRole, number> = { read: 1, write: 2, owner: 3 };

export function accessOf(
  ownerId: string,
  userId: string,
  shareRole: ShareRole | null | undefined,
): AccessRole | null {
  if (ownerId === userId) return "owner";
  if (shareRole === "write") return "write";
  if (shareRole === "read") return "read";
  return null;
}

export function requireRole(
  have: AccessRole | null | undefined,
  need: AccessRole,
): AccessRole {
  if (!have) {
    throw new AclError(404, "not found");
  }
  if (RANK[have] < RANK[need]) {
    throw new AclError(403, "forbidden");
  }
  return have;
}

export function can(have: AccessRole | null | undefined, need: AccessRole): boolean {
  return Boolean(have && RANK[have] >= RANK[need]);
}

export function parseUserRole(value: unknown): UserRole {
  if (value === "admin" || value === "write" || value === "read") return value;
  return "write";
}

export function canAccountWrite(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "write";
}

export function isAdmin(role: UserRole | null | undefined): boolean {
  return role === "admin";
}

export function requireAccountWrite(role: UserRole | null | undefined): void {
  if (!canAccountWrite(role)) {
    throw new AclError(403, "forbidden");
  }
}

export function requireAdmin(role: UserRole | null | undefined): void {
  if (!isAdmin(role)) {
    throw new AclError(403, "forbidden");
  }
}
