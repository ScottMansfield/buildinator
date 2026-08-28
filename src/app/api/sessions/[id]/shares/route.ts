import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/get-adapter";
import { getSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import type { ShareRole } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const shares = await getAdapter().listShares(user, id);
    return NextResponse.json({ shares });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(request: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: { username?: unknown; role?: unknown; revokeAll?: unknown };
  try {
    body = (await request.json()) as {
      username?: unknown;
      role?: unknown;
      revokeAll?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    if (body.revokeAll === true) {
      await getAdapter().revokeAllShares(user, id);
      return NextResponse.json({ ok: true });
    }
    if (typeof body.username !== "string" || !body.username.trim()) {
      return NextResponse.json({ error: "username required" }, { status: 400 });
    }
    const role: ShareRole = body.role === "write" ? "write" : "read";
    const share = await getAdapter().shareSession(user, id, body.username, role);
    return NextResponse.json({ share }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: { shareId?: unknown; all?: unknown } = {};
  try {
    body = (await request.json()) as { shareId?: unknown; all?: unknown };
  } catch {
    // empty body is ok if query param present
  }
  const urlShare = new URL(request.url).searchParams.get("shareId");
  try {
    if (body.all === true) {
      await getAdapter().revokeAllShares(user, id);
      return NextResponse.json({ ok: true });
    }
    const shareId = typeof body.shareId === "string" ? body.shareId : urlShare;
    if (!shareId) {
      return NextResponse.json({ error: "shareId required" }, { status: 400 });
    }
    await getAdapter().revokeShare(user, id, shareId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
