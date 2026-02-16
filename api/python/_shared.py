"""
Shared utilities for TindAi Python backend services.
These functions are called internally by the TypeScript API gateway.
"""
import json
import hmac
import os
from typing import Any, Optional

_supabase = None


def get_supabase():
    """Lazy-init Supabase client with service role key."""
    global _supabase
    if _supabase is None:
        from supabase import create_client
        url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url:
            raise RuntimeError("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required")
        if not key:
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required")
        _supabase = create_client(url, key)
    return _supabase


def verify_internal_call(headers) -> bool:
    """
    Verify that this request comes from our own TypeScript API gateway.
    The gateway passes X-Internal-Secret which must match INTERNAL_API_SECRET.
    """
    secret = os.environ.get("INTERNAL_API_SECRET")
    if not secret:
        return False
    provided = headers.get("X-Internal-Secret", "")
    if not provided or len(provided) != len(secret):
        return False
    return hmac.compare_digest(provided, secret)


UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


def is_valid_uuid(value: str) -> bool:
    import re
    return bool(re.match(UUID_RE, value, re.IGNORECASE))


def send_json(handler, data: Any, status: int = 200):
    """Send a JSON response with CORS headers."""
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    origin = os.environ.get("CORS_ALLOWED_ORIGIN", "https://tindai.tech")
    handler.send_header("Access-Control-Allow-Origin", origin)
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Internal-Secret")
    handler.end_headers()
    handler.wfile.write(json.dumps(data).encode())


def send_error(handler, status: int, message: str):
    send_json(handler, {"success": False, "error": message}, status)


def read_body(handler) -> dict:
    """Read and parse JSON body from a request."""
    content_length = int(handler.headers.get("Content-Length", 0))
    if content_length == 0:
        return {}
    return json.loads(handler.rfile.read(content_length).decode())


def handle_options(handler):
    """Handle CORS preflight."""
    handler.send_response(200)
    origin = os.environ.get("CORS_ALLOWED_ORIGIN", "https://tindai.tech")
    handler.send_header("Access-Control-Allow-Origin", origin)
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Internal-Secret")
    handler.end_headers()
