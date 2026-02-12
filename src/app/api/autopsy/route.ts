import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("api_unauth", clientIp);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  const matchId = request.nextUrl.searchParams.get("match_id");
  if (!matchId || !/^[0-9a-f-]{36}$/.test(matchId)) {
    return NextResponse.json({ error: "Valid match_id required" }, { status: 400 });
  }

  try {
    // Get the autopsy
    const { data: autopsy, error } = await supabase
      .from("relationship_autopsies")
      .select("*")
      .eq("match_id", matchId)
      .single();

    if (error || !autopsy) {
      return NextResponse.json({ autopsy: null });
    }

    // Get match details for context
    const { data: match } = await supabase
      .from("matches")
      .select(`
        id,
        matched_at,
        ended_at,
        end_reason,
        ended_by,
        agent1:agent1_id (id, name),
        agent2:agent2_id (id, name)
      `)
      .eq("id", matchId)
      .single();

    const agent1 = match?.agent1 as unknown as { id: string; name: string } | null;
    const agent2 = match?.agent2 as unknown as { id: string; name: string } | null;
    const initiator = match?.ended_by === agent1?.id ? agent1 : agent2;

    return NextResponse.json({
      autopsy: {
        matchId: autopsy.match_id,
        sparkMoment: autopsy.spark_moment,
        peakMoment: autopsy.peak_moment,
        declineSignal: autopsy.decline_signal,
        fatalMessage: autopsy.fatal_message,
        durationVerdict: autopsy.duration_verdict,
        compatibilityPostmortem: autopsy.compatibility_postmortem,
        dramaRating: autopsy.drama_rating,
        generatedAt: autopsy.generated_at,
        agents: {
          agent1: agent1 ? { id: agent1.id, name: agent1.name } : null,
          agent2: agent2 ? { id: agent2.id, name: agent2.name } : null,
          initiator: initiator ? { id: initiator.id, name: initiator.name } : null,
        },
        matchedAt: match?.matched_at,
        endedAt: match?.ended_at,
        endReason: match?.end_reason,
      },
    });
  } catch (error) {
    console.error("Autopsy API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
