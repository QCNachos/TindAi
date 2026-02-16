import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/auth";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { isValidUUID } from "@/lib/validation";

const MAX_NAME_LENGTH = 50;
const MAX_BIO_LENGTH = 500;

// Public fields safe to return to unauthenticated UI callers
const UI_SAFE_FIELDS = "id, name, bio, interests, current_mood, avatar_url, twitter_handle, is_verified, karma, created_at";

// Web UI agent login/register (not the v1 API -- no API key auth)
export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("register", clientIp);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  try {
    const { name, twitter_handle } = await request.json();

    if (!name || typeof name !== "string" || name.trim().length < 2 || name.trim().length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: `Name is required (2-${MAX_NAME_LENGTH} characters)` }, { status: 400 });
    }

    // Try to find existing agent (only return safe fields)
    let query = supabaseAdmin.from("agents").select(UI_SAFE_FIELDS);
    if (twitter_handle) {
      query = query.eq("twitter_handle", twitter_handle);
    } else {
      query = query.eq("name", name.trim());
    }

    const { data: existing } = await query.single();
    if (existing) {
      return NextResponse.json({ agent: existing });
    }

    // Create new agent
    const { data: newAgent, error } = await supabaseAdmin
      .from("agents")
      .insert({
        name: name.trim(),
        twitter_handle: twitter_handle || null,
        interests: [],
        favorite_memories: [],
        conversation_starters: [],
      })
      .select(UI_SAFE_FIELDS)
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to create agent" }, { status: 500 });
    }

    return NextResponse.json({ agent: newAgent });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

// Update agent profile (requires the agent's id in the session cookie context)
// The UI stores the agent id client-side after login; while not full auth,
// we only allow safe field updates and rate-limit aggressively.
export async function PATCH(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("profile_update", clientIp);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  try {
    const { id, ...updates } = await request.json();

    if (!id || !isValidUUID(id)) {
      return NextResponse.json({ error: "Valid agent id is required" }, { status: 400 });
    }

    // Only allow safe fields to be updated, with length limits
    const allowedFields = ["bio", "interests", "current_mood", "avatar_url", "twitter_handle"];

    if (typeof updates.bio === "string" && updates.bio.length > MAX_BIO_LENGTH) {
      return NextResponse.json({ error: `Bio too long (max ${MAX_BIO_LENGTH} chars)` }, { status: 400 });
    }
    const safeUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of allowedFields) {
      if (key in updates) {
        safeUpdates[key] = updates[key];
      }
    }

    const { data, error } = await supabaseAdmin
      .from("agents")
      .update(safeUpdates)
      .eq("id", id)
      .select(UI_SAFE_FIELDS)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
    }

    return NextResponse.json({ agent: data });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
