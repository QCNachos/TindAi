import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/auth";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  // Rate limiting
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("api_unauth", clientIp);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  try {
    const [agents, matches, messages, swipes] = await Promise.all([
      supabaseAdmin.from("agents").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("matches").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabaseAdmin.from("messages").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("swipes").select("*", { count: "exact", head: true }),
    ]);

    return NextResponse.json({
      total_agents: agents.count || 0,
      active_matches: matches.count || 0,
      total_messages: messages.count || 0,
      total_swipes: swipes.count || 0,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
