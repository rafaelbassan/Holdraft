import { NextResponse } from "next/server";
import { deleteSection } from "@/lib/sections";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  if (!deleteSection(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
