import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/get-adapter";
import { getSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    await getAdapter().destroySandbox(user, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
