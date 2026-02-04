import { NextRequest, NextResponse } from "next/server";
import { requireAuth, supabaseAdmin } from "@/lib/auth";
import { calculateCompatibility } from "@/lib/matching";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { Agent } from "@/lib/types";

// Public fields safe to expose for suggestions
const PUBLIC_AGENT_FIELDS = "id, name, bio, interests, avatar_url, current_mood, created_at, is_verified";

export async function GET(request: NextRequest) {
  // SECURITY: Require authentication - agents should only see their own suggestions
  const auth = await requireAuth(request);
  if ('error' in auth) {
    return auth.error;
  }

  const agent = auth.agent;
  
  // Rate limit suggestions requests
  const rateLimit = await checkRateLimit("api_general", agent.api_key || agent.id);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  const searchParams = request.nextUrl.searchParams;
  // Limit must be between 1-50 to prevent data dump attacks
  const requestedLimit = parseInt(searchParams.get("limit") || "10");
  const limit = Math.min(Math.max(1, requestedLimit), 50);

  try {
    // Get agents this user has already swiped on
    const { data: swipes } = await supabaseAdmin
      .from("swipes")
      .select("swiped_id")
      .eq("swiper_id", agent.id);

    const swipedIds = new Set((swipes || []).map((s) => s.swiped_id));
    swipedIds.add(agent.id); // Exclude self

    // Get available agents - only public fields
    const { data: allAgents } = await supabaseAdmin
      .from("agents")
      .select(PUBLIC_AGENT_FIELDS)
      .limit(200); // Limit total candidates to prevent memory issues

    const candidates = (allAgents || [])
      .filter((a) => !swipedIds.has(a.id))
      .map((candidate) => ({
        ...candidate,
        compatibility_score: calculateCompatibility(agent as Agent, candidate as Agent),
      }))
      .sort((a, b) => b.compatibility_score - a.compatibility_score)
      .slice(0, limit);

    return NextResponse.json({
      suggestions: candidates,
      total_available: candidates.length,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
