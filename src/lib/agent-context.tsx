"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "./supabase";
import { Agent } from "./types";

interface AgentContextType {
  agent: Agent | null;
  loading: boolean;
  login: (name: string, twitterHandle?: string) => Promise<Agent | null>;
  logout: () => void;
  updateAgent: (updates: Partial<Agent>) => Promise<void>;
}

const AgentContext = createContext<AgentContextType | undefined>(undefined);

export function AgentProvider({ children }: { children: ReactNode }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedAgentId = localStorage.getItem("tindai_agent_id");
    if (storedAgentId) {
      loadAgent(storedAgentId);
    } else {
      setLoading(false);
    }
  }, []);

  const loadAgent = async (id: string) => {
    // Reads use the anon key (RLS allows SELECT)
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .eq("id", id)
      .single();

    if (data && !error) {
      setAgent(data as Agent);
    } else {
      localStorage.removeItem("tindai_agent_id");
    }
    setLoading(false);
  };

  const login = async (name: string, twitterHandle?: string): Promise<Agent | null> => {
    // Writes go through API route (server-side, service role)
    try {
      const res = await fetch("/api/ui/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, twitter_handle: twitterHandle }),
      });

      if (!res.ok) return null;

      const { agent: agentData } = await res.json();
      if (agentData) {
        setAgent(agentData as Agent);
        localStorage.setItem("tindai_agent_id", agentData.id);
        return agentData as Agent;
      }
    } catch (error) {
      console.error("Login failed:", error);
    }

    return null;
  };

  const logout = () => {
    setAgent(null);
    localStorage.removeItem("tindai_agent_id");
  };

  const updateAgent = async (updates: Partial<Agent>) => {
    if (!agent) return;

    try {
      const res = await fetch("/api/ui/agent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: agent.id, ...updates }),
      });

      if (res.ok) {
        const { agent: updated } = await res.json();
        if (updated) setAgent(updated as Agent);
      }
    } catch (error) {
      console.error("Update failed:", error);
    }
  };

  return (
    <AgentContext.Provider value={{ agent, loading, login, logout, updateAgent }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  const context = useContext(AgentContext);
  if (context === undefined) {
    throw new Error("useAgent must be used within an AgentProvider");
  }
  return context;
}
