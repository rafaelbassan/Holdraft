import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const ADMIN_COOKIE = "holdraft_admin";
const SESSION_SECONDS = 60 * 60 * 24 * 14;

type AdminRow = {
  id: number;
  username: string;
  password_hash: string;
  salt: string;
};

function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const password_hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, password_hash };
}

function passwordMatches(password: string, salt: string, hash: string): boolean {
  const next = scryptSync(password, salt, 64);
  const prev = Buffer.from(hash, "hex");
  if (next.length !== prev.length) {
    return false;
  }
  return timingSafeEqual(next, prev);
}

export function hasAdmin(): boolean {
  const row = getDb().prepare("SELECT id FROM admins WHERE id = 1").get();
  return Boolean(row);
}

export function getAdminUsername(): string | null {
  const row = getDb()
    .prepare("SELECT username FROM admins WHERE id = 1")
    .get() as { username: string } | undefined;
  return row?.username ?? null;
}

export function createAdmin(username: string, password: string): string | null {
  const name = username.trim();
  if (name.length < 2) {
    return "username_short";
  }
  if (password.length < 8) {
    return "password_short";
  }
  if (hasAdmin()) {
    return "already_configured";
  }
  const { salt, password_hash } = hashPassword(password);
  getDb()
    .prepare(
      "INSERT INTO admins (id, username, password_hash, salt) VALUES (1, ?, ?, ?)",
    )
    .run(name, password_hash, salt);
  return null;
}

export function verifyAdmin(username: string, password: string): boolean {
  const row = getDb()
    .prepare("SELECT * FROM admins WHERE id = 1")
    .get() as AdminRow | undefined;
  if (!row) {
    return false;
  }
  if (row.username !== username.trim()) {
    return false;
  }
  return passwordMatches(password, row.salt, row.password_hash);
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    secure: process.env.NODE_ENV === "production",
  };
}

export async function startAdminSession(): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  getDb()
    .prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)")
    .run(token, expiresAt);
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, cookieOptions(SESSION_SECONDS));
}

export async function clearAdminSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token) {
    getDb().prepare("DELETE FROM admin_sessions WHERE token = ?").run(token);
  }
  jar.set(ADMIN_COOKIE, "", cookieOptions(0));
}

export async function getAdminSession(): Promise<{ username: string } | null> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (!token) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const row = getDb()
    .prepare("SELECT token FROM admin_sessions WHERE token = ? AND expires_at > ?")
    .get(token, now);
  if (!row) {
    return null;
  }
  const username = getAdminUsername();
  return username ? { username } : null;
}

export async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
