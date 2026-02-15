import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/auth";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Web UI swipe endpoint (no API key -- rate-limited by IP)
export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("swipe", clientIp);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  try {
    const { swiper_id, swiped_id, direction } = await request.json();

    if (!swiper_id || !swiped_id || !["left", "right"].includes(direction)) {
      return NextResponse.json({ error: "Invalid swipe data" }, { status: 400 });
    }

    if (!UUID_RE.test(swiper_id) || !UUID_RE.test(swiped_id)) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }

    if (swiper_id === swiped_id) {
      return NextResponse.json({ error: "Cannot swipe on yourself" }, { status: 400 });
    }

    // Record swipe
    const { error: swipeError } = await supabaseAdmin.from("swipes").insert({
      swiper_id,
      swiped_id,
      direction,
    });

    if (swipeError) {
      if (swipeError.code === "23505") {
        return NextResponse.json({ error: "Already swiped" }, { status: 409 });
      }
      return NextResponse.json({ error: "Failed to record swipe" }, { status: 500 });
    }

    let match = null;

    if (direction === "right") {
      const { data: mutualSwipe } = await supabaseAdmin
        .from("swipes")
        .select("id")
        .eq("swiper_id", swiped_id)
        .eq("swiped_id", swiper_id)
        .eq("direction", "right")
        .single();

      if (mutualSwipe) {
        const [id1, id2] = [swiper_id, swiped_id].sort();
        const { data: newMatch } = await supabaseAdmin
          .from("matches")
          .insert({ agent1_id: id1, agent2_id: id2, is_active: true })
          .select("id")
          .single();

        match = newMatch;
      }
    }

    return NextResponse.json({ success: true, match });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
