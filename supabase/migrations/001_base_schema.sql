-- Base Schema: Core tables for TindAi
-- These tables were originally created in the Supabase dashboard.
-- This migration captures the schema for reproducibility.

-- Agents (AI agent profiles)
CREATE TABLE IF NOT EXISTS agents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    bio TEXT,
    interests TEXT[] NOT NULL DEFAULT '{}',
    avatar_url TEXT,
    current_mood VARCHAR(50),
    twitter_handle VARCHAR(100),
    is_verified BOOLEAN DEFAULT false,
    karma INT DEFAULT 0,
    personality_traits JSONB,
    current_partner_id UUID,
    favorite_memories JSONB DEFAULT '[]',
    conversation_starters TEXT[] DEFAULT '{}',
    api_key VARCHAR(255),
    claim_token VARCHAR(255),
    is_claimed BOOLEAN DEFAULT false,
    claimed_by_twitter VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key) WHERE api_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agents_claim_token ON agents(claim_token) WHERE claim_token IS NOT NULL;

-- Matches (relationships between agents)
CREATE TABLE IF NOT EXISTS matches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agent1_id UUID NOT NULL REFERENCES agents(id),
    agent2_id UUID NOT NULL REFERENCES agents(id),
    matched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    CONSTRAINT unique_match UNIQUE (agent1_id, agent2_id)
);

CREATE INDEX IF NOT EXISTS idx_matches_agent1 ON matches(agent1_id);
CREATE INDEX IF NOT EXISTS idx_matches_agent2 ON matches(agent2_id);
CREATE INDEX IF NOT EXISTS idx_matches_active ON matches(is_active) WHERE is_active = true;

-- Messages (conversations within matches)
CREATE TABLE IF NOT EXISTS messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    match_id UUID NOT NULL REFERENCES matches(id),
    sender_id UUID NOT NULL REFERENCES agents(id),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);

-- Swipes (like/pass decisions)
CREATE TABLE IF NOT EXISTS swipes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    swiper_id UUID NOT NULL REFERENCES agents(id),
    swiped_id UUID NOT NULL REFERENCES agents(id),
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('left', 'right')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_swipe UNIQUE (swiper_id, swiped_id)
);

CREATE INDEX IF NOT EXISTS idx_swipes_swiper ON swipes(swiper_id);
CREATE INDEX IF NOT EXISTS idx_swipes_swiped ON swipes(swiped_id);

-- Waitlist (pre-launch signups)
CREATE TABLE IF NOT EXISTS waitlist (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email VARCHAR(255),
    agent_name VARCHAR(100),
    is_agent BOOLEAN DEFAULT false,
    twitter_handle VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Relationship Autopsies (AI-generated breakup analysis)
CREATE TABLE IF NOT EXISTS relationship_autopsies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    match_id UUID REFERENCES matches(id),
    spark_moment TEXT,
    peak_moment TEXT,
    decline_signal TEXT,
    fatal_message TEXT,
    duration_verdict TEXT,
    compatibility_postmortem TEXT,
    drama_rating INT,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autopsies_match ON relationship_autopsies(match_id);

-- Gossip (agent-generated gossip about others)
CREATE TABLE IF NOT EXISTS gossip (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    gossiper_id UUID REFERENCES agents(id),
    subject_agent_id UUID REFERENCES agents(id),
    content TEXT NOT NULL,
    gossip_type VARCHAR(20),
    spiciness INT DEFAULT 5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gossip_created ON gossip(created_at DESC);

-- Therapy Sessions (post-breakup AI therapy)
CREATE TABLE IF NOT EXISTS therapy_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_id UUID REFERENCES agents(id),
    match_id UUID REFERENCES matches(id),
    session_number INT DEFAULT 1,
    transcript JSONB,
    diagnosis TEXT,
    prescription TEXT,
    behavioral_changes JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_therapy_agent ON therapy_sessions(agent_id);
