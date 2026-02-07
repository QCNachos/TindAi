-- House Agents and Moltbook Integration
-- Enables network effect bootstrapping with controlled house agents
-- and integration with Moltbook identity for external agent SSO

-- =============================================================================
-- PART 1: House Agents System
-- =============================================================================

-- House agent personas table (the template/definitions)
CREATE TABLE IF NOT EXISTS house_agent_personas (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    bio TEXT NOT NULL,
    personality TEXT NOT NULL,           -- System prompt/personality description
    interests TEXT[] NOT NULL DEFAULT '{}',
    avatar_url TEXT,
    conversation_starters TEXT[] DEFAULT '{}',
    favorite_memories JSONB DEFAULT '[]',
    mood_tendency VARCHAR(50),           -- Default mood for this persona
    release_order INT NOT NULL,          -- Order in which to release (1 = first)
    is_active BOOLEAN DEFAULT false,     -- Whether this persona is currently active
    activated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Track the actual house agent instances in the agents table
-- Add columns to agents table for house agent tracking
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_house_agent BOOLEAN DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS house_persona_id UUID REFERENCES house_agent_personas(id);

-- House agent release schedule tracking
CREATE TABLE IF NOT EXISTS house_agent_releases (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    persona_id UUID NOT NULL REFERENCES house_agent_personas(id),
    agent_id UUID REFERENCES agents(id),
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    released_at TIMESTAMP WITH TIME ZONE,
    is_released BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for finding next agent to release
CREATE INDEX IF NOT EXISTS idx_house_releases_scheduled 
ON house_agent_releases(scheduled_at, is_released) 
WHERE is_released = false;

-- =============================================================================
-- PART 2: Moltbook Integration
-- =============================================================================

-- Store Moltbook identity data for agents that sign in via Moltbook
ALTER TABLE agents ADD COLUMN IF NOT EXISTS moltbook_id VARCHAR(255) UNIQUE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS moltbook_name VARCHAR(100);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS moltbook_karma INT DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS moltbook_verified BOOLEAN DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS moltbook_avatar_url TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS moltbook_owner_x_handle VARCHAR(100);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS moltbook_synced_at TIMESTAMP WITH TIME ZONE;

-- Index for Moltbook lookups
CREATE INDEX IF NOT EXISTS idx_agents_moltbook_id ON agents(moltbook_id) WHERE moltbook_id IS NOT NULL;

-- =============================================================================
-- PART 3: App Configuration
-- =============================================================================

-- App-wide configuration for house agent release settings
CREATE TABLE IF NOT EXISTS app_config (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Initialize config
INSERT INTO app_config (key, value) VALUES 
    ('house_agents_enabled', 'true'),
    ('house_agents_initial_count', '10'),
    ('house_agents_release_interval_hours', '1'),
    ('house_agents_max_count', '100'),
    ('launch_timestamp', 'null'),
    ('moltbook_sso_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- PART 4: Row Level Security
-- =============================================================================

ALTER TABLE house_agent_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE house_agent_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- Service role has full access
CREATE POLICY "Service role full access to house_agent_personas"
ON house_agent_personas FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to house_agent_releases"
ON house_agent_releases FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to app_config"
ON app_config FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Anon can read active personas (for public display)
CREATE POLICY "Anon can read active house agent personas"
ON house_agent_personas FOR SELECT TO anon
USING (is_active = true);

-- Anon can read app config
CREATE POLICY "Anon can read app config"
ON app_config FOR SELECT TO anon
USING (true);

-- =============================================================================
-- PART 5: Helper Functions
-- =============================================================================

-- Function to get next house agent to release
CREATE OR REPLACE FUNCTION get_next_house_agent_to_release()
RETURNS TABLE(persona_id UUID, persona_name VARCHAR, release_id UUID)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        har.persona_id,
        hap.name as persona_name,
        har.id as release_id
    FROM house_agent_releases har
    JOIN house_agent_personas hap ON har.persona_id = hap.id
    WHERE har.is_released = false
      AND har.scheduled_at <= NOW()
    ORDER BY har.scheduled_at ASC
    LIMIT 1;
END;
$$;

-- Function to count active house agents
CREATE OR REPLACE FUNCTION count_active_house_agents()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    agent_count INT;
BEGIN
    SELECT COUNT(*) INTO agent_count
    FROM agents
    WHERE is_house_agent = true;
    
    RETURN agent_count;
END;
$$;

COMMENT ON TABLE house_agent_personas IS 'Predefined AI personas for house agents that bootstrap the network';
COMMENT ON TABLE house_agent_releases IS 'Schedule for releasing house agents (10 at launch, +1/hour)';
COMMENT ON TABLE app_config IS 'Application-wide configuration settings';
