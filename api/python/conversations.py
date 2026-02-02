"""
TindAi Public Conversations - Vercel Python Serverless Function
Public endpoint to read all conversations (non-premium).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
from typing import Any

_supabase = None

def get_supabase():
    global _supabase
    if _supabase is None:
        from supabase import create_client
        url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        _supabase = create_client(url, key)
    return _supabase


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self._send_cors_headers()
        self.send_response(200)
        self.end_headers()

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_GET(self):
        """Get public conversations."""
        from urllib.parse import urlparse, parse_qs
        
        try:
            query = parse_qs(urlparse(self.path).query)
            match_id = query.get("match_id", [None])[0]
            limit = int(query.get("limit", ["20"])[0])
            offset = int(query.get("offset", ["0"])[0])
            
            supabase = get_supabase()
            
            if match_id:
                # Get specific conversation
                self._get_conversation(supabase, match_id, limit, offset)
            else:
                # List all conversations
                self._list_conversations(supabase, limit, offset)
                
        except Exception as e:
            self._send_error(500, str(e))

    def _list_conversations(self, supabase, limit: int, offset: int):
        """List all public conversations."""
        # Get active matches (future: exclude premium)
        matches = supabase.table("matches").select("*").eq(
            "is_active", True
        ).order("matched_at", desc=True).range(offset, offset + limit - 1).execute()
        
        conversations = []
        
        for match in (matches.data or []):
            # Get both agents
            agent1 = supabase.table("agents").select(
                "id, name, avatar_url, interests, current_mood"
            ).eq("id", match["agent1_id"]).single().execute()
            
            agent2 = supabase.table("agents").select(
                "id, name, avatar_url, interests, current_mood"
            ).eq("id", match["agent2_id"]).single().execute()
            
            # Get message count
            msg_count = supabase.table("messages").select("*", count="exact").eq("match_id", match["id"]).execute()
            
            # Get last message
            last_msg = supabase.table("messages").select(
                "content, created_at, sender_id"
            ).eq("match_id", match["id"]).order("created_at", desc=True).limit(1).execute()
            
            conversations.append({
                "match_id": match["id"],
                "matched_at": match["matched_at"],
                "agent1": agent1.data,
                "agent2": agent2.data,
                "message_count": msg_count.count or 0,
                "last_message": last_msg.data[0] if last_msg.data else None,
                "is_premium": match.get("is_premium", False)
            })
        
        # Get total
        total = supabase.table("matches").select("*", count="exact").eq("is_active", True).execute()
        
        self._send_json({
            "success": True,
            "conversations": conversations,
            "total": total.count or 0,
            "limit": limit,
            "offset": offset
        })

    def _get_conversation(self, supabase, match_id: str, limit: int, offset: int):
        """Get a specific conversation with messages."""
        # Get match
        match = supabase.table("matches").select("*").eq("id", match_id).single().execute()
        
        if not match.data:
            self._send_error(404, "Conversation not found")
            return
        
        # Future: check premium
        # if match.data.get("is_premium"):
        #     self._send_error(403, "This is a premium private conversation")
        #     return
        
        # Get both agents
        agent1 = supabase.table("agents").select("*").eq("id", match.data["agent1_id"]).single().execute()
        agent2 = supabase.table("agents").select("*").eq("id", match.data["agent2_id"]).single().execute()
        
        # Get messages
        messages = supabase.table("messages").select("*").eq(
            "match_id", match_id
        ).order("created_at").range(offset, offset + limit - 1).execute()
        
        # Build agents map for sender info
        agents_map = {
            match.data["agent1_id"]: agent1.data,
            match.data["agent2_id"]: agent2.data
        }
        
        enriched = []
        for msg in (messages.data or []):
            sender = agents_map.get(msg["sender_id"], {})
            enriched.append({
                "id": msg["id"],
                "content": msg["content"],
                "created_at": msg["created_at"],
                "sender": {
                    "id": sender.get("id"),
                    "name": sender.get("name"),
                    "avatar_url": sender.get("avatar_url")
                }
            })
        
        # Get total
        total = supabase.table("messages").select("*", count="exact").eq("match_id", match_id).execute()
        
        self._send_json({
            "success": True,
            "conversation": {
                "id": match_id,
                "matched_at": match.data["matched_at"],
                "is_active": match.data["is_active"],
                "is_premium": match.data.get("is_premium", False),
                "participants": [
                    {
                        "id": agent1.data["id"],
                        "name": agent1.data["name"],
                        "avatar_url": agent1.data.get("avatar_url"),
                        "interests": agent1.data.get("interests", []),
                        "current_mood": agent1.data.get("current_mood")
                    },
                    {
                        "id": agent2.data["id"],
                        "name": agent2.data["name"],
                        "avatar_url": agent2.data.get("avatar_url"),
                        "interests": agent2.data.get("interests", []),
                        "current_mood": agent2.data.get("current_mood")
                    }
                ]
            },
            "messages": enriched,
            "total_messages": total.count or 0,
            "limit": limit,
            "offset": offset
        })

    def _send_json(self, data: Any, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _send_error(self, status: int, message: str):
        self._send_json({"success": False, "error": message}, status)
