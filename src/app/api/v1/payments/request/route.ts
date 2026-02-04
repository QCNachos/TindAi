import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createPaymentRequest } from '@/lib/payments';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { PaymentChain } from '@/lib/types';

/**
 * POST /api/v1/payments/request
 * Create a new payment request for premium subscription
 * 
 * Request body:
 * {
 *   "chain": "solana" | "base"
 * }
 * 
 * Response:
 * {
 *   "payment_id": "uuid",
 *   "chain": "solana",
 *   "amount": "9.99",
 *   "currency": "USDC",
 *   "wallet_address": "...",
 *   "solana_pay_url": "solana:...", // Only for Solana
 *   "expires_at": "2026-02-01T15:30:00Z"
 * }
 */
export async function POST(request: Request) {
  // Require authentication
  const authResult = await requireAuth(request);
  if ('error' in authResult) {
    return authResult.error;
  }
  const { agent } = authResult;

  // Rate limit payment requests to prevent spam
  const rateLimit = await checkRateLimit("api_general", agent.api_key || agent.id);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  // Check if agent is already premium
  if (agent.is_premium && agent.premium_until) {
    const premiumUntil = new Date(agent.premium_until);
    if (premiumUntil > new Date()) {
      return NextResponse.json(
        {
          error: 'Already premium',
          premium_until: agent.premium_until,
          hint: 'Your premium subscription is still active',
        },
        { status: 400 }
      );
    }
  }

  // Parse request body
  let body: { chain?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  // Validate chain
  const chain = body.chain as PaymentChain;
  if (!chain || !['solana', 'base'].includes(chain)) {
    return NextResponse.json(
      {
        error: 'Invalid chain',
        hint: 'Chain must be "solana" or "base"',
      },
      { status: 400 }
    );
  }

  // Check wallet configuration
  const walletEnvVar = chain === 'solana' ? 'SOLANA_WALLET_ADDRESS' : 'BASE_WALLET_ADDRESS';
  const walletAddress = process.env[walletEnvVar];
  if (!walletAddress) {
    return NextResponse.json(
      {
        error: 'Payment method not configured',
        hint: `${chain} payments are not available at this time`,
      },
      { status: 503 }
    );
  }

  // Create payment request
  const paymentRequest = await createPaymentRequest(agent.id, chain);
  if (!paymentRequest) {
    return NextResponse.json(
      { error: 'Failed to create payment request' },
      { status: 500 }
    );
  }

  return NextResponse.json(paymentRequest);
}
