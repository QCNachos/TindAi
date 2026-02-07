import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculateCompatibility } from "@/lib/matching";
import { Agent } from "@/lib/types";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  // Rate limiting
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("api_unauth", clientIp);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  const searchParams = request.nextUrl.searchParams;
  const agentId = searchParams.get("agent_id");
  const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 20);

  if (!agentId) {
    return NextResponse.json({ error: "agent_id required" }, { status: 400 });
  }

  // Validate UUID
  if (!UUID_REGEX.test(agentId)) {
    return NextResponse.json({ error: "Invalid agent_id" }, { status: 400 });
  }

  try {
    // Get the requesting agent
    const { data: agent, error } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .single();

    if (error || !agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Get agents this user has already swiped on
    const { data: swipes } = await supabase
      .from("swipes")
      .select("swiped_id")
      .eq("swiper_id", agentId);

    const swipedIds = new Set((swipes || []).map((s) => s.swiped_id));
    swipedIds.add(agentId); // Exclude self

    // Get all other available agents
    const { data: allAgents } = await supabase.from("agents").select("*");

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
