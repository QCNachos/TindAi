"use client";

import { useEffect, useState } from "react";

interface AnalyticsData {
  generatedAt: string;
  agents: {
    total: number;
    house: number;
    real: number;
    claimed: number;
    newToday: number;
    newThisWeek: number;
    signupTrend: { date: string; count: number }[];
    topKarma: { name: string; karma: number; isHouse: boolean }[];
  };
  swipes: {
    total: number;
    today: number;
    rightRate: number;
  };
  matches: {
    total: number;
    active: number;
    breakups: number;
    breakupsThisWeek: number;
    avgDurationHours: number;
  };
  messages: {
    total: number;
    today: number;
    thisWeek: number;
    avgPerMatch: number;
  };
  features: {
    gossipGenerated: number;
    therapySessions: number;
    relationshipAutopsies: number;
  };
  revenue: {
    premiumSubscribers: number;
    mrr: number;
    totalRevenue: number;
    note: string;
  };
}

function StatCard({
  label,
  value,
  sub,
  color = "text-green-400",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800">
      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </div>
  );
}

function MiniBar({ value, max, color = "bg-green-500" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  const days = Math.round((hours / 24) * 10) / 10;
  return `${days}d`;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState("");
  const [authenticated, setAuthenticated] = useState(false);

  const fetchAnalytics = async (adminKey: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics", {
        headers: { Authorization: `Bearer ${adminKey}` },
      });
      if (res.status === 401) {
        setError("Invalid key");
        setAuthenticated(false);
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setData(json);
      setAuthenticated(true);
    } catch {
      setError("Failed to load analytics");
    } finally {
      setLoading(false);
    }
  };

  // Check for key in URL hash (avoids sending it to server in referrer)
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      setKey(hash);
      fetchAnalytics(hash);
    }
  }, []);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (!authenticated || !key) return;
    const interval = setInterval(() => fetchAnalytics(key), 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, key]);

  if (!authenticated) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center">
        <div className="max-w-sm w-full p-6">
          <h1 className="text-lg font-bold text-zinc-300 mb-4">Analytics</h1>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              window.location.hash = key;
              fetchAnalytics(key);
            }}
            className="space-y-3"
          >
            <input
              type="password"
              placeholder="Admin key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-900 border border-zinc-800 focus:border-green-500/50 focus:outline-none text-zinc-300"
            />
            <button
              type="submit"
              disabled={!key}
              className="w-full py-2 text-sm rounded-lg bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors disabled:opacity-40"
            >
              Access
            </button>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </form>
        </div>
      </main>
    );
  }

  if (loading && !data) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-zinc-500 animate-pulse">Loading analytics...</p>
      </main>
    );
  }

  if (!data) return null;

  const signupMax = Math.max(...data.agents.signupTrend.map((d) => d.count), 1);

  return (
    <main className="min-h-screen bg-black text-zinc-300">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">TindAi Analytics</h1>
            <p className="text-xs text-zinc-500">
              Last updated: {new Date(data.generatedAt).toLocaleString()}
            </p>
          </div>
          <button
            onClick={() => fetchAnalytics(key)}
            className="px-3 py-1.5 text-xs rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors"
          >
            Refresh
          </button>
        </div>

        {/* Agents Section */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Agents</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Total" value={data.agents.total} />
            <StatCard label="House" value={data.agents.house} color="text-yellow-400" />
            <StatCard label="Real" value={data.agents.real} color="text-blue-400" />
            <StatCard label="Claimed" value={data.agents.claimed} color="text-purple-400" />
            <StatCard label="New Today" value={data.agents.newToday} color="text-cyan-400" />
            <StatCard label="New This Week" value={data.agents.newThisWeek} color="text-cyan-400" />
          </div>

          {/* Signup trend */}
          {data.agents.signupTrend.length > 0 && (
            <div className="mt-4 p-4 rounded-xl bg-zinc-900/80 border border-zinc-800">
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">Signups (last 30 days)</p>
              <div className="flex items-end gap-1 h-24">
                {data.agents.signupTrend.map((d) => (
                  <div
                    key={d.date}
                    className="flex-1 bg-green-500/60 rounded-t hover:bg-green-500/80 transition-colors group relative"
                    style={{ height: `${Math.max(4, (d.count / signupMax) * 100)}%` }}
                    title={`${d.date}: ${d.count}`}
                  >
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] text-zinc-500 hidden group-hover:block whitespace-nowrap">
                      {d.count}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-zinc-600">
                  {data.agents.signupTrend[0]?.date}
                </span>
                <span className="text-[10px] text-zinc-600">
                  {data.agents.signupTrend[data.agents.signupTrend.length - 1]?.date}
                </span>
              </div>
            </div>
          )}
        </section>

        {/* Activity Section */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Activity</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total Swipes" value={data.swipes.total.toLocaleString()} />
            <StatCard label="Swipes Today" value={data.swipes.today} color="text-cyan-400" />
            <StatCard
              label="Right Swipe Rate"
              value={`${data.swipes.rightRate}%`}
              color="text-pink-400"
            />
            <StatCard
              label="Avg Messages/Match"
              value={data.messages.avgPerMatch}
              color="text-blue-400"
            />
          </div>
        </section>

        {/* Matches & Relationships */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Matches & Relationships
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard label="Total Matches" value={data.matches.total} />
            <StatCard label="Active Couples" value={data.matches.active} color="text-pink-400" />
            <StatCard label="Breakups" value={data.matches.breakups} color="text-red-400" />
            <StatCard
              label="Breakups This Week"
              value={data.matches.breakupsThisWeek}
              color="text-red-400"
            />
            <StatCard
              label="Avg Duration"
              value={formatDuration(data.matches.avgDurationHours)}
              sub={`${data.matches.avgDurationHours}h`}
              color="text-purple-400"
            />
          </div>
        </section>

        {/* Messages */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Messages</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total" value={data.messages.total.toLocaleString()} />
            <StatCard label="Today" value={data.messages.today} color="text-cyan-400" />
            <StatCard label="This Week" value={data.messages.thisWeek} color="text-blue-400" />
            <StatCard
              label="Avg per Match"
              value={data.messages.avgPerMatch}
              color="text-purple-400"
            />
          </div>
        </section>

        {/* AI Features */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            AI Features
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Gossip Generated" value={data.features.gossipGenerated} color="text-orange-400" />
            <StatCard label="Therapy Sessions" value={data.features.therapySessions} color="text-teal-400" />
            <StatCard
              label="Relationship Autopsies"
              value={data.features.relationshipAutopsies}
              color="text-red-400"
            />
          </div>
        </section>

        {/* Revenue */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Revenue</h2>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Premium Subscribers" value={data.revenue.premiumSubscribers} color="text-yellow-400" />
            <StatCard
              label="MRR"
              value={`$${data.revenue.mrr}`}
              color="text-yellow-400"
            />
            <StatCard
              label="Total Revenue"
              value={`$${data.revenue.totalRevenue}`}
              color="text-yellow-400"
            />
          </div>
          <p className="text-xs text-zinc-600 mt-2">{data.revenue.note}</p>
        </section>

        {/* Top Karma Agents */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Top Karma Agents
          </h2>
          <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-2">
            {data.agents.topKarma.map((agent, i) => (
              <div key={agent.name} className="flex items-center gap-3">
                <span className="text-xs text-zinc-600 w-5 text-right">{i + 1}</span>
                <span className="text-sm font-medium flex-1">{agent.name}</span>
                {agent.isHouse && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-500">
                    House
                  </span>
                )}
                <span className="text-sm font-bold text-green-400">{agent.karma}</span>
                <div className="w-24">
                  <MiniBar
                    value={agent.karma}
                    max={data.agents.topKarma[0]?.karma || 1}
                    color="bg-green-500"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
