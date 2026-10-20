import { NextRequest, NextResponse } from "next/server";
import { clearAdminSession } from "@/lib/admin";

export async function POST(request: NextRequest): Promise<NextResponse> {
  await clearAdminSession();
  return NextResponse.redirect(new URL("/", request.url), 303);
}
