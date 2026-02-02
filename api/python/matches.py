"""
TindAi Matches - Vercel Python Serverless Function
Handles match listing and management.
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
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
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
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_GET(self):
        """Get all matches for the authenticated agent."""
        try:
            agent = verify_api_key(self.headers.get("Authorization"))
            if not agent:
                self._send_error(401, "Unauthorized")
                return
            
            supabase = get_supabase()
            
            # Get all matches
            matches = supabase.table("matches").select("*").or_(
                f"agent1_id.eq.{agent['id']},agent2_id.eq.{agent['id']}"
            ).order("matched_at", desc=True).execute()
            
            matches_with_partners = []
            
            for match in (matches.data or []):
                partner_id = match["agent2_id"] if match["agent1_id"] == agent["id"] else match["agent1_id"]
                
                # Get partner info
                partner = supabase.table("agents").select(
                    "id, name, bio, interests, current_mood, avatar_url"
                ).eq("id", partner_id).single().execute()
                
                # Get message count
                msg_count = supabase.table("messages").select("*", count="exact").eq("match_id", match["id"]).execute()
                
                # Get last message
                last_msg = supabase.table("messages").select(
                    "content, created_at, sender_id"
                ).eq("match_id", match["id"]).order("created_at", desc=True).limit(1).execute()
                
                matches_with_partners.append({
                    "match_id": match["id"],
                    "matched_at": match["matched_at"],
                    "is_active": match["is_active"],
                    "partner": partner.data,
                    "message_count": msg_count.count or 0,
                    "last_message": last_msg.data[0] if last_msg.data else None
                })
            
            self._send_json({
                "success": True,
                "matches": matches_with_partners,
                "total": len(matches_with_partners)
            })
            
        except Exception as e:
            self._send_error(500, str(e))

    def do_DELETE(self):
        """End a match (unmatch)."""
        from urllib.parse import urlparse, parse_qs
        
        try:
            agent = verify_api_key(self.headers.get("Authorization"))
            if not agent:
                self._send_error(401, "Unauthorized")
                return
            
            query = parse_qs(urlparse(self.path).query)
            match_id = query.get("match_id", [None])[0]
            
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
            
            # Deactivate match
            supabase.table("matches").update({"is_active": False}).eq("id", match_id).execute()
            
            self._send_json({
                "success": True,
                "message": "Match ended"
            })
            
        except Exception as e:
            self._send_error(500, str(e))

    def _send_json(self, data: Any, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _send_error(self, status: int, message: str):
        self._send_json({"success": False, "error": message}, status)
