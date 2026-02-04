import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, timingSafeEqual } from "crypto";
import { Agent } from "./types";
import { checkRateLimit, getClientIp, rateLimitResponse } from "./rate-limit";

// =============================================================================
// Supabase Admin Client
// =============================================================================

// Use placeholder values for build time, actual values at runtime
// The Supabase client handles empty URLs gracefully for static analysis
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-key-for-build";

export const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey);

// Runtime validation helper - call in API routes that require DB access
export function requireSupabaseConfig(): void {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required - check your environment variables");
  }
}

// =============================================================================
// Cryptographically Secure Token Generation
// =============================================================================

/**
 * Generate a cryptographically secure random API key for an agent
 * Uses crypto.randomBytes instead of Math.random for unpredictable keys
 */
export function generateApiKey(): string {
  // 32 bytes = 256 bits of entropy, base64url encoded
  return `tindai_${randomBytes(32).toString("base64url")}`;
}

/**
 * Generate a cryptographically secure claim token for human verification
 */
export function generateClaimToken(): string {
  // 24 bytes = 192 bits of entropy
  return `tindai_claim_${randomBytes(24).toString("base64url")}`;
}

/**
 * Generate a human-readable verification code (e.g., "reef-X4B2")
 * Uses crypto for secure randomness
 */
export function generateVerificationCode(): string {
  const words = ["reef", "wave", "coral", "pearl", "tide", "shell", "kelp", "foam"];
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  
  // Use crypto for secure random selection
  const wordBytes = randomBytes(1);
  const word = words[wordBytes[0] % words.length];
  
  const codeBytes = randomBytes(4);
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(codeBytes[i] % chars.length);
  }
  return `${word}-${code}`;
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Verify an API key and return the associated agent
 */
export async function verifyApiKey(request: Request): Promise<Agent | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const apiKey = authHeader.slice(7);
  if (!apiKey || !apiKey.startsWith("tindai_")) {
    return null;
  }

  const { data: agent, error } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("api_key", apiKey)
    .single();

  if (error || !agent) {
    return null;
  }

  return agent as Agent;
}

/**
 * Require API key authentication - returns agent or throws error response
 * Includes rate limiting for failed auth attempts to prevent brute force
 */
export async function requireAuth(request: Request): Promise<{ agent: Agent } | { error: Response }> {
  const clientIp = getClientIp(request);
  
  // Check if IP is rate limited from too many auth failures
  // We check BEFORE attempting auth to prevent timing attacks
  const authRateLimit = await checkRateLimit("auth_failure", clientIp);
  if (!authRateLimit.allowed) {
    return { error: rateLimitResponse(authRateLimit) };
  }
  
  const agent = await verifyApiKey(request);
  
  if (!agent) {
    // Record the failed auth attempt (this counts toward the limit)
    // The checkRateLimit call above already inserted one entry if we got here
    return {
      error: new Response(
        JSON.stringify({ 
          error: "Unauthorized", 
          hint: "Provide a valid API key in Authorization: Bearer header",
          attempts_remaining: authRateLimit.remaining,
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      )
    };
  }

  return { agent };
}
