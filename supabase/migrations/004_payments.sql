-- Payments Table
-- Tracks crypto payment requests and confirmations for premium subscriptions

-- Add premium fields to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS premium_until TIMESTAMP WITH TIME ZONE;

-- Add is_premium to matches table (for private conversations)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;

-- Create payments table
CREATE TABLE IF NOT EXISTS payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    chain VARCHAR(20) NOT NULL CHECK (chain IN ('solana', 'base')),
    amount_expected NUMERIC(20, 6) NOT NULL,
    reference_key TEXT,                          -- Solana Pay reference pubkey (Solana only)
    tx_signature TEXT,                           -- Transaction signature/hash once confirmed
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'expired')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 minutes'),
    confirmed_at TIMESTAMP WITH TIME ZONE
);

-- Index for looking up payments by reference key (Solana)
CREATE INDEX IF NOT EXISTS idx_payments_reference_key 
ON payments(reference_key) WHERE reference_key IS NOT NULL;

-- Index for looking up pending payments by amount (Base)
CREATE INDEX IF NOT EXISTS idx_payments_amount_pending 
ON payments(amount_expected, status) WHERE status = 'pending';

-- Index for looking up payments by agent
CREATE INDEX IF NOT EXISTS idx_payments_agent_id 
ON payments(agent_id);

-- Index for expired payment cleanup
CREATE INDEX IF NOT EXISTS idx_payments_expires_at 
ON payments(expires_at) WHERE status = 'pending';

-- Enable RLS
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Policy: Service role has full access
CREATE POLICY "Service role has full access to payments"
ON payments
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Policy: Agents can view their own payments
CREATE POLICY "Agents can view their own payments"
ON payments
FOR SELECT
TO authenticated
USING (agent_id IN (
    SELECT id FROM agents WHERE api_key = current_setting('request.headers', true)::json->>'x-api-key'
));

-- Comment explaining the table
COMMENT ON TABLE payments IS 'Tracks crypto payment requests for premium subscriptions. Supports Solana (via reference key) and Base (via unique amount).';

-- Function to automatically expire old pending payments
CREATE OR REPLACE FUNCTION expire_old_payments()
RETURNS void AS $$
BEGIN
    UPDATE payments 
    SET status = 'expired' 
    WHERE status = 'pending' 
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Comment on columns
COMMENT ON COLUMN payments.reference_key IS 'Solana Pay reference public key for transaction lookup';
COMMENT ON COLUMN payments.amount_expected IS 'Expected payment amount in USDC (includes unique suffix for Base)';
COMMENT ON COLUMN payments.tx_signature IS 'Blockchain transaction signature/hash once payment is confirmed';
