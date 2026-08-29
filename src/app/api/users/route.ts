import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/acl";
import { getSessionUser } from "@/lib/auth";
import { findUserByUsername, insertUserRow, listManagedUsers } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { newId } from "@/lib/ids";
import { hashPassword } from "@/lib/passwords";
import type { UserRole } from "@/lib/types";

export const runtime = "nodejs";

function parseRole(value: unknown): UserRole | null {
  if (value === "admin" || value === "write" || value === "read") return value;
  return null;
}

function validUsername(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9._-]{0,31}$/.test(name);
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    requireAdmin(user.role);
    return NextResponse.json({ users: listManagedUsers() });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    requireAdmin(user.role);
    let body: { username?: unknown; password?: unknown; role?: unknown };
    try {
      body = (await request.json()) as {
        username?: unknown;
        password?: unknown;
        role?: unknown;
      };
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (body.role !== undefined && parseRole(body.role) === null) {
      return NextResponse.json({ error: "role must be admin, write, or read" }, { status: 400 });
    }
    const role = parseRole(body.role) ?? "write";
    if (!username || !validUsername(username)) {
      return NextResponse.json(
        { error: "username: start with a letter, then letters, numbers, . _ -" },
        { status: 400 },
      );
    }
    if (!password) {
      return NextResponse.json({ error: "password required" }, { status: 400 });
    }
    if (findUserByUsername(username)) {
      return NextResponse.json({ error: "username already exists" }, { status: 409 });
    }
    const created = insertUserRow({
      id: `u-${newId()}`,
      username,
      passwordHash: hashPassword(password),
      role,
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ user: created }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
