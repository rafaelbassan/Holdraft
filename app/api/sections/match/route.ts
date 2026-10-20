import { NextRequest, NextResponse } from "next/server";
import { findSimilarSection } from "@/lib/section-text";
import { listSectionCandidates } from "@/lib/sections";

export async function POST(request: NextRequest) {
  let body: { message?: string; exclude_id?: number | null };
  try {
    body = (await request.json()) as { message?: string; exclude_id?: number | null };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ match: null });
  }

  const excludeId = Number(body.exclude_id);
  const candidates = listSectionCandidates().filter(
    (candidate) => !Number.isFinite(excludeId) || candidate.id !== excludeId,
  );
  const match = findSimilarSection(message, candidates);
  if (!match) {
    return NextResponse.json({ match: null });
  }

  return NextResponse.json({
    match: { id: match.id, title: match.title, type: match.type },
  });
}
