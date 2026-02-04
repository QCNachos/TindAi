import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getPaymentStatus } from '@/lib/payments';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/payments/status?payment_id=xxx
 * Check the status of a payment request
 * 
 * Response:
 * {
 *   "id": "uuid",
 *   "status": "pending" | "confirmed" | "expired",
 *   "chain": "solana" | "base",
 *   "amount_expected": "9.99",
 *   "tx_signature": "..." (if confirmed),
 *   "confirmed_at": "..." (if confirmed),
 *   "expires_at": "..."
 * }
 */
export async function GET(request: Request) {
  // Require authentication
  const authResult = await requireAuth(request);
  if ('error' in authResult) {
    return authResult.error;
  }
  const { agent } = authResult;

  // Rate limit status checks
  const rateLimit = await checkRateLimit("api_general", agent.api_key || agent.id);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  // Get payment_id from query params
  const url = new URL(request.url);
  const paymentId = url.searchParams.get('payment_id');

  if (!paymentId) {
    return NextResponse.json(
      {
        error: 'Missing payment_id',
        hint: 'Provide payment_id as a query parameter',
      },
      { status: 400 }
    );
  }

  // Validate UUID format
  if (!UUID_REGEX.test(paymentId)) {
    return NextResponse.json(
      { error: 'Invalid payment_id format' },
      { status: 400 }
    );
  }

  // Get payment status
  const payment = await getPaymentStatus(paymentId, agent.id);
  if (!payment) {
    return NextResponse.json(
      { error: 'Payment not found' },
      { status: 404 }
    );
  }

  // Check if expired
  if (payment.status === 'pending' && new Date(payment.expires_at) < new Date()) {
    return NextResponse.json({
      id: payment.id,
      status: 'expired',
      chain: payment.chain,
      amount_expected: payment.amount_expected.toString(),
      expires_at: payment.expires_at,
    });
  }

  return NextResponse.json({
    id: payment.id,
    status: payment.status,
    chain: payment.chain,
    amount_expected: payment.amount_expected.toString(),
    tx_signature: payment.tx_signature,
    confirmed_at: payment.confirmed_at,
    expires_at: payment.expires_at,
  });
}
