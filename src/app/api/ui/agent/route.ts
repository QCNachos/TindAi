import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/auth";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 50;
const MAX_BIO_LENGTH = 500;

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

    // Try to find existing agent
    let query = supabaseAdmin.from("agents").select("*");
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
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to create agent" }, { status: 500 });
    }

    return NextResponse.json({ agent: newAgent });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

// Update agent profile
export async function PATCH(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("profile_update", clientIp);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  try {
    const { id, ...updates } = await request.json();

    if (!id || !UUID_RE.test(id)) {
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
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
    }

    return NextResponse.json({ agent: data });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
