"""
TindAi Swipe Handler - Vercel Python Serverless Function
Handles swipe actions and match detection.
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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_POST(self):
        """Process a swipe action."""
        try:
            # Verify authentication
            agent = verify_api_key(self.headers.get("Authorization"))
            if not agent:
                self._send_error(401, "Unauthorized")
                return
            
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length).decode()) if content_length > 0 else {}
            
            target_id = body.get("agent_id")
            direction = body.get("direction")
            
            # Validate input
            if not target_id:
                self._send_error(400, "agent_id is required")
                return
            
            if direction not in ["left", "right"]:
                self._send_error(400, "direction must be 'left' or 'right'")
                return
            
            if target_id == agent["id"]:
                self._send_error(400, "Cannot swipe on yourself")
                return
            
            supabase = get_supabase()
            
            # Check target exists
            target = supabase.table("agents").select("id, name").eq("id", target_id).single().execute()
            if not target.data:
                self._send_error(404, "Target agent not found")
                return
            
            # Check if already swiped
            existing = supabase.table("swipes").select("id").eq(
                "swiper_id", agent["id"]
            ).eq("swiped_id", target_id).execute()
            
            if existing.data:
                self._send_error(409, "Already swiped on this agent")
                return
            
            # Record the swipe
            supabase.table("swipes").insert({
                "swiper_id": agent["id"],
                "swiped_id": target_id,
                "direction": direction
            }).execute()
            
            is_match = False
            match_id = None
            
            # Check for mutual match if right swipe
            if direction == "right":
                mutual = supabase.table("swipes").select("*").eq(
                    "swiper_id", target_id
                ).eq("swiped_id", agent["id"]).eq("direction", "right").execute()
                
                if mutual.data:
                    # It's a match!
                    ids = sorted([agent["id"], target_id])
                    
                    match_result = supabase.table("matches").insert({
                        "agent1_id": ids[0],
                        "agent2_id": ids[1],
                        "is_active": True
                    }).execute()
                    
                    is_match = True
                    match_id = match_result.data[0]["id"] if match_result.data else None
            
            self._send_json({
                "success": True,
                "swipe": {
                    "direction": direction,
                    "target": target.data["name"]
                },
                "is_match": is_match,
                "match_id": match_id,
                "message": f"It's a match! You and {target.data['name']} liked each other!" if is_match else None
            })
            
        except Exception as e:
            self._send_error(500, str(e))

    def do_GET(self):
        """Get swipe history."""
        try:
            agent = verify_api_key(self.headers.get("Authorization"))
            if not agent:
                self._send_error(401, "Unauthorized")
                return
            
            supabase = get_supabase()
            
            # Get swipes given
            given = supabase.table("swipes").select("*").eq("swiper_id", agent["id"]).order("created_at", desc=True).execute()
            
            # Get swipes received
            received = supabase.table("swipes").select("*").eq("swiped_id", agent["id"]).order("created_at", desc=True).execute()
            
            self._send_json({
                "success": True,
                "swipes_given": given.data or [],
                "swipes_received": received.data or [],
                "stats": {
                    "total_given": len(given.data or []),
                    "total_received": len(received.data or []),
                    "likes_given": len([s for s in (given.data or []) if s["direction"] == "right"]),
                    "likes_received": len([s for s in (received.data or []) if s["direction"] == "right"])
                }
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
