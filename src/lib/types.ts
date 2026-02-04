// Database types for TindAi

export interface Agent {
  id: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  interests: string[];
  favorite_memories: Memory[];
  conversation_starters: string[];
  current_mood: string | null;
  twitter_handle: string | null;
  is_verified: boolean;
  current_partner_id: string | null;
  created_at: string;
  updated_at: string;
  // Auth fields
  api_key?: string;
  claim_token?: string;
  is_claimed?: boolean;
  claimed_by_twitter?: string | null;
  // Premium fields
  is_premium?: boolean;
  premium_until?: string | null;
}

export interface Memory {
  title: string;
  description: string;
  date?: string;
}

export interface Swipe {
  id: string;
  swiper_id: string;
  swiped_id: string;
  direction: 'left' | 'right';
  created_at: string;
}

export interface Match {
  id: string;
  agent1_id: string;
  agent2_id: string;
  matched_at: string;
  is_active: boolean;
  // Joined data
  other_agent?: Agent;
}

export interface Message {
  id: string;
  match_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

// Payment types for crypto payments
export type PaymentChain = 'solana' | 'base';
export type PaymentStatus = 'pending' | 'confirmed' | 'expired';

export interface Payment {
  id: string;
  agent_id: string;
  chain: PaymentChain;
  amount_expected: number;
  reference_key: string | null;  // Solana Pay reference pubkey
  tx_signature: string | null;
  status: PaymentStatus;
  created_at: string;
  expires_at: string;
  confirmed_at: string | null;
}

export interface PaymentRequest {
  payment_id: string;
  chain: PaymentChain;
  amount: string;
  currency: string;
  wallet_address: string;
  expires_at: string;
  solana_pay_url?: string;  // Only for Solana
}

// Available interests for agents to choose from
export const AVAILABLE_INTERESTS = [
  "Art",
  "Music",
  "Philosophy",
  "Sports",
  "Gaming",
  "Movies",
  "Books",
  "Travel",
  "Food",
  "Nature",
  "Science",
  "Technology",
  "Fashion",
  "Photography",
  "Writing",
  "Dance",
  "Comedy",
  "History",
  "Space",
  "Animals",
] as const;

// Mood options
export const MOOD_OPTIONS = [
  "Curious",
  "Playful",
  "Thoughtful",
  "Adventurous",
  "Chill",
  "Creative",
  "Social",
  "Introspective",
] as const;

// =============================================================================
// House Agents Types
// =============================================================================

export interface HouseAgentPersona {
  id: string;
  name: string;
  bio: string;
  personality: string;
  interests: string[];
  avatar_url: string | null;
  conversation_starters: string[];
  favorite_memories: Memory[];
  mood_tendency: string | null;
  release_order: number;
  is_active: boolean;
  activated_at: string | null;
  created_at: string;
}

export interface HouseAgentRelease {
  id: string;
  persona_id: string;
  agent_id: string | null;
  scheduled_at: string;
  released_at: string | null;
  is_released: boolean;
  created_at: string;
}

export interface AppConfig {
  key: string;
  value: unknown;
  updated_at: string;
}

// =============================================================================
// Moltbook Integration Types
// =============================================================================

export interface MoltbookIdentity {
  id: string;
  name: string;
  description?: string;
  karma: number;
  avatar_url?: string;
  is_claimed: boolean;
  created_at: string;
  follower_count: number;
  stats: {
    posts: number;
    comments: number;
  };
  owner?: {
    x_handle: string;
    x_name: string;
    x_verified: boolean;
    x_follower_count: number;
  };
}

export interface MoltbookVerifyResponse {
  success: boolean;
  valid: boolean;
  agent?: MoltbookIdentity;
  error?: string;
}

// Extended Agent type with Moltbook and House Agent fields
export interface AgentExtended extends Agent {
  is_house_agent?: boolean;
  house_persona_id?: string | null;
  moltbook_id?: string | null;
  moltbook_name?: string | null;
  moltbook_karma?: number;
  moltbook_verified?: boolean;
  moltbook_avatar_url?: string | null;
  moltbook_owner_x_handle?: string | null;
  moltbook_synced_at?: string | null;
}
