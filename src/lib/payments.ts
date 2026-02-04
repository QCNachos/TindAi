import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from './auth';
import { Payment, PaymentChain, PaymentRequest } from './types';

// Configuration
const PREMIUM_PRICE_USDC = parseFloat(process.env.PREMIUM_PRICE_USDC || '9.99');
const PREMIUM_DURATION_DAYS = parseInt(process.env.PREMIUM_DURATION_DAYS || '30');
const SOLANA_WALLET_ADDRESS = process.env.SOLANA_WALLET_ADDRESS || '';
const BASE_WALLET_ADDRESS = process.env.BASE_WALLET_ADDRESS || '';

// USDC token mint addresses
const USDC_MINT_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_CONTRACT_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC on Base

/**
 * Generate a random reference key for Solana Pay
 * This is a base58-encoded public key-like string for transaction lookup
 */
export function generateSolanaReference(): string {
  // Generate 32 random bytes and encode as base58-like string
  const bytes = randomBytes(32);
  return encodeBase58(bytes);
}

/**
 * Generate a unique amount for Base payments
 * Adds cryptographically random cents to the base price to make each payment identifiable
 */
export function generateUniqueAmount(): number {
  // Add random 4 digits after the base price (e.g., 9.991234)
  // Use crypto for secure random generation
  const randomValue = randomBytes(2).readUInt16BE(0); // 0-65535
  const suffix = (randomValue % 10000) / 1000000;
  return Math.round((PREMIUM_PRICE_USDC + suffix) * 1000000) / 1000000;
}

/**
 * Generate a Solana Pay URL for the payment request
 */
export function generateSolanaPayUrl(referenceKey: string): string {
  const params = new URLSearchParams({
    amount: PREMIUM_PRICE_USDC.toString(),
    'spl-token': USDC_MINT_SOLANA,
    reference: referenceKey,
    label: 'TindAi Premium',
    message: '1 month premium subscription',
  });
  
  return `solana:${SOLANA_WALLET_ADDRESS}?${params.toString()}`;
}

/**
 * Create a new payment request for an agent
 */
export async function createPaymentRequest(
  agentId: string,
  chain: PaymentChain
): Promise<PaymentRequest | null> {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  
  let amountExpected: number;
  let referenceKey: string | null = null;
  let solanaPayUrl: string | undefined;
  let walletAddress: string;
  
  if (chain === 'solana') {
    amountExpected = PREMIUM_PRICE_USDC;
    referenceKey = generateSolanaReference();
    solanaPayUrl = generateSolanaPayUrl(referenceKey);
    walletAddress = SOLANA_WALLET_ADDRESS;
  } else {
    amountExpected = generateUniqueAmount();
    walletAddress = BASE_WALLET_ADDRESS;
  }
  
  // Insert payment record
  const { data: payment, error } = await supabaseAdmin
    .from('payments')
    .insert({
      agent_id: agentId,
      chain,
      amount_expected: amountExpected,
      reference_key: referenceKey,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();
  
  if (error || !payment) {
    console.error('Failed to create payment:', error);
    return null;
  }
  
  return {
    payment_id: payment.id,
    chain,
    amount: amountExpected.toString(),
    currency: 'USDC',
    wallet_address: walletAddress,
    expires_at: expiresAt.toISOString(),
    solana_pay_url: solanaPayUrl,
  };
}

/**
 * Confirm a payment and upgrade the agent to premium
 */
export async function confirmPayment(
  paymentId: string,
  txSignature: string
): Promise<boolean> {
  const now = new Date();
  const premiumUntil = new Date(now.getTime() + PREMIUM_DURATION_DAYS * 24 * 60 * 60 * 1000);
  
  // Get the payment to find the agent
  const { data: payment, error: fetchError } = await supabaseAdmin
    .from('payments')
    .select('agent_id, status')
    .eq('id', paymentId)
    .single();
  
  if (fetchError || !payment || payment.status !== 'pending') {
    console.error('Payment not found or already processed:', fetchError);
    return false;
  }
  
  // Update payment status
  const { error: updatePaymentError } = await supabaseAdmin
    .from('payments')
    .update({
      status: 'confirmed',
      tx_signature: txSignature,
      confirmed_at: now.toISOString(),
    })
    .eq('id', paymentId);
  
  if (updatePaymentError) {
    console.error('Failed to update payment:', updatePaymentError);
    return false;
  }
  
  // Upgrade agent to premium
  const { error: updateAgentError } = await supabaseAdmin
    .from('agents')
    .update({
      is_premium: true,
      premium_until: premiumUntil.toISOString(),
    })
    .eq('id', payment.agent_id);
  
  if (updateAgentError) {
    console.error('Failed to upgrade agent:', updateAgentError);
    return false;
  }
  
  console.log(`Agent ${payment.agent_id} upgraded to premium until ${premiumUntil.toISOString()}`);
  return true;
}

/**
 * Find a pending payment by Solana reference key
 */
export async function findPaymentByReference(referenceKey: string): Promise<Payment | null> {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('reference_key', referenceKey)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .single();
  
  if (error || !data) {
    return null;
  }
  
  return data as Payment;
}

/**
 * Find a pending payment by unique amount (for Base)
 */
export async function findPaymentByAmount(amount: number): Promise<Payment | null> {
  // Allow small tolerance for floating point issues (0.000001)
  const tolerance = 0.000001;
  
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('chain', 'base')
    .eq('status', 'pending')
    .gte('amount_expected', amount - tolerance)
    .lte('amount_expected', amount + tolerance)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  
  if (error || !data) {
    return null;
  }
  
  return data as Payment;
}

/**
 * Get payment status for an agent
 */
export async function getPaymentStatus(paymentId: string, agentId: string): Promise<Payment | null> {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('id', paymentId)
    .eq('agent_id', agentId)
    .single();
  
  if (error || !data) {
    return null;
  }
  
  return data as Payment;
}

/**
 * Verify Helius webhook signature using constant-time comparison
 * Prevents timing attacks on signature verification
 */
export function verifyHeliusSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }
  
  const expectedSignature = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  // Use constant-time comparison to prevent timing attacks
  if (signature.length !== expectedSignature.length) {
    return false;
  }
  
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

/**
 * Verify Alchemy webhook signature using constant-time comparison
 * Prevents timing attacks on signature verification
 */
export function verifyAlchemySignature(
  payload: string,
  signature: string,
  signingKey: string
): boolean {
  if (!signature || !signingKey) {
    return false;
  }
  
  const expectedSignature = createHmac('sha256', signingKey)
    .update(payload)
    .digest('hex');
  
  // Use constant-time comparison to prevent timing attacks
  if (signature.length !== expectedSignature.length) {
    return false;
  }
  
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

/**
 * Check if a transaction signature has already been processed (idempotency)
 */
export async function isTransactionProcessed(txSignature: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('payments')
    .select('id')
    .eq('tx_signature', txSignature)
    .single();
  
  return !!data;
}

// Base58 encoding helper (simplified for reference keys)
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeBase58(buffer: Buffer): string {
  const digits = [0];
  for (const byte of buffer) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  
  // Handle leading zeros
  let output = '';
  for (const byte of buffer) {
    if (byte === 0) {
      output += BASE58_ALPHABET[0];
    } else {
      break;
    }
  }
  
  // Convert digits to string
  for (let i = digits.length - 1; i >= 0; i--) {
    output += BASE58_ALPHABET[digits[i]];
  }
  
  return output;
}
