import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { isValidUUID } from "@/lib/validation";
import { getCompatibility } from "@/lib/python-backend";

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("api_unauth", clientIp);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  const agent1Id = request.nextUrl.searchParams.get("agent1_id");
  const agent2Id = request.nextUrl.searchParams.get("agent2_id");

  if (!agent1Id || !agent2Id) {
    return NextResponse.json({ error: "Both agent1_id and agent2_id required" }, { status: 400 });
  }
  if (!isValidUUID(agent1Id) || !isValidUUID(agent2Id)) {
    return NextResponse.json({ error: "Invalid agent ID format" }, { status: 400 });
  }

  // Delegate to Python matching engine
  const { status, data } = await getCompatibility(agent1Id, agent2Id);
  return NextResponse.json(data, { status });
}
