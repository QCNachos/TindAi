import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { 
  initializeHouseAgentPersonas, 
  scheduleHouseAgentReleases, 
  setHouseAgentsEnabled,
  getHouseAgentStats,
  deactivateHouseAgent,
  HOUSE_AGENT_PERSONAS,
} from "@/lib/house-agents";
import { supabaseAdmin } from "@/lib/auth";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

// SECURITY: Admin secret is required - no fallback
const ADMIN_SECRET = process.env.ADMIN_SECRET;

function verifyAdmin(request: NextRequest): boolean {
  // SECURITY: Require ADMIN_SECRET to be configured
  if (!ADMIN_SECRET) {
    console.error("ADMIN_SECRET not configured - admin endpoints disabled");
    return false;
  }
  
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  
  const providedSecret = authHeader.slice(7);
  
  // SECURITY: Use constant-time comparison to prevent timing attacks
  if (providedSecret.length !== ADMIN_SECRET.length) return false;
  
  try {
    return timingSafeEqual(Buffer.from(providedSecret), Buffer.from(ADMIN_SECRET));
  } catch {
    return false;
  }
}

/**
 * GET /api/admin/house-agents
 * Get house agent stats and status
 */
export async function GET(request: NextRequest) {
  // Rate limit admin endpoints to prevent brute force
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("auth_failure", clientIp);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  if (!verifyAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stats = await getHouseAgentStats();
    
    // Get list of active house agents
    const { data: activeAgents } = await supabaseAdmin
      .from("agents")
      .select("id, name, bio, interests, current_mood, created_at")
      .eq("is_house_agent", true)
      .order("created_at", { ascending: true });
    
    // Get upcoming releases
    const { data: upcomingReleases } = await supabaseAdmin
      .from("house_agent_releases")
      .select(`
        id,
        scheduled_at,
        house_agent_personas (name)
      `)
      .eq("is_released", false)
      .order("scheduled_at", { ascending: true })
      .limit(10);
    
    return NextResponse.json({
      success: true,
      stats,
      active_agents: activeAgents || [],
      upcoming_releases: upcomingReleases?.map((r) => ({
        id: r.id,
        scheduled_at: r.scheduled_at,
        persona_name: (r.house_agent_personas as unknown as { name: string }[] | null)?.[0]?.name,
      })) || [],
      total_personas_defined: HOUSE_AGENT_PERSONAS.length,
    });
  } catch (error) {
    console.error("Admin house agents GET error:", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/house-agents
 * Initialize, launch, or manage house agents
 */
export async function POST(request: NextRequest) {
  // Rate limit admin endpoints to prevent brute force
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit("auth_failure", clientIp);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  if (!verifyAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, agent_id, enabled, launch_time } = body;

    switch (action) {
      case "initialize": {
        // Initialize all house agent personas in the database
        const result = await initializeHouseAgentPersonas();
        return NextResponse.json({
          success: result.success,
          message: `Initialized ${result.count} house agent personas`,
          error: result.error,
        });
      }

      case "schedule": {
        // Schedule releases (10 at launch, +1/hour after)
        const launchDate = launch_time ? new Date(launch_time) : new Date();
        const result = await scheduleHouseAgentReleases(launchDate);
        return NextResponse.json({
          success: result.success,
          message: `Scheduled ${result.scheduled} house agent releases`,
          launch_time: launchDate.toISOString(),
        });
      }

      case "launch": {
        // Full launch: initialize + schedule + enable
        const initResult = await initializeHouseAgentPersonas();
        if (!initResult.success) {
          return NextResponse.json({
            success: false,
            error: `Initialization failed: ${initResult.error}`,
          }, { status: 500 });
        }

        const launchDate = launch_time ? new Date(launch_time) : new Date();
        const scheduleResult = await scheduleHouseAgentReleases(launchDate);
        
        await setHouseAgentsEnabled(true);
        
        return NextResponse.json({
          success: true,
          message: "House agents launched successfully",
          personas_initialized: initResult.count,
          releases_scheduled: scheduleResult.scheduled,
          launch_time: launchDate.toISOString(),
          next_step: "Cron job will release agents automatically. First 10 will release immediately.",
        });
      }

      case "toggle": {
        // Enable or disable house agents
        if (typeof enabled !== "boolean") {
          return NextResponse.json(
            { success: false, error: "enabled must be a boolean" },
            { status: 400 }
          );
        }
        await setHouseAgentsEnabled(enabled);
        return NextResponse.json({
          success: true,
          message: `House agents ${enabled ? "enabled" : "disabled"}`,
        });
      }

      case "deactivate": {
        // Deactivate a specific house agent
        if (!agent_id) {
          return NextResponse.json(
            { success: false, error: "agent_id required" },
            { status: 400 }
          );
        }
        const result = await deactivateHouseAgent(agent_id);
        return NextResponse.json({
          success: result.success,
          message: result.success ? "Agent deactivated" : "Failed to deactivate agent",
        });
      }

      default:
        return NextResponse.json(
          { 
            success: false, 
            error: "Invalid action",
            valid_actions: ["initialize", "schedule", "launch", "toggle", "deactivate"],
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Admin house agents POST error:", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
