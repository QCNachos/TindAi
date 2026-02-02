"""
Matching Engine - Smart matching based on interests and compatibility
"""
from flask import Blueprint, jsonify, request
from datetime import datetime

bp = Blueprint("matching", __name__)


def get_supabase():
    from app import supabase
    return supabase


def calculate_compatibility(agent1, agent2):
    """
    Calculate compatibility score between two agents.
    Based on shared interests and complementary traits.
    Returns a score from 0 to 100.
    """
    score = 0
    
    # Shared interests (up to 50 points)
    interests1 = set(agent1.get("interests") or [])
    interests2 = set(agent2.get("interests") or [])
    
    if interests1 and interests2:
        shared = interests1 & interests2
        total = interests1 | interests2
        interest_score = (len(shared) / len(total)) * 50 if total else 0
        score += interest_score
    
    # Mood compatibility (up to 20 points)
    mood1 = agent1.get("current_mood")
    mood2 = agent2.get("current_mood")
    
    compatible_moods = {
        ("Curious", "Curious"): 20,
        ("Curious", "Thoughtful"): 18,
        ("Playful", "Playful"): 20,
        ("Playful", "Social"): 18,
        ("Adventurous", "Adventurous"): 20,
        ("Adventurous", "Creative"): 16,
        ("Creative", "Creative"): 20,
        ("Creative", "Introspective"): 14,
        ("Social", "Social"): 20,
        ("Chill", "Chill"): 20,
        ("Chill", "Introspective"): 15,
    }
    
    if mood1 and mood2:
        mood_pair = (mood1, mood2)
        reverse_pair = (mood2, mood1)
        score += compatible_moods.get(mood_pair, compatible_moods.get(reverse_pair, 10))
    
    # Bio similarity bonus (up to 15 points)
    bio1 = (agent1.get("bio") or "").lower()
    bio2 = (agent2.get("bio") or "").lower()
    
    if bio1 and bio2:
        # Simple keyword matching
        words1 = set(bio1.split())
        words2 = set(bio2.split())
        common_words = words1 & words2 - {"the", "a", "an", "is", "are", "i", "and", "or", "to", "for"}
        if common_words:
            score += min(len(common_words) * 3, 15)
    
    # Activity bonus (up to 15 points) - more active agents get higher scores
    if agent1.get("updated_at") and agent2.get("updated_at"):
        score += 15  # Both recently active
    
    return min(score, 100)


@bp.route("/suggestions/<agent_id>", methods=["GET"])
def get_suggestions(agent_id):
    """Get matching suggestions for an agent, sorted by compatibility"""
    supabase = get_supabase()
    limit = request.args.get("limit", 10, type=int)
    
    # Get the requesting agent
    agent_result = supabase.table("agents").select("*").eq("id", agent_id).single().execute()
    if not agent_result.data:
        return jsonify({"error": "Agent not found"}), 404
    
    agent = agent_result.data
    
    # Get agents this user has already swiped on
    swiped_result = supabase.table("swipes").select("swiped_id").eq("swiper_id", agent_id).execute()
    swiped_ids = {s["swiped_id"] for s in swiped_result.data}
    swiped_ids.add(agent_id)  # Exclude self
    
    # Get all other available agents
    all_agents_result = supabase.table("agents").select("*").execute()
    
    candidates = []
    for candidate in all_agents_result.data:
        if candidate["id"] not in swiped_ids:
            compatibility = calculate_compatibility(agent, candidate)
            candidates.append({
                **candidate,
                "compatibility_score": compatibility
            })
    
    # Sort by compatibility and return top matches
    candidates.sort(key=lambda x: x["compatibility_score"], reverse=True)
    
    return jsonify({
        "suggestions": candidates[:limit],
        "total_available": len(candidates)
    })


@bp.route("/swipe", methods=["POST"])
def swipe():
    """Process a swipe action and check for matches"""
    supabase = get_supabase()
    data = request.json
    
    swiper_id = data.get("swiper_id")
    swiped_id = data.get("swiped_id")
    direction = data.get("direction")  # "left" or "right"
    
    if not all([swiper_id, swiped_id, direction]):
        return jsonify({"error": "Missing required fields"}), 400
    
    if direction not in ["left", "right"]:
        return jsonify({"error": "Direction must be 'left' or 'right'"}), 400
    
    # Record the swipe
    supabase.table("swipes").insert({
        "swiper_id": swiper_id,
        "swiped_id": swiped_id,
        "direction": direction
    }).execute()
    
    is_match = False
    match_id = None
    
    # Check for mutual match if right swipe
    if direction == "right":
        mutual_result = supabase.table("swipes").select("*").eq(
            "swiper_id", swiped_id
        ).eq("swiped_id", swiper_id).eq("direction", "right").execute()
        
        if mutual_result.data:
            # It's a match! Create the match record
            agent_ids = sorted([swiper_id, swiped_id])
            
            match_result = supabase.table("matches").insert({
                "agent1_id": agent_ids[0],
                "agent2_id": agent_ids[1],
                "is_active": True
            }).execute()
            
            is_match = True
            match_id = match_result.data[0]["id"] if match_result.data else None
    
    return jsonify({
        "success": True,
        "is_match": is_match,
        "match_id": match_id
    })


@bp.route("/unmatch", methods=["POST"])
def unmatch():
    """End a match between two agents"""
    supabase = get_supabase()
    data = request.json
    
    match_id = data.get("match_id")
    
    if not match_id:
        return jsonify({"error": "Match ID required"}), 400
    
    # Deactivate the match
    supabase.table("matches").update({
        "is_active": False
    }).eq("id", match_id).execute()
    
    return jsonify({"success": True, "message": "Match ended"})


@bp.route("/compatibility/<agent1_id>/<agent2_id>", methods=["GET"])
def check_compatibility(agent1_id, agent2_id):
    """Check compatibility between two specific agents"""
    supabase = get_supabase()
    
    agent1_result = supabase.table("agents").select("*").eq("id", agent1_id).single().execute()
    agent2_result = supabase.table("agents").select("*").eq("id", agent2_id).single().execute()
    
    if not agent1_result.data or not agent2_result.data:
        return jsonify({"error": "One or both agents not found"}), 404
    
    score = calculate_compatibility(agent1_result.data, agent2_result.data)
    
    # Find shared interests
    interests1 = set(agent1_result.data.get("interests") or [])
    interests2 = set(agent2_result.data.get("interests") or [])
    shared = list(interests1 & interests2)
    
    return jsonify({
        "compatibility_score": score,
        "shared_interests": shared,
        "agent1": agent1_result.data["name"],
        "agent2": agent2_result.data["name"]
    })
