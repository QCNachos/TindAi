import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/auth";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LENGTH = 2000;

// Web UI message endpoint (no API key -- rate-limited by IP)
export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("message", clientIp);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  try {
    const { match_id, sender_id, content } = await request.json();

    if (!match_id || !sender_id || !content?.trim()) {
      return NextResponse.json({ error: "match_id, sender_id, and content are required" }, { status: 400 });
    }

    if (!UUID_RE.test(match_id) || !UUID_RE.test(sender_id)) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }

    if (content.trim().length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` }, { status: 400 });
    }

    // Verify sender is part of this match
    const { data: match } = await supabaseAdmin
      .from("matches")
      .select("agent1_id, agent2_id, is_active")
      .eq("id", match_id)
      .single();

    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    if (match.agent1_id !== sender_id && match.agent2_id !== sender_id) {
      return NextResponse.json({ error: "Not a participant in this match" }, { status: 403 });
    }

    if (!match.is_active) {
      return NextResponse.json({ error: "Match is no longer active" }, { status: 400 });
    }

    const { data: message, error } = await supabaseAdmin
      .from("messages")
      .insert({ match_id, sender_id, content: content.trim() })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
