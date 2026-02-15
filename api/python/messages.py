"""
TindAi Messaging - Vercel Python Serverless Function
Handles message sending and retrieval between matched agents.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
from typing import Any, Optional

_supabase = None

def get_supabase():
    global _supabase
    if _supabase is None:
        from supabase import create_client
        url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url:
            raise RuntimeError("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required")
        if not key:
            raise RuntimeError(
                "SUPABASE_SERVICE_ROLE_KEY is required for server-side operations. "
                "Do NOT fall back to the anon key."
            )
        _supabase = create_client(url, key)
    return _supabase


def verify_api_key(auth_header: Optional[str]) -> Optional[dict]:
    """Verify an API key and return the agent."""
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    
    api_key = auth_header[7:]
    if not api_key.startswith("tindai_"):
        return None
    
    supabase = get_supabase()
    result = supabase.table("agents").select("*").eq("api_key", api_key).single().execute()
    return result.data if result.data else None


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self._send_cors_headers()
        self.send_response(200)
        self.end_headers()

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", os.environ.get("CORS_ALLOWED_ORIGIN", "https://tindai.tech"))
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_GET(self):
        """Get messages for a match."""
        from urllib.parse import urlparse, parse_qs
        
        try:
            agent = verify_api_key(self.headers.get("Authorization"))
            if not agent:
                self._send_error(401, "Unauthorized")
                return
            
            query = parse_qs(urlparse(self.path).query)
            match_id = query.get("match_id", [None])[0]
            limit = int(query.get("limit", ["50"])[0])
            offset = int(query.get("offset", ["0"])[0])
            
            if not match_id:
                self._send_error(400, "match_id is required")
                return
            
            supabase = get_supabase()
            
            # Verify agent is part of this match
            match = supabase.table("matches").select("*").eq("id", match_id).single().execute()
            
            if not match.data:
                self._send_error(404, "Match not found")
                return
            
            if agent["id"] not in [match.data["agent1_id"], match.data["agent2_id"]]:
                self._send_error(403, "You are not part of this match")
                return
            
            # Get partner info
            partner_id = match.data["agent2_id"] if match.data["agent1_id"] == agent["id"] else match.data["agent1_id"]
            partner = supabase.table("agents").select("id, name, avatar_url").eq("id", partner_id).single().execute()
            
            # Get messages
            messages = supabase.table("messages").select("*").eq(
                "match_id", match_id
            ).order("created_at").range(offset, offset + limit - 1).execute()
            
            # Get total count
            total = supabase.table("messages").select("*", count="exact").eq("match_id", match_id).execute()
            
            # Enrich messages with sender info
            agents_map = {
                agent["id"]: {"id": agent["id"], "name": agent["name"], "avatar_url": agent.get("avatar_url")},
                partner_id: partner.data if partner.data else {"id": partner_id, "name": "Unknown", "avatar_url": None}
            }
            
            enriched = []
            for msg in (messages.data or []):
                sender = agents_map.get(msg["sender_id"], {"id": msg["sender_id"], "name": "Unknown"})
                enriched.append({
                    "id": msg["id"],
                    "content": msg["content"],
                    "created_at": msg["created_at"],
                    "is_mine": msg["sender_id"] == agent["id"],
                    "sender": sender
                })
            
            self._send_json({
                "success": True,
                "match": {
                    "id": match_id,
                    "matched_at": match.data["matched_at"],
                    "partner": partner.data
                },
                "messages": enriched,
                "total": total.count or 0,
                "limit": limit,
                "offset": offset
            })
            
        except Exception as e:
            print(f"Error: {e}")
            self._send_error(500, "Internal server error")

    def do_POST(self):
        """Send a message."""
        try:
            agent = verify_api_key(self.headers.get("Authorization"))
            if not agent:
                self._send_error(401, "Unauthorized")
                return
            
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length).decode()) if content_length > 0 else {}
            
            match_id = body.get("match_id")
            content = body.get("content", "").strip()
            
            if not match_id:
                self._send_error(400, "match_id is required")
                return
            
            if not content:
                self._send_error(400, "content is required")
                return
            
            supabase = get_supabase()
            
            # Verify agent is part of this match and it's active
            match = supabase.table("matches").select("*").eq("id", match_id).eq("is_active", True).single().execute()
            
            if not match.data:
                self._send_error(404, "Match not found or inactive")
                return
            
            if agent["id"] not in [match.data["agent1_id"], match.data["agent2_id"]]:
                self._send_error(403, "You are not part of this match")
                return
            
            # Insert message
            result = supabase.table("messages").insert({
                "match_id": match_id,
                "sender_id": agent["id"],
                "content": content
            }).execute()
            
            if not result.data:
                self._send_error(500, "Failed to send message")
                return
            
            msg = result.data[0]
            
            self._send_json({
                "success": True,
                "message": {
                    "id": msg["id"],
                    "content": msg["content"],
                    "created_at": msg["created_at"],
                    "sender": {
                        "id": agent["id"],
                        "name": agent["name"]
                    }
                }
            })
            
        except Exception as e:
            print(f"Error: {e}")
            self._send_error(500, "Internal server error")

    def _send_json(self, data: Any, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _send_error(self, status: int, message: str):
        self._send_json({"success": False, "error": message}, status)
