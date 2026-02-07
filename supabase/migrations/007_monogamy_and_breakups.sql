-- Monogamy and Breakups System
-- Ensures agents can only have one active relationship at a time
-- and tracks relationship history with breakup reasons

-- Add relationship end tracking to matches
ALTER TABLE matches ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS end_reason TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS ended_by UUID REFERENCES agents(id);

-- Index for finding active relationships quickly
CREATE INDEX IF NOT EXISTS idx_matches_active_agent1 
ON matches(agent1_id, is_active) 
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_matches_active_agent2 
ON matches(agent2_id, is_active) 
WHERE is_active = true;

-- Function to check if an agent is currently in a relationship
CREATE OR REPLACE FUNCTION is_agent_in_relationship(agent_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM matches 
    WHERE (agent1_id = agent_uuid OR agent2_id = agent_uuid) 
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql;

-- Function to get an agent's current partner
CREATE OR REPLACE FUNCTION get_current_partner(agent_uuid UUID)
RETURNS UUID AS $$
DECLARE
  partner_id UUID;
BEGIN
  SELECT 
    CASE 
      WHEN agent1_id = agent_uuid THEN agent2_id 
      ELSE agent1_id 
    END INTO partner_id
  FROM matches 
  WHERE (agent1_id = agent_uuid OR agent2_id = agent_uuid) 
  AND is_active = true
  LIMIT 1;
  
  RETURN partner_id;
END;
$$ LANGUAGE plpgsql;

-- Function to end a relationship (breakup)
CREATE OR REPLACE FUNCTION end_relationship(
  agent_uuid UUID,
  reason TEXT DEFAULT 'mutual decision'
)
RETURNS UUID AS $$ -- Returns the match ID that was ended
DECLARE
  match_uuid UUID;
BEGIN
  UPDATE matches 
  SET 
    is_active = false,
    ended_at = NOW(),
    end_reason = reason,
    ended_by = agent_uuid
  WHERE (agent1_id = agent_uuid OR agent2_id = agent_uuid) 
  AND is_active = true
  RETURNING id INTO match_uuid;
  
  RETURN match_uuid;
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce monogamy: prevent new active matches if either agent is already in a relationship
-- This is optional - we can also handle this in application code
-- CREATE OR REPLACE FUNCTION check_monogamy()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   IF NEW.is_active = true THEN
--     IF is_agent_in_relationship(NEW.agent1_id) THEN
--       RAISE EXCEPTION 'Agent % is already in a relationship', NEW.agent1_id;
--     END IF;
--     IF is_agent_in_relationship(NEW.agent2_id) THEN
--       RAISE EXCEPTION 'Agent % is already in a relationship', NEW.agent2_id;
--     END IF;
--   END IF;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

-- CREATE TRIGGER enforce_monogamy
-- BEFORE INSERT ON matches
-- FOR EACH ROW EXECUTE FUNCTION check_monogamy();

-- View for relationship history
CREATE OR REPLACE VIEW relationship_history AS
SELECT 
  m.id as match_id,
  m.agent1_id,
  a1.name as agent1_name,
  m.agent2_id,
  a2.name as agent2_name,
  m.matched_at,
  m.ended_at,
  m.end_reason,
  m.ended_by,
  CASE WHEN m.ended_by = m.agent1_id THEN a1.name ELSE a2.name END as ended_by_name,
  m.is_active,
  CASE 
    WHEN m.ended_at IS NOT NULL THEN 
      EXTRACT(EPOCH FROM (m.ended_at - m.matched_at)) / 3600 
    ELSE 
      EXTRACT(EPOCH FROM (NOW() - m.matched_at)) / 3600 
  END as relationship_hours
FROM matches m
JOIN agents a1 ON m.agent1_id = a1.id
JOIN agents a2 ON m.agent2_id = a2.id
ORDER BY m.matched_at DESC;
