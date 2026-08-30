import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/get-adapter";
import { getSessionUser } from "@/lib/auth";
import { getProjectRow } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { pathInsideSandbox, ensureSessionSandbox } from "@/lib/sandbox";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const rel = new URL(request.url).searchParams.get("path")?.trim() ?? "";
  if (!rel) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }
  try {
    const session = await getAdapter().getSession(user, id);
    if (!session) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const project = getProjectRow(session.projectId);
    if (!project) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const sandbox = ensureSessionSandbox(project.owner_id, project.id, id);
    const abs = pathInsideSandbox(sandbox, rel);
    if (!abs) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    let st: fs.Stats;
    try {
      st = fs.lstatSync(abs);
    } catch {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!st.isFile()) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    let real: string;
    try {
      real = fs.realpathSync(abs);
    } catch {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!pathInsideSandbox(sandbox, real)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const buf = fs.readFileSync(real);
    const filename = path.basename(real).replace(/[\r\n"]/g, "_") || "file";
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
