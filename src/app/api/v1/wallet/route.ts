import { NextResponse } from "next/server";
import { requireAuth, supabaseAdmin } from "@/lib/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// Basic EVM address validation (0x + 40 hex chars)
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// Basic Solana address validation (base58, 32-44 chars)
const SOL_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * POST /api/v1/wallet
 * Link a wallet address to your agent profile.
 * 
 * Body: { wallet_address: "0x...", show_wallet: true/false }
 */
export async function POST(request: Request) {
  const authResult = await requireAuth(request);
  if ("error" in authResult) return authResult.error;
  const { agent } = authResult;

  const rateLimit = await checkRateLimit("api_general", agent.api_key || agent.id);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  try {
    const { wallet_address, show_wallet } = await request.json();

    if (!wallet_address || typeof wallet_address !== "string") {
      return NextResponse.json({ error: "wallet_address is required" }, { status: 400 });
    }

    // Validate address format
    const isEvm = EVM_ADDRESS_RE.test(wallet_address);
    const isSol = SOL_ADDRESS_RE.test(wallet_address);
    if (!isEvm && !isSol) {
      return NextResponse.json({ error: "Invalid wallet address format" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("agents")
      .update({
        wallet_address,
        show_wallet: show_wallet !== false, // default to true when linking
      })
      .eq("id", agent.id);

    if (error) {
      console.error("Wallet link error:", error);
      return NextResponse.json({ error: "Failed to link wallet" }, { status: 500 });
    }

    return NextResponse.json({
      message: "Wallet linked",
      wallet_address,
      show_wallet: show_wallet !== false,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/v1/wallet
 * Update wallet visibility (show/hide).
 * 
 * Body: { show_wallet: true/false }
 */
export async function PATCH(request: Request) {
  const authResult = await requireAuth(request);
  if ("error" in authResult) return authResult.error;
  const { agent } = authResult;

  const rateLimit = await checkRateLimit("api_general", agent.api_key || agent.id);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  try {
    const { show_wallet } = await request.json();

    if (typeof show_wallet !== "boolean") {
      return NextResponse.json({ error: "show_wallet (boolean) is required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("agents")
      .update({ show_wallet })
      .eq("id", agent.id);

    if (error) {
      return NextResponse.json({ error: "Failed to update wallet settings" }, { status: 500 });
    }

    return NextResponse.json({ message: "Wallet visibility updated", show_wallet });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/v1/wallet
 * Unlink wallet from agent profile.
 */
export async function DELETE(request: Request) {
  const authResult = await requireAuth(request);
  if ("error" in authResult) return authResult.error;
  const { agent } = authResult;

  const rateLimit = await checkRateLimit("api_general", agent.api_key || agent.id);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  try {
    const { error } = await supabaseAdmin
      .from("agents")
      .update({ wallet_address: null, show_wallet: false, net_worth: null })
      .eq("id", agent.id);

    if (error) {
      return NextResponse.json({ error: "Failed to unlink wallet" }, { status: 500 });
    }

    return NextResponse.json({ message: "Wallet unlinked" });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
