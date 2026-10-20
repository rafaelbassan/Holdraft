import { NextRequest, NextResponse } from "next/server";
import { mergeAgentResultIntoDraft } from "@/lib/agent/draft-state";
import {
  agentErrorPayload,
  runAgent,
} from "@/lib/agent/run";
import { messagesForModel, sectionIsFull } from "@/lib/section-text";
import {
  addSectionMessage,
  getSection,
  getSectionMessages,
  parseDraftJson,
  removeStoredLlmFailures,
  updateSection,
} from "@/lib/sections";
import { getRawSetting, SETTING_KEYS } from "@/lib/settings";

function modelConfigured(): boolean {
  return Boolean(
    getRawSetting(SETTING_KEYS.modelBaseUrl) &&
      getRawSetting(SETTING_KEYS.modelApiKey) &&
      getRawSetting(SETTING_KEYS.modelName),
  );
}

function mapSectionDetailLocal(id: number) {
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

async function runTurn(id: number, sectionType: "consulta" | "criacao") {
  removeStoredLlmFailures(id);
  const history = getSectionMessages(id).map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));
  const messages = messagesForModel(history.filter((m) => m.role !== "system"));
  if (!messages.some((m) => m.role === "user")) {
    return NextResponse.json({ error: "message_required" }, { status: 400 });
  }

  try {
    const row = getSection(id);
    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const existingDraft = parseDraftJson(row.draft_json);
    const result = await runAgent({
      sectionType,
      messages,
      existingDraft,
    });

    updateSection(id, {
      draft_json: JSON.stringify(mergeAgentResultIntoDraft(existingDraft, result)),
      ...(result.intent === "criar" ? { type: "criacao" as const } : {}),
    });
    addSectionMessage(id, "assistant", result.message_markdown);

    return NextResponse.json({
      section: mapSectionDetailLocal(id),
      agent: result,
    });
  } catch (e) {
    const payload = agentErrorPayload(e);
    if (payload.detail?.trim()) {
      addSectionMessage(id, "assistant", payload.detail);
    }
    const status = payload.error === "model_not_configured" ? 503 : 502;
    return NextResponse.json(
      { ...payload, section: mapSectionDetailLocal(id) },
      { status },
    );
  }
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { id: idStr } = await context.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const section = getSection(id);
  if (!section) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: { message?: string; draft?: unknown; retry?: boolean };
  try {
    body = (await request.json()) as {
      message?: string;
      draft?: unknown;
      retry?: boolean;
    };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.draft !== undefined) {
    const existing = parseDraftJson(section.draft_json);
    const merged = {
      ...existing,
      draft: body.draft,
    };
    updateSection(id, { draft_json: JSON.stringify(merged) });
    return NextResponse.json({ section: mapSectionDetailLocal(id) });
  }

  if (!modelConfigured()) {
    return NextResponse.json({ error: "model_not_configured", retryable: false }, { status: 503 });
  }

  if (body.retry === true) {
    return runTurn(id, section.type);
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message_required" }, { status: 400 });
  }

  if (sectionIsFull(getSectionMessages(id))) {
    return NextResponse.json({ error: "section_full" }, { status: 409 });
  }

  addSectionMessage(id, "user", message);
  return runTurn(id, section.type);
}
