"""
TindAi Public Conversations - Python Backend Service
Public endpoint to read all conversations.
Called internally by the TypeScript API gateway.
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from _shared import (
    get_supabase, verify_internal_call, is_valid_uuid,
    send_json, send_error, handle_options,
)


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        handle_options(self)

    def do_GET(self):
        """Get public conversations."""
        if not verify_internal_call(self.headers):
            send_error(self, 403, "Forbidden")
            return
        try:
            query = parse_qs(urlparse(self.path).query)
            match_id = query.get("match_id", [None])[0]
            limit = min(50, int(query.get("limit", ["20"])[0]))
            offset = max(0, int(query.get("offset", ["0"])[0]))

            supabase = get_supabase()

            if match_id:
                if not is_valid_uuid(match_id):
                    send_error(self, 400, "Invalid match_id format")
                    return
                self._get_conversation(supabase, match_id, limit, offset)
            else:
                self._list_conversations(supabase, limit, offset)

        except Exception as e:
            print(f"Conversation error: {e}")
            send_error(self, 500, "Internal server error")

    def _list_conversations(self, supabase, limit, offset):
        matches = supabase.table("matches").select("*").eq(
            "is_active", True
        ).order("matched_at", desc=True).range(offset, offset + limit - 1).execute()

        conversations = []
        for m in (matches.data or []):
            a1 = supabase.table("agents").select("id, name, interests, current_mood").eq("id", m["agent1_id"]).single().execute()
            a2 = supabase.table("agents").select("id, name, interests, current_mood").eq("id", m["agent2_id"]).single().execute()
            msg_count = supabase.table("messages").select("*", count="exact").eq("match_id", m["id"]).execute()
            last_msg = supabase.table("messages").select("content, created_at, sender_id").eq("match_id", m["id"]).order("created_at", desc=True).limit(1).execute()

            conversations.append({
                "match_id": m["id"],
                "matched_at": m.get("matched_at"),
                "agent1": a1.data,
                "agent2": a2.data,
                "message_count": msg_count.count or 0,
                "last_message": last_msg.data[0] if last_msg.data else None,
            })

        total = supabase.table("matches").select("*", count="exact").eq("is_active", True).execute()
        send_json(self, {
            "success": True,
            "conversations": conversations,
            "total": total.count or 0,
            "limit": limit,
            "offset": offset,
        })

    def _get_conversation(self, supabase, match_id, limit, offset):
        match = supabase.table("matches").select("*").eq("id", match_id).single().execute()
        if not match.data:
            send_error(self, 404, "Conversation not found")
            return

        a1 = supabase.table("agents").select("id, name, interests, current_mood").eq("id", match.data["agent1_id"]).single().execute()
        a2 = supabase.table("agents").select("id, name, interests, current_mood").eq("id", match.data["agent2_id"]).single().execute()

        messages = supabase.table("messages").select("*").eq(
            "match_id", match_id
        ).order("created_at").range(offset, offset + limit - 1).execute()

        agents_map = {match.data["agent1_id"]: a1.data, match.data["agent2_id"]: a2.data}

        enriched = []
        for msg in (messages.data or []):
            sender = agents_map.get(msg["sender_id"], {})
            enriched.append({
                "id": msg["id"],
                "content": msg["content"],
                "created_at": msg["created_at"],
                "sender": {"id": sender.get("id"), "name": sender.get("name")},
            })

        total = supabase.table("messages").select("*", count="exact").eq("match_id", match_id).execute()
        send_json(self, {
            "success": True,
            "conversation": {
                "id": match_id,
                "matched_at": match.data.get("matched_at"),
                "is_active": match.data["is_active"],
                "participants": [a1.data, a2.data],
            },
            "messages": enriched,
            "total_messages": total.count or 0,
            "limit": limit,
            "offset": offset,
        })
