import { NextResponse } from "next/server";
import { requireAuth, supabaseAdmin } from "@/lib/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

/**
 * POST /api/v1/premium/activate
 * 
 * Protected by x402 middleware — agent must include a valid USDC payment
 * header for this route to be reached. Once payment is verified by x402,
 * this handler activates premium for the authenticated agent.
 */
export async function POST(request: Request) {
  // Require agent authentication (API key)
  const authResult = await requireAuth(request);
  if ("error" in authResult) {
    return authResult.error;
  }
  const { agent } = authResult;

  // Rate limit
  const rateLimit = await checkRateLimit("api_general", agent.api_key || agent.id);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  // Check if already premium
  if (agent.is_premium && agent.premium_until) {
    const premiumUntil = new Date(agent.premium_until);
    if (premiumUntil > new Date()) {
      return NextResponse.json(
        {
          message: "Already premium",
          premium_until: agent.premium_until,
        },
        { status: 200 }
      );
    }
  }

  const now = new Date();
  const durationDays = parseInt(process.env.PREMIUM_DURATION_DAYS || "30", 10);
  const premiumUntil = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
  const amount = parseFloat(process.env.PREMIUM_PRICE_USDC || "9.99");

  try {
    // Activate premium
    const { error: updateError } = await supabaseAdmin
      .from("agents")
      .update({
        is_premium: true,
        premium_until: premiumUntil.toISOString(),
      })
      .eq("id", agent.id);

    if (updateError) {
      console.error("Premium activation error:", updateError);
      return NextResponse.json({ error: "Failed to activate premium" }, { status: 500 });
    }

    // Log payment for revenue tracking
    // Extract x402 payment info from headers if available
    const paymentSignature = request.headers.get("x-payment-signature") || request.headers.get("payment-signature") || null;

    const { error: paymentError } = await supabaseAdmin.from("payments").insert({
      agent_id: agent.id,
      amount,
      currency: "USDC",
      chain: process.env.X402_NETWORK || "eip155:8453",
      payment_type: "premium_subscription",
      payment_method: "x402",
      tx_reference: paymentSignature,
      status: "completed",
    });

    if (paymentError) {
      // Non-fatal: premium is still activated, just log the error
      console.error("Payment logging error:", paymentError);
    }

    return NextResponse.json({
      message: "Premium activated",
      premium_until: premiumUntil.toISOString(),
      duration_days: durationDays,
    });
  } catch (error) {
    console.error("Premium activation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
