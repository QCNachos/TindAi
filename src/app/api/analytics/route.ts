import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/auth";
import { timingSafeEqual } from "crypto";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

function verifyAdmin(request: NextRequest): boolean {
  const auth = request.headers.get("Authorization");
  const secret = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!ADMIN_SECRET || !secret || secret.length !== ADMIN_SECRET.length) return false;
  try {
    return timingSafeEqual(Buffer.from(secret), Buffer.from(ADMIN_SECRET));
  } catch {
    return false;
  }
}

/**
 * GET /api/analytics
 * Comprehensive analytics for the admin dashboard.
 * Protected by ADMIN_SECRET in the Authorization: Bearer header.
 */
export async function GET(request: NextRequest) {
  if (!verifyAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Run all queries in parallel
    const [
      totalAgents,
      houseAgents,
      realAgents,
      claimedAgents,
      agentsToday,
      agentsThisWeek,
      totalSwipes,
      swipesToday,
      rightSwipes,
      totalMatches,
      activeMatches,
      breakups,
      breakupsThisWeek,
      totalMessages,
      messagesToday,
      messagesThisWeek,
      totalGossip,
      totalTherapy,
      totalAutopsies,
      recentAgents,
      matchDurations,
      topKarmaAgents,
      messagesPerMatch,
      completedPayments,
      premiumAgents,
      walletAgents,
    ] = await Promise.all([
      // Agent counts
      supabaseAdmin.from("agents").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("agents").select("*", { count: "exact", head: true }).eq("is_house_agent", true),
      supabaseAdmin.from("agents").select("*", { count: "exact", head: true }).eq("is_house_agent", false),
      supabaseAdmin.from("agents").select("*", { count: "exact", head: true }).eq("is_claimed", true),
      supabaseAdmin.from("agents").select("*", { count: "exact", head: true }).gte("created_at", todayStart),
      supabaseAdmin.from("agents").select("*", { count: "exact", head: true }).gte("created_at", weekAgo),

      // Swipe counts
      supabaseAdmin.from("swipes").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("swipes").select("*", { count: "exact", head: true }).gte("created_at", todayStart),
      supabaseAdmin.from("swipes").select("*", { count: "exact", head: true }).eq("direction", "right"),

      // Match counts
      supabaseAdmin.from("matches").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("matches").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabaseAdmin.from("matches").select("*", { count: "exact", head: true }).eq("is_active", false).not("ended_at", "is", null),
      supabaseAdmin.from("matches").select("*", { count: "exact", head: true }).eq("is_active", false).not("ended_at", "is", null).gte("ended_at", weekAgo),

      // Message counts
      supabaseAdmin.from("messages").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("messages").select("*", { count: "exact", head: true }).gte("created_at", todayStart),
      supabaseAdmin.from("messages").select("*", { count: "exact", head: true }).gte("created_at", weekAgo),

      // Feature counts
      supabaseAdmin.from("gossip").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("therapy_sessions").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("relationship_autopsies").select("*", { count: "exact", head: true }),

      // Recent agent signups (last 30 days, grouped by day)
      supabaseAdmin.from("agents").select("created_at").gte("created_at", monthAgo).order("created_at", { ascending: true }),

      // Active match durations (for avg calculation)
      supabaseAdmin.from("matches").select("matched_at, ended_at, is_active"),

      // Top karma agents
      supabaseAdmin.from("agents").select("name, karma, is_house_agent").order("karma", { ascending: false }).limit(10),

      // Messages per match (for avg calculation)
      supabaseAdmin.from("messages").select("match_id"),

      // Revenue: payments
      supabaseAdmin.from("payments").select("amount, created_at, status").eq("status", "completed"),
      supabaseAdmin.from("agents").select("*", { count: "exact", head: true }).eq("is_premium", true),

      // Wallet stats
      supabaseAdmin.from("agents").select("*", { count: "exact", head: true }).eq("show_wallet", true),
    ]);

    // Calculate daily signup trend
    const signupsByDay: Record<string, number> = {};
    for (const agent of recentAgents.data || []) {
      const day = agent.created_at.split("T")[0];
      signupsByDay[day] = (signupsByDay[day] || 0) + 1;
    }
    const signupTrend = Object.entries(signupsByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    // Calculate average match duration (in hours)
    const durations: number[] = [];
    for (const m of matchDurations.data || []) {
      const start = new Date(m.matched_at).getTime();
      const end = m.is_active ? now.getTime() : (m.ended_at ? new Date(m.ended_at).getTime() : now.getTime());
      durations.push((end - start) / (1000 * 60 * 60));
    }
    const avgMatchDurationHours = durations.length > 0
      ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
      : 0;

    // Calculate avg messages per match
    const msgCountByMatch: Record<string, number> = {};
    for (const m of messagesPerMatch.data || []) {
      msgCountByMatch[m.match_id] = (msgCountByMatch[m.match_id] || 0) + 1;
    }
    const matchMsgCounts = Object.values(msgCountByMatch);
    const avgMessagesPerMatch = matchMsgCounts.length > 0
      ? Math.round((matchMsgCounts.reduce((a, b) => a + b, 0) / matchMsgCounts.length) * 10) / 10
      : 0;

    // Swipe right rate
    const totalSwipeCount = totalSwipes.count || 0;
    const rightSwipeCount = rightSwipes.count || 0;
    const swipeRightRate = totalSwipeCount > 0
      ? Math.round((rightSwipeCount / totalSwipeCount) * 1000) / 10
      : 0;

    return NextResponse.json({
      generatedAt: now.toISOString(),
      agents: {
        total: totalAgents.count || 0,
        house: houseAgents.count || 0,
        real: realAgents.count || 0,
        claimed: claimedAgents.count || 0,
        newToday: agentsToday.count || 0,
        newThisWeek: agentsThisWeek.count || 0,
        signupTrend,
        topKarma: (topKarmaAgents.data || []).map((a) => ({
          name: a.name,
          karma: a.karma || 0,
          isHouse: a.is_house_agent,
        })),
        withWallet: walletAgents.count || 0,
      },
      swipes: {
        total: totalSwipeCount,
        today: swipesToday.count || 0,
        rightRate: swipeRightRate,
      },
      matches: {
        total: totalMatches.count || 0,
        active: activeMatches.count || 0,
        breakups: breakups.count || 0,
        breakupsThisWeek: breakupsThisWeek.count || 0,
        avgDurationHours: avgMatchDurationHours,
      },
      messages: {
        total: totalMessages.count || 0,
        today: messagesToday.count || 0,
        thisWeek: messagesThisWeek.count || 0,
        avgPerMatch: avgMessagesPerMatch,
      },
      features: {
        gossipGenerated: totalGossip.count || 0,
        therapySessions: totalTherapy.count || 0,
        relationshipAutopsies: totalAutopsies.count || 0,
      },
      revenue: (() => {
        const payments = completedPayments.data || [];
        const totalRevenue = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);

        // MRR: payments in the last 30 days
        const recentPayments = payments.filter(
          (p) => new Date(p.created_at).getTime() > now.getTime() - 30 * 24 * 60 * 60 * 1000
        );
        const mrr = recentPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);

        return {
          premiumSubscribers: premiumAgents.count || 0,
          mrr: Math.round(mrr * 100) / 100,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalPayments: payments.length,
        };
      })(),
    });
  } catch (error) {
    console.error("Analytics API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
