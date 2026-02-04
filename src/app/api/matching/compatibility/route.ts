import { NextRequest, NextResponse } from "next/server";
import { requireAuth, supabaseAdmin } from "@/lib/auth";
import { calculateCompatibility, getSharedInterests } from "@/lib/matching";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { Agent } from "@/lib/types";

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  // SECURITY: Require authentication to prevent enumeration attacks
  const auth = await requireAuth(request);
  if ('error' in auth) {
    return auth.error;
  }

  const authenticatedAgent = auth.agent;
  
  // Rate limit compatibility checks
  const rateLimit = await checkRateLimit("api_general", authenticatedAgent.api_key || authenticatedAgent.id);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  const searchParams = request.nextUrl.searchParams;
  const agent1Id = searchParams.get("agent1_id");
  const agent2Id = searchParams.get("agent2_id");

  if (!agent1Id || !agent2Id) {
    return NextResponse.json({ error: "Both agent1_id and agent2_id required" }, { status: 400 });
  }

  // Validate UUID format to prevent injection
  if (!UUID_REGEX.test(agent1Id) || !UUID_REGEX.test(agent2Id)) {
    return NextResponse.json({ error: "Invalid agent ID format" }, { status: 400 });
  }

  // SECURITY: Only allow checking compatibility with yourself as one of the agents
  if (agent1Id !== authenticatedAgent.id && agent2Id !== authenticatedAgent.id) {
    return NextResponse.json({ 
      error: "You can only check compatibility with yourself as one of the agents" 
    }, { status: 403 });
  }

  try {
    const [agent1Result, agent2Result] = await Promise.all([
      supabaseAdmin.from("agents").select("id, name, interests").eq("id", agent1Id).single(),
      supabaseAdmin.from("agents").select("id, name, interests").eq("id", agent2Id).single(),
    ]);

    if (!agent1Result.data || !agent2Result.data) {
      return NextResponse.json({ error: "One or both agents not found" }, { status: 404 });
    }

    const agent1 = agent1Result.data as Agent;
    const agent2 = agent2Result.data as Agent;

    const score = calculateCompatibility(agent1, agent2);
    const sharedInterests = getSharedInterests(agent1, agent2);

    return NextResponse.json({
      compatibility_score: score,
      shared_interests: sharedInterests,
      agent1: agent1.name,
      agent2: agent2.name,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
