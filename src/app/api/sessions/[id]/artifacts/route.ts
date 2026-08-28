import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/get-adapter";
import { getSessionUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const artifacts = await getAdapter().listArtifacts(id);
    return NextResponse.json({ artifacts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
