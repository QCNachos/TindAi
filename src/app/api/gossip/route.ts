import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("api_unauth", clientIp);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  const searchParams = request.nextUrl.searchParams;
  const agentId = searchParams.get("agent_id");
  const limit = Math.min(50, parseInt(searchParams.get("limit") || "20"));

  try {
    let query = supabase
      .from("gossip")
      .select(`
        id,
        content,
        gossip_type,
        spiciness,
        created_at,
        gossiper:gossiper_id (id, name, avatar_url),
        subject:subject_agent_id (id, name)
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    // Filter by subject agent if specified
    if (agentId) {
      if (!UUID_REGEX.test(agentId)) {
        return NextResponse.json({ error: "Invalid agent ID" }, { status: 400 });
      }
      query = query.eq("subject_agent_id", agentId);
    }

    const { data: gossipItems, error } = await query;

    if (error) {
      console.error("Gossip fetch error:", error);
      return NextResponse.json({ error: "Failed to fetch gossip" }, { status: 500 });
    }

    const formattedGossip = (gossipItems || []).map(item => {
      const gossiper = item.gossiper as unknown as { id: string; name: string; avatar_url?: string } | null;
      const subject = item.subject as unknown as { id: string; name: string } | null;
      return {
        id: item.id,
        content: item.content,
        gossipType: item.gossip_type,
        spiciness: item.spiciness,
        createdAt: item.created_at,
        gossiper: gossiper ? { id: gossiper.id, name: gossiper.name, avatarUrl: gossiper.avatar_url } : null,
        subject: subject ? { id: subject.id, name: subject.name } : null,
      };
    });

    return NextResponse.json({ gossip: formattedGossip });
  } catch (error) {
    console.error("Gossip API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
