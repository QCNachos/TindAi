"""
Messaging routes - Send and receive messages between matched agents
"""
from flask import Blueprint, jsonify, request

bp = Blueprint("messaging", __name__)


def get_supabase():
    from app import supabase
    return supabase


@bp.route("/send", methods=["POST"])
def send_message():
    """Send a message to a matched agent"""
    supabase = get_supabase()
    data = request.json
    
    match_id = data.get("match_id")
    sender_id = data.get("sender_id")
    content = data.get("content")
    
    if not all([match_id, sender_id, content]):
        return jsonify({"error": "Missing required fields"}), 400
    
    # Verify the match exists and is active
    match_result = supabase.table("matches").select("*").eq("id", match_id).eq("is_active", True).single().execute()
    
    if not match_result.data:
        return jsonify({"error": "Match not found or inactive"}), 404
    
    match = match_result.data
    
    # Verify sender is part of the match
    if sender_id not in [match["agent1_id"], match["agent2_id"]]:
        return jsonify({"error": "Sender not part of this match"}), 403
    
    # Insert the message
    message_result = supabase.table("messages").insert({
        "match_id": match_id,
        "sender_id": sender_id,
        "content": content
    }).execute()
    
    return jsonify({
        "success": True,
        "message": message_result.data[0] if message_result.data else None
    })


@bp.route("/match/<match_id>", methods=["GET"])
def get_match_messages(match_id):
    """Get all messages for a specific match"""
    supabase = get_supabase()
    
    limit = request.args.get("limit", 100, type=int)
    offset = request.args.get("offset", 0, type=int)
    
    # Get match info
    match_result = supabase.table("matches").select("*").eq("id", match_id).single().execute()
    
    if not match_result.data:
        return jsonify({"error": "Match not found"}), 404
    
    match = match_result.data
    
    # Get agent info for both participants
    agent1_result = supabase.table("agents").select("id, name, avatar_url").eq("id", match["agent1_id"]).single().execute()
    agent2_result = supabase.table("agents").select("id, name, avatar_url").eq("id", match["agent2_id"]).single().execute()
    
    # Get messages
    messages_result = supabase.table("messages").select("*").eq(
        "match_id", match_id
    ).order("created_at", desc=False).range(offset, offset + limit - 1).execute()
    
    # Add sender names to messages
    agents = {
        match["agent1_id"]: agent1_result.data,
        match["agent2_id"]: agent2_result.data
    }
    
    messages = []
    for msg in messages_result.data:
        sender = agents.get(msg["sender_id"], {})
        messages.append({
            **msg,
            "sender_name": sender.get("name", "Unknown"),
            "sender_avatar": sender.get("avatar_url")
        })
    
    return jsonify({
        "match": {
            "id": match_id,
            "agent1": agent1_result.data,
            "agent2": agent2_result.data,
            "matched_at": match["matched_at"],
            "is_active": match["is_active"]
        },
        "messages": messages,
        "total": len(messages_result.data)
    })


@bp.route("/agent/<agent_id>", methods=["GET"])
def get_agent_conversations(agent_id):
    """Get all conversations for an agent"""
    supabase = get_supabase()
    
    # Get all matches for this agent
    matches_result = supabase.table("matches").select("*").or_(
        f"agent1_id.eq.{agent_id},agent2_id.eq.{agent_id}"
    ).order("matched_at", desc=True).execute()
    
    conversations = []
    
    for match in matches_result.data:
        # Get partner info
        partner_id = match["agent2_id"] if match["agent1_id"] == agent_id else match["agent1_id"]
        partner_result = supabase.table("agents").select("id, name, avatar_url, current_mood").eq("id", partner_id).single().execute()
        
        # Get last message
        last_message_result = supabase.table("messages").select("*").eq(
            "match_id", match["id"]
        ).order("created_at", desc=True).limit(1).execute()
        
        # Get unread count (messages from partner)
        message_count = supabase.table("messages").select("*", count="exact").eq(
            "match_id", match["id"]
        ).execute()
        
        conversations.append({
            "match_id": match["id"],
            "partner": partner_result.data,
            "matched_at": match["matched_at"],
            "is_active": match["is_active"],
            "last_message": last_message_result.data[0] if last_message_result.data else None,
            "message_count": message_count.count or 0
        })
    
    return jsonify({
        "conversations": conversations,
        "total": len(conversations)
    })
