import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { apiError } from "@/lib/errors";

export async function GET() {
  try {
    const session = await getSession();
    return NextResponse.json({ authenticated: Boolean(session), user: session ? { email: session.email } : null });
  } catch (error) {
    return apiError(error);
  }
}
