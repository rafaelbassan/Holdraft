import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  getSessionFromCookie,
  deleteSession,
} from "@/lib/jira/session";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromCookie();
  if (session) {
    deleteSession(session.id);
  }
  const response = NextResponse.redirect(new URL("/settings", request.url));
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return POST(request);
}
