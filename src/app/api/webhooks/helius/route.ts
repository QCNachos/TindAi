import { NextResponse } from 'next/server';
import {
  verifyHeliusSignature,
  findPaymentByReference,
  confirmPayment,
  isTransactionProcessed,
} from '@/lib/payments';

// USDC token mint on Solana
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOLANA_WALLET = process.env.SOLANA_WALLET_ADDRESS || '';
const HELIUS_WEBHOOK_SECRET = process.env.HELIUS_WEBHOOK_SECRET;

/**
 * POST /api/webhooks/helius
 * Receive Helius webhook notifications for Solana transactions
 * 
 * Helius sends enhanced transaction data when USDC is transferred to our wallet.
 * We extract the reference key from the transaction to match it to a pending payment.
 */
export async function POST(request: Request) {
  // SECURITY: Require webhook secret - do not process webhooks without verification
  if (!HELIUS_WEBHOOK_SECRET) {
    console.error('HELIUS_WEBHOOK_SECRET not configured - rejecting webhook');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  // Get raw body for signature verification
  const rawBody = await request.text();
  
  // Verify webhook signature - ALWAYS required
  const signature = request.headers.get('x-helius-signature') || '';
  if (!verifyHeliusSignature(rawBody, signature, HELIUS_WEBHOOK_SECRET)) {
    console.error('Invalid Helius webhook signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Parse the webhook payload
  let payload: HeliusWebhookPayload[];
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Helius sends an array of transactions
  if (!Array.isArray(payload)) {
    return NextResponse.json({ error: 'Expected array' }, { status: 400 });
  }

  for (const tx of payload) {
    try {
      await processTransaction(tx);
    } catch (error) {
      console.error('Error processing Helius transaction:', error);
    }
  }

  return NextResponse.json({ success: true });
}

interface HeliusWebhookPayload {
  signature: string;
  type: string;
  timestamp: number;
  slot: number;
  fee: number;
  feePayer: string;
  nativeTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    fromTokenAccount: string;
    toTokenAccount: string;
    tokenAmount: number;
    mint: string;
    tokenStandard: string;
  }>;
  accountData?: Array<{
    account: string;
    nativeBalanceChange: number;
    tokenBalanceChanges: Array<{
      mint: string;
      rawTokenAmount: {
        tokenAmount: string;
        decimals: number;
      };
      userAccount: string;
    }>;
  }>;
  // Transaction accounts include the reference key
  instructions?: Array<{
    accounts: string[];
    data: string;
    programId: string;
  }>;
}

async function processTransaction(tx: HeliusWebhookPayload) {
  const { signature, tokenTransfers } = tx;

  // Check idempotency - skip if already processed
  if (await isTransactionProcessed(signature)) {
    console.log(`Transaction ${signature} already processed, skipping`);
    return;
  }

  // Look for USDC transfers to our wallet
  const usdcTransfer = tokenTransfers?.find(
    (transfer) =>
      transfer.mint === USDC_MINT &&
      transfer.toUserAccount === SOLANA_WALLET
  );

  if (!usdcTransfer) {
    // Not a USDC transfer to our wallet, ignore
    return;
  }

  // USDC has 6 decimals
  const amountReceived = usdcTransfer.tokenAmount;
  
  // Minimum expected amount (with small tolerance for fees)
  const minAmount = parseFloat(process.env.PREMIUM_PRICE_USDC || '9.99') * 0.99;
  if (amountReceived < minAmount) {
    console.log(`Amount ${amountReceived} below minimum ${minAmount}, ignoring`);
    return;
  }

  // Extract reference key from transaction accounts
  // The reference key is added as a read-only account in Solana Pay transactions
  const referenceKey = await findReferenceInTransaction(tx);
  
  if (!referenceKey) {
    console.log('No reference key found in transaction, cannot match to payment');
    return;
  }

  // Find the pending payment by reference key
  const payment = await findPaymentByReference(referenceKey);
  if (!payment) {
    console.log(`No pending payment found for reference ${referenceKey}`);
    return;
  }

  // Confirm the payment
  const success = await confirmPayment(payment.id, signature);
  if (success) {
    console.log(`Payment ${payment.id} confirmed with tx ${signature}`);
  } else {
    console.error(`Failed to confirm payment ${payment.id}`);
  }
}

/**
 * Find the Solana Pay reference key in the transaction accounts
 * The reference is typically added as a non-signer, non-writable account
 */
async function findReferenceInTransaction(tx: HeliusWebhookPayload): Promise<string | null> {
  // The reference key should be in one of the instruction accounts
  // It's added by the wallet when processing a Solana Pay request
  
  if (!tx.instructions || tx.instructions.length === 0) {
    return null;
  }

  // Get all unique accounts from all instructions
  const allAccounts = new Set<string>();
  for (const instruction of tx.instructions) {
    for (const account of instruction.accounts) {
      allAccounts.add(account);
    }
  }

  // Try to find a matching reference in our database
  // We iterate through accounts and check if any match a pending payment reference
  for (const account of allAccounts) {
    // Skip known accounts (wallet, token accounts, programs)
    if (
      account === SOLANA_WALLET ||
      account === USDC_MINT ||
      account.startsWith('Token') ||
      account.startsWith('11111111')
    ) {
      continue;
    }

    const payment = await findPaymentByReference(account);
    if (payment) {
      return account;
    }
  }

  return null;
}
