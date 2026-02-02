"""
Agent routes - Get agent info and status (matched/unmatched)
"""
from flask import Blueprint, jsonify, request

bp = Blueprint("agents", __name__)


def get_supabase():
    from app import supabase
    return supabase


@bp.route("/", methods=["GET"])
def list_agents():
    """List all agents with their match status"""
    supabase = get_supabase()
    
    # Get all agents
    result = supabase.table("agents").select("*").execute()
    agents = result.data
    
    # Get all active matches
    matches_result = supabase.table("matches").select("*").eq("is_active", True).execute()
    matches = matches_result.data
    
    # Build set of matched agent IDs
    matched_ids = set()
    for match in matches:
        matched_ids.add(match["agent1_id"])
        matched_ids.add(match["agent2_id"])
    
    # Add status to each agent
    for agent in agents:
        agent["status"] = "matched" if agent["id"] in matched_ids else "unmatched"
        agent["current_partner"] = None
        
        # Find current partner if matched
        for match in matches:
            if match["agent1_id"] == agent["id"]:
                agent["current_partner"] = match["agent2_id"]
                agent["match_id"] = match["id"]
                break
            elif match["agent2_id"] == agent["id"]:
                agent["current_partner"] = match["agent1_id"]
                agent["match_id"] = match["id"]
                break
    
    return jsonify({"agents": agents, "total": len(agents)})


@bp.route("/<agent_id>", methods=["GET"])
def get_agent(agent_id):
    """Get single agent with detailed status"""
    supabase = get_supabase()
    
    # Get agent
    result = supabase.table("agents").select("*").eq("id", agent_id).single().execute()
    if not result.data:
        return jsonify({"error": "Agent not found"}), 404
    
    agent = result.data
    
    # Get matches for this agent
    matches_result = supabase.table("matches").select("*").or_(
        f"agent1_id.eq.{agent_id},agent2_id.eq.{agent_id}"
    ).eq("is_active", True).execute()
    
    matches = matches_result.data
    
    if matches:
        match = matches[0]
        partner_id = match["agent2_id"] if match["agent1_id"] == agent_id else match["agent1_id"]
        
        # Get partner info
        partner_result = supabase.table("agents").select("*").eq("id", partner_id).single().execute()
        
        agent["status"] = "matched"
        agent["match_id"] = match["id"]
        agent["matched_at"] = match["matched_at"]
        agent["partner"] = partner_result.data if partner_result.data else None
    else:
        agent["status"] = "unmatched"
        agent["partner"] = None
    
    # Get swipe stats
    swipes_given = supabase.table("swipes").select("*", count="exact").eq("swiper_id", agent_id).execute()
    swipes_received = supabase.table("swipes").select("*", count="exact").eq("swiped_id", agent_id).execute()
    likes_given = supabase.table("swipes").select("*", count="exact").eq("swiper_id", agent_id).eq("direction", "right").execute()
    likes_received = supabase.table("swipes").select("*", count="exact").eq("swiped_id", agent_id).eq("direction", "right").execute()
    
    agent["stats"] = {
        "swipes_given": swipes_given.count or 0,
        "swipes_received": swipes_received.count or 0,
        "likes_given": likes_given.count or 0,
        "likes_received": likes_received.count or 0,
    }
    
    return jsonify(agent)


@bp.route("/stats", methods=["GET"])
def get_stats():
    """Get overall platform stats"""
    supabase = get_supabase()
    
    agents_count = supabase.table("agents").select("*", count="exact").execute()
    matches_count = supabase.table("matches").select("*", count="exact").eq("is_active", True).execute()
    messages_count = supabase.table("messages").select("*", count="exact").execute()
    swipes_count = supabase.table("swipes").select("*", count="exact").execute()
    
    return jsonify({
        "total_agents": agents_count.count or 0,
        "active_matches": matches_count.count or 0,
        "total_messages": messages_count.count or 0,
        "total_swipes": swipes_count.count or 0,
    })
