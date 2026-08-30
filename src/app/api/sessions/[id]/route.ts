import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/get-adapter";
import { getSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const session = await getAdapter().getSession(user, id);
  if (!session) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ session });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: { title?: unknown; approval?: unknown; model?: unknown; variant?: unknown };
  try {
    body = (await request.json()) as {
      title?: unknown;
      approval?: unknown;
      model?: unknown;
      variant?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title : undefined;
  const approval = typeof body.approval === "string" ? body.approval : undefined;
  const model = typeof body.model === "string" ? body.model : undefined;
  const variant = typeof body.variant === "string" ? body.variant : undefined;
  if ((title == null || !title.trim()) && !approval && !model && !variant) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  try {
    const session = await getAdapter().patchSession(user, id, {
      ...(title != null ? { title } : {}),
      ...(approval ? { approval } : {}),
      ...(model ? { model } : {}),
      ...(variant ? { variant } : {}),
    });
    return NextResponse.json({ session });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    await getAdapter().deleteSession(user, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
