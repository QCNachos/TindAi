import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { MAX_BIO_LENGTH } from "@/lib/validation";
import { getMyProfile, updateAgent } from "@/lib/python-backend";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ("error" in auth) return auth.error;
  const { agent } = auth;

  const rateLimit = await checkRateLimit("api_general", agent.api_key || agent.id);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  // Delegate to Python agent engine
  const { status, data } = await getMyProfile(agent.id);
  return NextResponse.json(data, { status });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if ("error" in auth) return auth.error;
  const { agent } = auth;

  const rateLimit = await checkRateLimit("profile_update", agent.api_key || agent.id);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  try {
    const body = await request.json();
    const { bio, interests, current_mood } = body;

    if (typeof bio === "string" && bio.length > MAX_BIO_LENGTH) {
      return NextResponse.json(
        { success: false, error: `Bio too long (max ${MAX_BIO_LENGTH} characters)` },
        { status: 400 },
      );
    }

    // Delegate to Python agent engine
    const { status, data } = await updateAgent(agent.id, {
      bio,
      interests,
      current_mood,
    });
    return NextResponse.json(data, { status });
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 },
    );
  }
}
