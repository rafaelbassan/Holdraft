import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "holdraft.db");

let dbInstance: DatabaseSync | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      atlassian_account_id TEXT NOT NULL UNIQUE,
      atlassian_display_name TEXT,
      atlassian_email TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at INTEGER,
      cloud_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('consulta', 'criacao')),
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      draft_json TEXT,
      session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS section_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_section_messages_section_id
      ON section_messages(section_id);

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

export function getDb(): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }
  ensureDataDir();
  dbInstance = new DatabaseSync(DB_PATH);
  migrate(dbInstance);
  return dbInstance;
}

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export type SectionType = "consulta" | "criacao";

export type SectionRow = {
  id: number;
  type: SectionType;
  title: string;
  status: string;
  draft_json: string | null;
  session_id: number | null;
  created_at: number;
  updated_at: number;
};

export type SectionMessageRow = {
  id: number;
  section_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: number;
};

export type SessionRow = {
  id: number;
  atlassian_account_id: string;
  atlassian_display_name: string | null;
  atlassian_email: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: number | null;
  cloud_id: string | null;
  created_at: number;
  updated_at: number;
};
