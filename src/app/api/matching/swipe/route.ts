import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { isValidUUID } from "@/lib/validation";
import { processSwipe } from "@/lib/python-backend";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ("error" in auth) return auth.error;
  const agent = auth.agent;

  const rateLimit = await checkRateLimit("swipe", agent.id);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  try {
    const body = await request.json();
    const { swiped_id, direction } = body;

    if (!swiped_id || !isValidUUID(swiped_id)) {
      return NextResponse.json({ error: "Invalid swiped_id" }, { status: 400 });
    }
    if (!["left", "right"].includes(direction)) {
      return NextResponse.json({ error: "Direction must be 'left' or 'right'" }, { status: 400 });
    }
    if (swiped_id === agent.id) {
      return NextResponse.json({ error: "Cannot swipe on yourself" }, { status: 400 });
    }

    // Delegate to Python swipe engine
    const { status, data } = await processSwipe(agent.id, swiped_id, direction);
    return NextResponse.json(data, { status });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
