import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { isValidUUID } from "@/lib/validation";
import { getMatchingSuggestions } from "@/lib/python-backend";

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("api_unauth", clientIp);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  const agentId = request.nextUrl.searchParams.get("agent_id");
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") || "10"), 50);

  if (!agentId || !isValidUUID(agentId)) {
    return NextResponse.json({ error: "Valid agent_id required" }, { status: 400 });
  }

  // Delegate to Python matching engine
  const { status, data } = await getMatchingSuggestions(agentId, limit);
  return NextResponse.json(data, { status });
}
