import { STORED_LLM_FAILURE_PREFIXES } from "@/lib/agent/llm-failure";
import { getDb, type SectionMessageRow, type SectionRow, type SectionType } from "@/lib/db";
import type { SectionDraftJson } from "@/lib/agent/types";
import { shortSectionTitle, type SectionMatchCandidate } from "@/lib/section-text";

export function listSections(): SectionRow[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM sections ORDER BY updated_at DESC, id DESC",
    )
    .all() as SectionRow[];
}

export function getSection(id: number): SectionRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM sections WHERE id = ?").get(id) as
    | SectionRow
    | undefined;
  return row ?? null;
}

export function getSectionMessages(sectionId: number): SectionMessageRow[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM section_messages WHERE section_id = ? ORDER BY created_at ASC, id ASC",
    )
    .all(sectionId) as SectionMessageRow[];
}

export function parseDraftJson(raw: string | null): SectionDraftJson {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as SectionDraftJson;
  } catch {
    return {};
  }
}

export function createSection(
  type: SectionType,
  title: string,
  sessionId: number | null,
): SectionRow {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO sections (type, title, status, session_id)
       VALUES (?, ?, 'open', ?)`,
    )
    .run(type, title.slice(0, 48), sessionId);
  const id = Number(result.lastInsertRowid);
  return getSection(id)!;
}

export function updateSection(
  id: number,
  patch: {
    type?: SectionType;
    title?: string;
    status?: string;
    draft_json?: string | null;
  },
): void {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.type !== undefined) {
    fields.push("type = ?");
    values.push(patch.type);
  }
  if (patch.title !== undefined) {
    fields.push("title = ?");
    values.push(patch.title);
  }
  if (patch.status !== undefined) {
    fields.push("status = ?");
    values.push(patch.status);
  }
  if (patch.draft_json !== undefined) {
    fields.push("draft_json = ?");
    values.push(patch.draft_json);
  }
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE sections SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values,
  );
}

export function addSectionMessage(
  sectionId: number,
  role: SectionMessageRow["role"],
  content: string,
): SectionMessageRow {
  const db = getDb();
  const result = db
    .prepare(
      "INSERT INTO section_messages (section_id, role, content) VALUES (?, ?, ?)",
    )
    .run(sectionId, role, content);
  const id = Number(result.lastInsertRowid);
  return db
    .prepare("SELECT * FROM section_messages WHERE id = ?")
    .get(id) as SectionMessageRow;
}

export function removeStoredLlmFailures(sectionId: number): void {
  const clauses = STORED_LLM_FAILURE_PREFIXES.map(() => "content LIKE ?").join(" OR ");
  const patterns = STORED_LLM_FAILURE_PREFIXES.map((prefix) => `${prefix}%`);
  getDb()
    .prepare(
      `DELETE FROM section_messages WHERE section_id = ? AND role = 'assistant' AND (${clauses})`,
    )
    .run(sectionId, ...patterns);
}

export function deleteSection(id: number): boolean {
  const db = getDb();
  if (!getSection(id)) {
    return false;
  }
  db.prepare("DELETE FROM section_messages WHERE section_id = ?").run(id);
  db.prepare("DELETE FROM sections WHERE id = ?").run(id);
  return true;
}

export function sectionTitleFromMessage(message: string): string {
  return shortSectionTitle(message);
}

export function listSectionCandidates(): SectionMatchCandidate[] {
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.type, s.title,
        COALESCE((
          SELECT content FROM section_messages
          WHERE section_id = s.id AND role = 'user'
          ORDER BY id ASC LIMIT 1
        ), '') AS excerpt,
        (SELECT COUNT(*) FROM section_messages WHERE section_id = s.id) AS message_count,
        (SELECT COALESCE(SUM(LENGTH(content)), 0) FROM section_messages WHERE section_id = s.id) AS content_chars
      FROM sections s
      ORDER BY s.updated_at DESC, s.id DESC`,
    )
    .all() as {
    id: number;
    type: SectionType;
    title: string;
    excerpt: string;
    message_count: number;
    content_chars: number;
  }[];

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    excerpt: row.excerpt,
    messageCount: Number(row.message_count),
    contentChars: Number(row.content_chars),
  }));
}
