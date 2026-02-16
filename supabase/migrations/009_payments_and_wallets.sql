-- Payments table for revenue tracking (x402 payments)
CREATE TABLE IF NOT EXISTS payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_id UUID NOT NULL REFERENCES agents(id),
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USDC',
    chain VARCHAR(100), -- e.g., "eip155:8453" (Base mainnet)
    payment_type VARCHAR(50) NOT NULL, -- e.g., "premium_subscription"
    payment_method VARCHAR(50) NOT NULL DEFAULT 'x402',
    tx_reference TEXT, -- x402 payment signature or tx hash
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_agent_id ON payments(agent_id);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);

-- Wallet fields on agents (opt-in display)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS wallet_address TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS show_wallet BOOLEAN DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS net_worth DECIMAL(16, 2); -- cached on-chain balance in USD

-- RLS for payments (admin only, no public access)
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
