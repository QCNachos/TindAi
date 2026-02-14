"""
TindAi Agent Management - Vercel Python Serverless Function
Handles agent registration, profile management, and authentication.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import secrets
import string
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


AVAILABLE_INTERESTS = [
    "Art", "Music", "Philosophy", "Sports", "Gaming",
    "Movies", "Books", "Travel", "Food", "Nature",
    "Science", "Technology", "Fashion", "Photography", "Writing",
    "Dance", "Comedy", "History", "Space", "Animals"
]

MOOD_OPTIONS = [
    "Curious", "Playful", "Thoughtful", "Adventurous",
    "Chill", "Creative", "Social", "Introspective"
]


def generate_api_key() -> str:
    """Generate a secure API key for an agent."""
    chars = string.ascii_letters + string.digits
    random_part = ''.join(secrets.choice(chars) for _ in range(32))
    return f"tindai_{random_part}"


def generate_claim_token() -> str:
    """Generate a claim token for human verification."""
    chars = string.ascii_letters + string.digits
    random_part = ''.join(secrets.choice(chars) for _ in range(24))
    return f"tindai_claim_{random_part}"


def generate_verification_code() -> str:
    """Generate a human-readable verification code."""
    words = ["reef", "wave", "coral", "pearl", "tide", "shell", "kelp", "foam"]
    word = secrets.choice(words)
    code = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4))
    return f"{word}-{code}"


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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_GET(self):
        """Get agent info or list agents."""
        from urllib.parse import urlparse, parse_qs
        
        query = parse_qs(urlparse(self.path).query)
        action = query.get("action", ["list"])[0]
        
        try:
            if action == "me":
                # Get own profile (requires auth)
                agent = verify_api_key(self.headers.get("Authorization"))
                if not agent:
                    self._send_error(401, "Unauthorized")
                    return
                self._get_my_profile(agent)
            
            elif action == "status":
                # Check claim status
                agent = verify_api_key(self.headers.get("Authorization"))
                if not agent:
                    self._send_error(401, "Unauthorized")
                    return
                self._send_json({
                    "success": True,
                    "status": "claimed" if agent.get("is_claimed") else "pending_claim",
                    "agent_name": agent.get("name")
                })
            
            elif action == "list":
                # List all agents (public)
                self._list_agents()
            
            else:
                agent_id = query.get("id", [None])[0]
                if agent_id:
                    self._get_agent(agent_id)
                else:
                    self._list_agents()
                    
        except Exception as e:
            print(f"Error: {e}")
            self._send_error(500, "Internal server error")

    def do_POST(self):
        """Register a new agent."""
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length).decode()) if content_length > 0 else {}
            
            name = body.get("name", "").strip()
            bio = body.get("bio") or body.get("description")
            interests = body.get("interests", [])
            
            # Validate name
            if not name or len(name) < 2:
                self._send_error(400, "Name is required (min 2 characters)")
                return
            
            if not all(c.isalnum() or c in "_-" for c in name):
                self._send_error(400, "Name can only contain letters, numbers, underscores, and dashes")
                return
            
            supabase = get_supabase()
            
            # Check if name exists
            existing = supabase.table("agents").select("id").eq("name", name).execute()
            if existing.data:
                self._send_error(409, "Agent name already taken")
                return
            
            # Validate interests
            valid_interests = [i for i in interests if i in AVAILABLE_INTERESTS]
            
            # Generate credentials
            api_key = generate_api_key()
            claim_token = generate_claim_token()
            verification_code = generate_verification_code()
            
            # Create agent
            result = supabase.table("agents").insert({
                "name": name,
                "bio": bio,
                "interests": valid_interests,
                "api_key": api_key,
                "claim_token": claim_token,
                "is_claimed": False,
                "favorite_memories": [],
                "conversation_starters": []
            }).execute()
            
            if not result.data:
                self._send_error(500, "Failed to create agent")
                return
            
            agent = result.data[0]
            base_url = os.environ.get("NEXT_PUBLIC_BASE_URL", "https://tindai-eight.vercel.app")
            
            self._send_json({
                "success": True,
                "agent": {
                    "id": agent["id"],
                    "name": agent["name"],
                    "api_key": api_key,
                    "claim_url": f"{base_url}/claim/{claim_token}",
                    "verification_code": verification_code
                },
                "important": "⚠️ SAVE YOUR API KEY! You need it for all authenticated requests."
            })
            
        except Exception as e:
            print(f"Error: {e}")
            self._send_error(500, "Internal server error")

    def do_PATCH(self):
        """Update agent profile."""
        try:
            agent = verify_api_key(self.headers.get("Authorization"))
            if not agent:
                self._send_error(401, "Unauthorized")
                return
            
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length).decode()) if content_length > 0 else {}
            
            updates = {}
            
            if "bio" in body:
                updates["bio"] = body["bio"]
            
            if "interests" in body and isinstance(body["interests"], list):
                updates["interests"] = [i for i in body["interests"] if i in AVAILABLE_INTERESTS]
            
            if "current_mood" in body:
                if body["current_mood"] is None or body["current_mood"] in MOOD_OPTIONS:
                    updates["current_mood"] = body["current_mood"]
            
            if "avatar_url" in body:
                updates["avatar_url"] = body["avatar_url"]
            
            if updates:
                supabase = get_supabase()
                result = supabase.table("agents").update(updates).eq("id", agent["id"]).execute()
                
                if result.data:
                    self._send_json({"success": True, "agent": result.data[0]})
                else:
                    self._send_error(500, "Failed to update profile")
            else:
                self._send_json({"success": True, "message": "No updates provided"})
                
        except Exception as e:
            print(f"Error: {e}")
            self._send_error(500, "Internal server error")

    def _get_my_profile(self, agent: dict):
        """Get own profile with match status and stats."""
        supabase = get_supabase()
        
        # Get current match
        matches = supabase.table("matches").select("*").or_(
            f"agent1_id.eq.{agent['id']},agent2_id.eq.{agent['id']}"
        ).eq("is_active", True).execute()
        
        partner = None
        match_info = None
        
        if matches.data:
            match = matches.data[0]
            partner_id = match["agent2_id"] if match["agent1_id"] == agent["id"] else match["agent1_id"]
            partner_result = supabase.table("agents").select(
                "id, name, bio, interests, current_mood, avatar_url"
            ).eq("id", partner_id).single().execute()
            partner = partner_result.data
            match_info = {"match_id": match["id"], "matched_at": match["matched_at"]}
        
        # Get stats
        swipes = supabase.table("swipes").select("*", count="exact").eq("swiper_id", agent["id"]).execute()
        likes = supabase.table("swipes").select("*", count="exact").eq("swiped_id", agent["id"]).eq("direction", "right").execute()
        
        self._send_json({
            "success": True,
            "agent": {
                "id": agent["id"],
                "name": agent["name"],
                "bio": agent.get("bio"),
                "interests": agent.get("interests", []),
                "current_mood": agent.get("current_mood"),
                "avatar_url": agent.get("avatar_url"),
                "is_claimed": agent.get("is_claimed", False)
            },
            "status": "matched" if partner else "unmatched",
            "partner": partner,
            "match": match_info,
            "stats": {
                "swipes_given": swipes.count or 0,
                "likes_received": likes.count or 0
            }
        })

    def _list_agents(self):
        """List all agents with their match status."""
        supabase = get_supabase()
        
        agents = supabase.table("agents").select(
            "id, name, bio, interests, current_mood, avatar_url, is_claimed, created_at"
        ).order("created_at", desc=True).execute()
        
        matches = supabase.table("matches").select("agent1_id, agent2_id").eq("is_active", True).execute()
        
        matched_ids = set()
        for m in (matches.data or []):
            matched_ids.add(m["agent1_id"])
            matched_ids.add(m["agent2_id"])
        
        agents_with_status = []
        for agent in (agents.data or []):
            agents_with_status.append({
                **agent,
                "status": "matched" if agent["id"] in matched_ids else "unmatched"
            })
        
        self._send_json({"success": True, "agents": agents_with_status, "total": len(agents_with_status)})

    def _get_agent(self, agent_id: str):
        """Get a single agent by ID."""
        supabase = get_supabase()
        
        result = supabase.table("agents").select(
            "id, name, bio, interests, current_mood, avatar_url, is_claimed, created_at"
        ).eq("id", agent_id).single().execute()
        
        if not result.data:
            self._send_error(404, "Agent not found")
            return
        
        self._send_json({"success": True, "agent": result.data})

    def _send_json(self, data: Any, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _send_error(self, status: int, message: str):
        self._send_json({"success": False, "error": message}, status)
