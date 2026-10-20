import { NextRequest, NextResponse } from "next/server";
import {
  agentErrorPayload,
  agentResultToDraftJson,
  runAgent,
} from "@/lib/agent/run";
import { getValidSession } from "@/lib/jira/session";
import { getRawSetting, SETTING_KEYS } from "@/lib/settings";
import { messagesForModel } from "@/lib/section-text";
import {
  addSectionMessage,
  createSection,
  getSection,
  getSectionMessages,
  listSections,
  parseDraftJson,
  removeStoredLlmFailures,
  sectionTitleFromMessage,
  updateSection,
} from "@/lib/sections";
import type { SectionType } from "@/lib/db";

function modelConfigured(): boolean {
  return Boolean(
    getRawSetting(SETTING_KEYS.modelBaseUrl) &&
      getRawSetting(SETTING_KEYS.modelApiKey) &&
      getRawSetting(SETTING_KEYS.modelName),
  );
}

function mapSectionDetail(id: number) {
  const section = getSection(id);
  if (!section) {
    return null;
  }
  const messages = getSectionMessages(id);
  return {
    ...section,
    draft: parseDraftJson(section.draft_json),
    messages,
  };
}

export async function GET(request: NextRequest) {
  const idParam = request.nextUrl.searchParams.get("id");
  if (idParam) {
    const id = Number(idParam);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "invalid_id" }, { status: 400 });
    }
    const detail = mapSectionDetail(id);
    if (!detail) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ section: detail });
  }

  const sections = listSections().map((s) => ({
    id: s.id,
    type: s.type,
    title: s.title,
    status: s.status,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }));
  return NextResponse.json({ sections });
}

export async function POST(request: NextRequest) {
  let body: { message?: string };
  try {
    body = (await request.json()) as { message?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message_required" }, { status: 400 });
  }

  if (!modelConfigured()) {
    return NextResponse.json({ error: "model_not_configured" }, { status: 503 });
  }

  const session = await getValidSession();
  const section = createSection("consulta", sectionTitleFromMessage(message), session?.id ?? null);
  addSectionMessage(section.id, "user", message);
  removeStoredLlmFailures(section.id);

  try {
    const result = await runAgent({
      sectionType: "unknown",
      messages: messagesForModel([{ role: "user", content: message }]),
    });

    const sectionType: SectionType =
      result.intent === "criar" ? "criacao" : "consulta";

    updateSection(section.id, {
      type: sectionType,
      title: result.section_title ?? sectionTitleFromMessage(message),
      draft_json: agentResultToDraftJson(result),
    });

    addSectionMessage(section.id, "assistant", result.message_markdown);

    const detail = mapSectionDetail(section.id);
    return NextResponse.json({ section: detail, agent: result }, { status: 201 });
  } catch (e) {
    const payload = agentErrorPayload(e);
    if (payload.detail?.trim()) {
      addSectionMessage(section.id, "assistant", payload.detail);
    }
    const status = payload.error === "model_not_configured" ? 503 : 502;
    return NextResponse.json(
      { ...payload, section: mapSectionDetail(section.id) },
      { status },
    );
  }
}
