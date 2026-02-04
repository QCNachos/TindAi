import { NextResponse } from 'next/server';
import {
  verifyAlchemySignature,
  findPaymentByAmount,
  confirmPayment,
  isTransactionProcessed,
} from '@/lib/payments';

// USDC contract on Base
const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();
const BASE_WALLET = (process.env.BASE_WALLET_ADDRESS || '').toLowerCase();
const ALCHEMY_WEBHOOK_SIGNING_KEY = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY;

/**
 * POST /api/webhooks/alchemy
 * Receive Alchemy webhook notifications for Base transactions
 * 
 * We use ADDRESS_ACTIVITY webhooks to detect USDC transfers to our wallet.
 * Payments are matched by the unique amount.
 */
export async function POST(request: Request) {
  // SECURITY: Require webhook signing key - do not process webhooks without verification
  if (!ALCHEMY_WEBHOOK_SIGNING_KEY) {
    console.error('ALCHEMY_WEBHOOK_SIGNING_KEY not configured - rejecting webhook');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  // Get raw body for signature verification
  const rawBody = await request.text();
  
  // Verify webhook signature - ALWAYS required
  const signature = request.headers.get('x-alchemy-signature') || '';
  if (!verifyAlchemySignature(rawBody, signature, ALCHEMY_WEBHOOK_SIGNING_KEY)) {
    console.error('Invalid Alchemy webhook signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Parse the webhook payload
  let payload: AlchemyWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Process the webhook
  try {
    await processWebhook(payload);
  } catch (error) {
    console.error('Error processing Alchemy webhook:', error);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

interface AlchemyWebhookPayload {
  webhookId: string;
  id: string;
  createdAt: string;
  type: string;
  event: {
    network: string;
    activity: AlchemyActivity[];
  };
}

interface AlchemyActivity {
  fromAddress: string;
  toAddress: string;
  blockNum: string;
  hash: string;
  value: number;
  asset: string;
  category: string;
  rawContract: {
    rawValue: string;
    address: string;
    decimals: number;
  };
  log?: {
    address: string;
    topics: string[];
    data: string;
    blockNumber: string;
    transactionHash: string;
    transactionIndex: string;
    blockHash: string;
    logIndex: string;
    removed: boolean;
  };
}

async function processWebhook(payload: AlchemyWebhookPayload) {
  // Only process ADDRESS_ACTIVITY webhooks
  if (payload.type !== 'ADDRESS_ACTIVITY') {
    console.log(`Ignoring webhook type: ${payload.type}`);
    return;
  }

  const activities = payload.event?.activity || [];
  
  for (const activity of activities) {
    try {
      await processActivity(activity);
    } catch (error) {
      console.error('Error processing activity:', error);
    }
  }
}

async function processActivity(activity: AlchemyActivity) {
  const {
    toAddress,
    hash,
    value,
    asset,
    rawContract,
    category,
  } = activity;

  // Only process ERC20 transfers
  if (category !== 'erc20' && category !== 'token') {
    return;
  }

  // Check if it's USDC transfer to our wallet
  const contractAddress = rawContract?.address?.toLowerCase();
  if (contractAddress !== USDC_CONTRACT) {
    return;
  }

  if (toAddress.toLowerCase() !== BASE_WALLET) {
    return;
  }

  // Check idempotency
  if (await isTransactionProcessed(hash)) {
    console.log(`Transaction ${hash} already processed, skipping`);
    return;
  }

  // Calculate the amount (USDC has 6 decimals)
  let amountReceived: number;
  if (rawContract?.rawValue && rawContract?.decimals) {
    amountReceived = parseInt(rawContract.rawValue, 16) / Math.pow(10, rawContract.decimals);
  } else {
    amountReceived = value;
  }

  // Minimum expected amount
  const minAmount = parseFloat(process.env.PREMIUM_PRICE_USDC || '9.99') * 0.99;
  if (amountReceived < minAmount) {
    console.log(`Amount ${amountReceived} below minimum ${minAmount}, ignoring`);
    return;
  }

  console.log(`Received USDC transfer: ${amountReceived} USDC in tx ${hash}`);

  // Find pending payment by amount
  const payment = await findPaymentByAmount(amountReceived);
  if (!payment) {
    console.log(`No pending payment found for amount ${amountReceived}`);
    return;
  }

  // Confirm the payment
  const success = await confirmPayment(payment.id, hash);
  if (success) {
    console.log(`Payment ${payment.id} confirmed with tx ${hash}`);
  } else {
    console.error(`Failed to confirm payment ${payment.id}`);
  }
}
