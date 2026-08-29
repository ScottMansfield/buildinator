import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/get-adapter";
import { getSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: { type?: unknown };
  try {
    body = (await request.json()) as { type?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const type = typeof body.type === "string" ? body.type : "";
  const adapter = getAdapter();
  try {
    if (type === "fork") {
      const session = await adapter.forkSession(user, id);
      return NextResponse.json({ session }, { status: 201 });
    }
    if (type === "resume") {
      const session = await adapter.resumeSession(user, id);
      return NextResponse.json({ session });
    }
    if (type === "compact") {
      const session = await adapter.compactSession(user, id);
      return NextResponse.json({ session });
    }
    if (type === "rewind") {
      const session = await adapter.rewindSession(user, id);
      return NextResponse.json({ session });
    }
    if (type === "cancel") {
      const session = await adapter.cancelSession(user, id);
      return NextResponse.json({ session });
    }
    return NextResponse.json(
      { error: "type must be fork, resume, compact, rewind, or cancel" },
      { status: 400 },
    );
  } catch (err) {
    return jsonError(err);
  }
}
