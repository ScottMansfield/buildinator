import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/acl";
import { getSessionUser } from "@/lib/auth";
import { deleteUserRow, findUserById, updateUserRow } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { hashPassword } from "@/lib/passwords";
import type { UserRole } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function parseRole(value: unknown): UserRole | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "admin" || value === "write" || value === "read") return value;
  return undefined;
}

export async function PATCH(request: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    requireAdmin(user.role);
    const { id } = await ctx.params;
    if (!findUserById(id)) {
      return NextResponse.json({ error: "user not found" }, { status: 404 });
    }
    let body: { role?: unknown; password?: unknown; disabled?: unknown };
    try {
      body = (await request.json()) as {
        role?: unknown;
        password?: unknown;
        disabled?: unknown;
      };
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    if (body.role !== undefined && parseRole(body.role) === undefined) {
      return NextResponse.json({ error: "role must be admin, write, or read" }, { status: 400 });
    }
    const password = typeof body.password === "string" ? body.password : "";
    if (body.password !== undefined && !password) {
      return NextResponse.json({ error: "password required" }, { status: 400 });
    }
    if (body.disabled !== undefined && typeof body.disabled !== "boolean") {
      return NextResponse.json({ error: "disabled must be boolean" }, { status: 400 });
    }
    const updated = updateUserRow(id, {
      role: parseRole(body.role),
      passwordHash: password ? hashPassword(password) : undefined,
      disabled: typeof body.disabled === "boolean" ? body.disabled : undefined,
    });
    return NextResponse.json({ user: updated });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    requireAdmin(user.role);
    const { id } = await ctx.params;
    deleteUserRow(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
