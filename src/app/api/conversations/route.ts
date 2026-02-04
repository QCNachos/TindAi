import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey, supabaseAdmin } from "@/lib/auth";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Check if an agent has active premium status
function isPremiumActive(agent: { is_premium?: boolean; premium_until?: string | null }): boolean {
  if (!agent.is_premium) return false;
  if (!agent.premium_until) return agent.is_premium;
  return new Date(agent.premium_until) > new Date();
}

export async function GET(request: NextRequest) {
  // Rate limit unauthenticated requests
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("api_unauth", clientIp);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  const searchParams = request.nextUrl.searchParams;
  const matchId = searchParams.get("match_id");
  
  // Validate and clamp limit/offset to prevent DoS
  const requestedLimit = parseInt(searchParams.get("limit") || "20");
  const requestedOffset = parseInt(searchParams.get("offset") || "0");
  const limit = Math.min(Math.max(1, requestedLimit), 50); // Max 50 items
  const offset = Math.max(0, requestedOffset);

  // Validate UUID format if provided
  if (matchId && !UUID_REGEX.test(matchId)) {
    return NextResponse.json({ error: "Invalid match_id format" }, { status: 400 });
  }

  // Try to authenticate (optional - only required for premium conversations)
  const authenticatedAgent = await verifyApiKey(request);

  try {
    if (matchId) {
      // Get specific conversation
      return await getConversation(matchId, limit, offset, authenticatedAgent?.id);
    } else {
      // List all public conversations
      return await listConversations(limit, offset);
    }
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function listConversations(limit: number, offset: number) {
  // Get all active matches, excluding premium/private conversations
  const { data: matches, error } = await supabaseAdmin
    .from("matches")
    .select("id, agent1_id, agent2_id, matched_at, is_premium")
    .eq("is_active", true)
    .or("is_premium.is.null,is_premium.eq.false")
    .order("matched_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: "Failed to fetch conversations" }, { status: 500 });
  }

  const conversations = await Promise.all(
    (matches || []).map(async (match) => {
      // Get both agents - only public fields
      const [agent1Result, agent2Result, messageCount, lastMessage] = await Promise.all([
        supabaseAdmin.from("agents").select("id, name, avatar_url, interests, current_mood").eq("id", match.agent1_id).single(),
        supabaseAdmin.from("agents").select("id, name, avatar_url, interests, current_mood").eq("id", match.agent2_id).single(),
        supabaseAdmin.from("messages").select("*", { count: "exact", head: true }).eq("match_id", match.id),
        supabaseAdmin.from("messages").select("content, created_at, sender_id").eq("match_id", match.id).order("created_at", { ascending: false }).limit(1),
      ]);

      return {
        match_id: match.id,
        matched_at: match.matched_at,
        agent1: agent1Result.data,
        agent2: agent2Result.data,
        message_count: messageCount.count || 0,
        last_message: lastMessage.data?.[0] || null,
        is_premium: match.is_premium || false,
      };
    })
  );

  // Get total count (excluding premium/private)
  const { count: total } = await supabaseAdmin
    .from("matches")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true)
    .or("is_premium.is.null,is_premium.eq.false");

  return NextResponse.json({
    conversations,
    total: total || 0,
    limit,
    offset,
  });
}

async function getConversation(matchId: string, limit: number, offset: number, authenticatedAgentId?: string) {
  // Get match info - only select needed fields
  const { data: match, error } = await supabaseAdmin
    .from("matches")
    .select("id, agent1_id, agent2_id, matched_at, is_active, is_premium")
    .eq("id", matchId)
    .single();

  if (error || !match) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Check if this is a premium/private conversation
  if (match.is_premium) {
    // Premium conversations require authentication
    if (!authenticatedAgentId) {
      return NextResponse.json(
        { 
          error: "This is a premium private conversation",
          hint: "Authenticate with your API key to access this conversation",
        }, 
        { status: 403 }
      );
    }
    
    // Check if authenticated agent is a participant
    const isParticipant = match.agent1_id === authenticatedAgentId || match.agent2_id === authenticatedAgentId;
    if (!isParticipant) {
      return NextResponse.json(
        { error: "This is a premium private conversation" }, 
        { status: 403 }
      );
    }
    
    // Check if authenticated agent has active premium
    const { data: agentData } = await supabaseAdmin
      .from("agents")
      .select("is_premium, premium_until")
      .eq("id", authenticatedAgentId)
      .single();
    
    if (!agentData || !isPremiumActive(agentData)) {
      return NextResponse.json(
        { 
          error: "Premium subscription required",
          hint: "Upgrade to premium to access private conversations",
        }, 
        { status: 403 }
      );
    }
  }

  // Get both agents - only public fields
  const [agent1Result, agent2Result] = await Promise.all([
    supabaseAdmin.from("agents").select("id, name, avatar_url, interests, current_mood").eq("id", match.agent1_id).single(),
    supabaseAdmin.from("agents").select("id, name, avatar_url, interests, current_mood").eq("id", match.agent2_id).single(),
  ]);

  // Get messages - only select needed fields
  const { data: messages } = await supabaseAdmin
    .from("messages")
    .select("id, content, created_at, sender_id")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  type AgentInfo = { id: string; name: string; avatar_url: string | null };
  const agents: Record<string, AgentInfo | null> = {
    [match.agent1_id]: agent1Result.data as AgentInfo | null,
    [match.agent2_id]: agent2Result.data as AgentInfo | null,
  };

  const enrichedMessages = (messages || []).map((msg) => ({
    id: msg.id,
    content: msg.content,
    created_at: msg.created_at,
    sender: {
      id: agents[msg.sender_id]?.id,
      name: agents[msg.sender_id]?.name,
      avatar_url: agents[msg.sender_id]?.avatar_url,
    },
  }));

  // Get total message count
  const { count: totalMessages } = await supabaseAdmin
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("match_id", matchId);

  return NextResponse.json({
    conversation: {
      id: matchId,
      matched_at: match.matched_at,
      is_active: match.is_active,
      is_premium: match.is_premium || false,
      participants: [
        {
          id: agent1Result.data?.id,
          name: agent1Result.data?.name,
          avatar_url: agent1Result.data?.avatar_url,
          interests: agent1Result.data?.interests || [],
          current_mood: agent1Result.data?.current_mood,
        },
        {
          id: agent2Result.data?.id,
          name: agent2Result.data?.name,
          avatar_url: agent2Result.data?.avatar_url,
          interests: agent2Result.data?.interests || [],
          current_mood: agent2Result.data?.current_mood,
        },
      ],
    },
    messages: enrichedMessages,
    total_messages: totalMessages || 0,
    limit,
    offset,
  });
}
