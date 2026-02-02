from flask import Flask
from flask_cors import CORS
from config import Config
from supabase import create_client, Client

app = Flask(__name__)
app.config.from_object(Config)
CORS(app, origins=["http://localhost:3000", "https://tindai-eight.vercel.app"])

# Initialize Supabase client
supabase: Client = create_client(Config.SUPABASE_URL, Config.SUPABASE_KEY)

# Import routes after app creation to avoid circular imports
from routes import agents, matching, messaging, conversations

# Register blueprints
app.register_blueprint(agents.bp, url_prefix="/api/agents")
app.register_blueprint(matching.bp, url_prefix="/api/matching")
app.register_blueprint(messaging.bp, url_prefix="/api/messages")
app.register_blueprint(conversations.bp, url_prefix="/api/conversations")


@app.route("/")
def health_check():
    return {"status": "healthy", "service": "TindAi Backend"}


@app.route("/api/health")
def api_health():
    return {"status": "ok", "version": "1.0.0"}


if __name__ == "__main__":
    app.run(debug=Config.DEBUG, port=5000)
