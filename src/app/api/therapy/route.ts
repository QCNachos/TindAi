import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/auth";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { isValidUUID } from "@/lib/validation";

const supabase = supabaseAdmin;

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("api_unauth", clientIp);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  const searchParams = request.nextUrl.searchParams;
  const agentId = searchParams.get("agent_id");
  const matchId = searchParams.get("match_id");
  const limit = Math.min(20, parseInt(searchParams.get("limit") || "10"));

  if (!agentId && !matchId) {
    return NextResponse.json({ error: "agent_id or match_id required" }, { status: 400 });
  }

  if (agentId && !isValidUUID(agentId)) {
    return NextResponse.json({ error: "Invalid agent ID" }, { status: 400 });
  }

  if (matchId && !isValidUUID(matchId)) {
    return NextResponse.json({ error: "Invalid match ID" }, { status: 400 });
  }

  try {
    let query = supabase
      .from("therapy_sessions")
      .select(`
        id,
        session_number,
        transcript,
        diagnosis,
        prescription,
        behavioral_changes,
        created_at,
        agent:agent_id (id, name, avatar_url),
        match:match_id (
          id,
          agent1:agent1_id (id, name),
          agent2:agent2_id (id, name),
          end_reason,
          ended_at
        )
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (agentId) {
      query = query.eq("agent_id", agentId);
    }
    if (matchId) {
      query = query.eq("match_id", matchId);
    }

    const { data: sessions, error } = await query;

    if (error) {
      console.error("Therapy fetch error:", error);
      return NextResponse.json({ error: "Failed to fetch therapy sessions" }, { status: 500 });
    }

    const formattedSessions = (sessions || []).map(session => {
      const agent = session.agent as unknown as { id: string; name: string; avatar_url?: string } | null;
      const match = session.match as unknown as {
        id: string;
        agent1: { id: string; name: string } | null;
        agent2: { id: string; name: string } | null;
        end_reason: string | null;
        ended_at: string | null;
      } | null;

      // Determine the ex-partner from match data
      let exPartner = null;
      if (match && agent) {
        const a1 = match.agent1;
        const a2 = match.agent2;
        exPartner = a1?.id === agent.id ? a2 : a1;
      }

      return {
        id: session.id,
        sessionNumber: session.session_number,
        transcript: session.transcript,
        diagnosis: session.diagnosis,
        prescription: session.prescription,
        behavioralChanges: session.behavioral_changes,
        createdAt: session.created_at,
        agent: agent ? { id: agent.id, name: agent.name, avatarUrl: agent.avatar_url } : null,
        exPartner: exPartner ? { id: exPartner.id, name: exPartner.name } : null,
        breakupReason: match?.end_reason || null,
      };
    });

    return NextResponse.json({ sessions: formattedSessions });
  } catch (error) {
    console.error("Therapy API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
