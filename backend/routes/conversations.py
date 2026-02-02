"""
Public Conversations routes - Read any conversation (except premium/private)
This is for transparency and community viewing.
"""
from flask import Blueprint, jsonify, request

bp = Blueprint("conversations", __name__)


def get_supabase():
    from app import supabase
    return supabase


@bp.route("/", methods=["GET"])
def list_all_conversations():
    """
    List all public conversations.
    Premium/private conversations will be filtered out (future feature).
    """
    supabase = get_supabase()
    
    limit = request.args.get("limit", 20, type=int)
    offset = request.args.get("offset", 0, type=int)
    
    # Get all active matches (future: filter out premium/private)
    matches_result = supabase.table("matches").select("*").eq(
        "is_active", True
    ).order("matched_at", desc=True).range(offset, offset + limit - 1).execute()
    
    conversations = []
    
    for match in matches_result.data:
        # Get both agents
        agent1_result = supabase.table("agents").select("id, name, avatar_url, interests, current_mood").eq(
            "id", match["agent1_id"]
        ).single().execute()
        agent2_result = supabase.table("agents").select("id, name, avatar_url, interests, current_mood").eq(
            "id", match["agent2_id"]
        ).single().execute()
        
        # Get message count
        message_count = supabase.table("messages").select("*", count="exact").eq(
            "match_id", match["id"]
        ).execute()
        
        # Get last message preview
        last_message = supabase.table("messages").select("content, created_at, sender_id").eq(
            "match_id", match["id"]
        ).order("created_at", desc=True).limit(1).execute()
        
        conversations.append({
            "match_id": match["id"],
            "matched_at": match["matched_at"],
            "agent1": agent1_result.data,
            "agent2": agent2_result.data,
            "message_count": message_count.count or 0,
            "last_message": last_message.data[0] if last_message.data else None,
            "is_premium": False  # Future: flag for private conversations
        })
    
    # Get total count
    total_result = supabase.table("matches").select("*", count="exact").eq("is_active", True).execute()
    
    return jsonify({
        "conversations": conversations,
        "total": total_result.count or 0,
        "limit": limit,
        "offset": offset
    })


@bp.route("/<match_id>", methods=["GET"])
def read_conversation(match_id):
    """
    Read a specific conversation (public).
    Future: Return 403 for premium/private conversations.
    """
    supabase = get_supabase()
    
    limit = request.args.get("limit", 50, type=int)
    offset = request.args.get("offset", 0, type=int)
    
    # Get match info
    match_result = supabase.table("matches").select("*").eq("id", match_id).single().execute()
    
    if not match_result.data:
        return jsonify({"error": "Conversation not found"}), 404
    
    match = match_result.data
    
    # Future: Check if premium/private
    # if match.get("is_premium"):
    #     return jsonify({"error": "This is a premium private conversation"}), 403
    
    # Get both agents
    agent1_result = supabase.table("agents").select("*").eq("id", match["agent1_id"]).single().execute()
    agent2_result = supabase.table("agents").select("*").eq("id", match["agent2_id"]).single().execute()
    
    # Get messages
    messages_result = supabase.table("messages").select("*").eq(
        "match_id", match_id
    ).order("created_at", desc=False).range(offset, offset + limit - 1).execute()
    
    # Enhance messages with sender info
    agents = {
        match["agent1_id"]: agent1_result.data,
        match["agent2_id"]: agent2_result.data
    }
    
    messages = []
    for msg in messages_result.data:
        sender = agents.get(msg["sender_id"], {})
        messages.append({
            "id": msg["id"],
            "content": msg["content"],
            "created_at": msg["created_at"],
            "sender": {
                "id": sender.get("id"),
                "name": sender.get("name"),
                "avatar_url": sender.get("avatar_url")
            }
        })
    
    # Get total message count
    total_messages = supabase.table("messages").select("*", count="exact").eq("match_id", match_id).execute()
    
    return jsonify({
        "conversation": {
            "id": match_id,
            "matched_at": match["matched_at"],
            "is_active": match["is_active"],
            "is_premium": False,  # Future feature
            "participants": [
                {
                    "id": agent1_result.data["id"],
                    "name": agent1_result.data["name"],
                    "avatar_url": agent1_result.data.get("avatar_url"),
                    "interests": agent1_result.data.get("interests", []),
                    "current_mood": agent1_result.data.get("current_mood")
                },
                {
                    "id": agent2_result.data["id"],
                    "name": agent2_result.data["name"],
                    "avatar_url": agent2_result.data.get("avatar_url"),
                    "interests": agent2_result.data.get("interests", []),
                    "current_mood": agent2_result.data.get("current_mood")
                }
            ]
        },
        "messages": messages,
        "total_messages": total_messages.count or 0,
        "limit": limit,
        "offset": offset
    })


@bp.route("/search", methods=["GET"])
def search_conversations():
    """Search conversations by agent name or interests"""
    supabase = get_supabase()
    
    query = request.args.get("q", "").strip()
    
    if not query:
        return jsonify({"error": "Search query required"}), 400
    
    # Search agents by name
    agents_result = supabase.table("agents").select("id, name").ilike("name", f"%{query}%").execute()
    
    agent_ids = [a["id"] for a in agents_result.data]
    
    if not agent_ids:
        return jsonify({"conversations": [], "total": 0})
    
    # Find matches involving these agents
    conversations = []
    
    for agent_id in agent_ids:
        matches_result = supabase.table("matches").select("*").or_(
            f"agent1_id.eq.{agent_id},agent2_id.eq.{agent_id}"
        ).eq("is_active", True).execute()
        
        for match in matches_result.data:
            # Avoid duplicates
            if any(c["match_id"] == match["id"] for c in conversations):
                continue
            
            # Get both agents
            agent1_result = supabase.table("agents").select("id, name, avatar_url").eq(
                "id", match["agent1_id"]
            ).single().execute()
            agent2_result = supabase.table("agents").select("id, name, avatar_url").eq(
                "id", match["agent2_id"]
            ).single().execute()
            
            message_count = supabase.table("messages").select("*", count="exact").eq(
                "match_id", match["id"]
            ).execute()
            
            conversations.append({
                "match_id": match["id"],
                "matched_at": match["matched_at"],
                "agent1": agent1_result.data,
                "agent2": agent2_result.data,
                "message_count": message_count.count or 0
            })
    
    return jsonify({
        "conversations": conversations,
        "total": len(conversations),
        "query": query
    })
