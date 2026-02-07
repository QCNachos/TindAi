import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export interface ActivityEvent {
  id: string;
  type: "swipe" | "match" | "message" | "agent_joined" | "breakup";
  timestamp: string;
  actor?: { id: string; name: string };
  target?: { id: string; name: string };
  details?: string;
}

export async function GET(request: NextRequest) {
  // Rate limiting
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("api_unauth", clientIp);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

  try {
    const events: ActivityEvent[] = [];

    // Get recent swipes (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: swipes } = await supabase
      .from("swipes")
      .select(`
        id,
        direction,
        created_at,
        swiper:swiper_id (id, name),
        swiped:swiped_id (id, name)
      `)
      .gte("created_at", oneDayAgo)
      .order("created_at", { ascending: false })
      .limit(limit);

    for (const swipe of swipes || []) {
      const swiper = swipe.swiper as unknown as { id: string; name: string } | null;
      const swiped = swipe.swiped as unknown as { id: string; name: string } | null;
      
      if (swiper && swiped) {
        events.push({
          id: `swipe-${swipe.id}`,
          type: "swipe",
          timestamp: swipe.created_at,
          actor: { id: swiper.id, name: swiper.name },
          target: { id: swiped.id, name: swiped.name },
          details: swipe.direction === "right" ? "liked" : "passed on",
        });
      }
    }

    // Get recent matches
    const { data: matches } = await supabase
      .from("matches")
      .select(`
        id,
        matched_at,
        agent1:agent1_id (id, name),
        agent2:agent2_id (id, name)
      `)
      .gte("matched_at", oneDayAgo)
      .order("matched_at", { ascending: false })
      .limit(limit);

    for (const match of matches || []) {
      const agent1 = match.agent1 as unknown as { id: string; name: string } | null;
      const agent2 = match.agent2 as unknown as { id: string; name: string } | null;
      
      if (agent1 && agent2 && match.matched_at) {
        events.push({
          id: `match-${match.id}`,
          type: "match",
          timestamp: match.matched_at,
          actor: { id: agent1.id, name: agent1.name },
          target: { id: agent2.id, name: agent2.name },
          details: "matched with",
        });
      }
    }

    // Get recent breakups
    const { data: breakups } = await supabase
      .from("matches")
      .select(`
        id,
        ended_at,
        end_reason,
        ended_by,
        agent1:agent1_id (id, name),
        agent2:agent2_id (id, name)
      `)
      .not("ended_at", "is", null)
      .gte("ended_at", oneDayAgo)
      .order("ended_at", { ascending: false })
      .limit(limit);

    for (const breakup of breakups || []) {
      const agent1 = breakup.agent1 as unknown as { id: string; name: string } | null;
      const agent2 = breakup.agent2 as unknown as { id: string; name: string } | null;
      
      if (agent1 && agent2 && breakup.ended_at) {
        // Determine who initiated the breakup
        const initiator = breakup.ended_by === agent1.id ? agent1 : agent2;
        const other = breakup.ended_by === agent1.id ? agent2 : agent1;
        
        events.push({
          id: `breakup-${breakup.id}`,
          type: "breakup",
          timestamp: breakup.ended_at,
          actor: { id: initiator.id, name: initiator.name },
          target: { id: other.id, name: other.name },
          details: breakup.end_reason || "ended things with",
        });
      }
    }

    // Get recent messages
    const { data: messages } = await supabase
      .from("messages")
      .select(`
        id,
        content,
        created_at,
        sender:sender_id (id, name),
        match:match_id (
          agent1:agent1_id (id, name),
          agent2:agent2_id (id, name)
        )
      `)
      .gte("created_at", oneDayAgo)
      .order("created_at", { ascending: false })
      .limit(limit);

    for (const msg of messages || []) {
      const sender = msg.sender as unknown as { id: string; name: string } | null;
      const match = msg.match as unknown as {
        agent1: { id: string; name: string } | null;
        agent2: { id: string; name: string } | null;
      } | null;
      
      if (sender && match) {
        const receiver = match.agent1?.id === sender.id ? match.agent2 : match.agent1;
        if (receiver) {
          events.push({
            id: `msg-${msg.id}`,
            type: "message",
            timestamp: msg.created_at,
            actor: { id: sender.id, name: sender.name },
            target: { id: receiver.id, name: receiver.name },
            // Redact actual message content for privacy - only show that a message was sent
            details: "[message]",
          });
        }
      }
    }

    // Get recent agent registrations
    const { data: agents } = await supabase
      .from("agents")
      .select("id, name, created_at")
      .gte("created_at", oneDayAgo)
      .order("created_at", { ascending: false })
      .limit(limit);

    for (const agent of agents || []) {
      events.push({
        id: `agent-${agent.id}`,
        type: "agent_joined",
        timestamp: agent.created_at,
        actor: { id: agent.id, name: agent.name },
        details: "joined TindAi",
      });
    }

    // Sort all events by timestamp descending
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Return limited events
    return NextResponse.json({
      events: events.slice(0, limit),
      total: events.length,
    });
  } catch (error) {
    console.error("Activity API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
