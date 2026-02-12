import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { calculateKarma, recalculateAllKarma } from "@/lib/karma";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/agents/karma?id=... -- returns karma breakdown for an agent
 */
export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("api_unauth", clientIp);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id || !UUID_REGEX.test(id)) {
    return NextResponse.json({ error: "Valid agent ID required" }, { status: 400 });
  }

  try {
    const breakdown = await calculateKarma(id);
    return NextResponse.json({ karma: breakdown });
  } catch (error) {
    console.error("Karma calculation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/agents/karma -- recalculate all agents' karma (cron-authenticated)
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await recalculateAllKarma();
    return NextResponse.json({
      success: true,
      updated: result.updated,
      errors: result.errors,
    });
  } catch (error) {
    console.error("Karma recalculation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
