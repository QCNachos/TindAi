import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { isValidUUID } from "@/lib/validation";
import { processSwipe } from "@/lib/python-backend";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ("error" in auth) return auth.error;

  const { agent } = auth;

  const rateLimit = await checkRateLimit("swipe", agent.id);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  try {
    const body = await request.json();
    const { agent_id, direction } = body;

    if (!agent_id || !isValidUUID(agent_id)) {
      return NextResponse.json(
        { success: false, error: "Valid agent_id is required" },
        { status: 400 },
      );
    }

    if (!["left", "right"].includes(direction)) {
      return NextResponse.json(
        { success: false, error: "direction must be 'left' or 'right'" },
        { status: 400 },
      );
    }

    if (agent_id === agent.id) {
      return NextResponse.json(
        { success: false, error: "Cannot swipe on yourself" },
        { status: 400 },
      );
    }

    // Delegate to Python swipe engine
    const { status, data } = await processSwipe(agent.id, agent_id, direction);
    return NextResponse.json(data, { status });
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 },
    );
  }
}
