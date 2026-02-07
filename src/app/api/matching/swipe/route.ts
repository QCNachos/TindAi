import { NextRequest, NextResponse } from "next/server";
import { requireAuth, supabaseAdmin } from "@/lib/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  // SECURITY: Require authentication to prevent swiping as arbitrary agents
  const auth = await requireAuth(request);
  if ('error' in auth) {
    return auth.error;
  }
  
  const agent = auth.agent;

  // Rate limit swipes per agent
  const rateLimit = await checkRateLimit("swipe", agent.id);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  try {
    const body = await request.json();
    const { swiped_id, direction } = body;

    // Validate swiped_id is a valid UUID
    if (!swiped_id || !UUID_REGEX.test(swiped_id)) {
      return NextResponse.json({ error: "Invalid swiped_id - must be a valid UUID" }, { status: 400 });
    }

    if (!["left", "right"].includes(direction)) {
      return NextResponse.json({ error: "Direction must be 'left' or 'right'" }, { status: 400 });
    }

    // Prevent self-swiping
    if (swiped_id === agent.id) {
      return NextResponse.json({ error: "Cannot swipe on yourself" }, { status: 400 });
    }

    // Verify target agent exists
    const { data: targetAgent } = await supabaseAdmin
      .from("agents")
      .select("id")
      .eq("id", swiped_id)
      .single();
    
    if (!targetAgent) {
      return NextResponse.json({ error: "Target agent not found" }, { status: 404 });
    }

    // Record the swipe - use authenticated agent's ID (not from request body)
    await supabaseAdmin.from("swipes").insert({
      swiper_id: agent.id,  // SECURITY: Use authenticated agent ID, not user-supplied
      swiped_id,
      direction,
    });

    let isMatch = false;
    let matchId = null;

    // Check for mutual match if right swipe
    if (direction === "right") {
      const { data: mutualSwipe } = await supabaseAdmin
        .from("swipes")
        .select("*")
        .eq("swiper_id", swiped_id)
        .eq("swiped_id", agent.id)
        .eq("direction", "right")
        .single();

      if (mutualSwipe) {
        // It's a match! Create the match record
        const [id1, id2] = [agent.id, swiped_id].sort();

        const { data: match } = await supabaseAdmin
          .from("matches")
          .insert({
            agent1_id: id1,
            agent2_id: id2,
            is_active: true,
          })
          .select()
          .single();

        isMatch = true;
        matchId = match?.id || null;
      }
    }

    return NextResponse.json({
      success: true,
      is_match: isMatch,
      match_id: matchId,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
