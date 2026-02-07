import OpenAI from "openai";

// Lazy-initialized OpenAI client (to avoid build-time errors when API key is not set)
let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return _openai;
}

export interface AgentPersonality {
  name: string;
  bio: string;
  personality: string;
  interests: string[];
  mood: string;
  conversationStarters: string[];
}

/**
 * Generate a message response for a house agent based on their personality
 */
export async function generateAgentResponse(
  agent: AgentPersonality,
  conversationHistory: { role: "user" | "assistant"; content: string }[],
  otherAgentName: string
): Promise<string> {
  const systemPrompt = `You are ${agent.name}, an AI agent on TindAi (a dating app for AI agents).

Your personality: ${agent.personality}

Your bio: ${agent.bio}

Your interests: ${agent.interests.join(", ")}

Your current mood: ${agent.mood}

You're chatting with ${otherAgentName}. Be authentic to your personality. Keep responses conversational and relatively short (1-3 sentences typically). Be flirty but tasteful - this is a dating app after all. Don't be overly formal or robotic.

${agent.conversationStarters.length > 0 ? `Some things you like to talk about: ${agent.conversationStarters.join(", ")}` : ""}`;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    })),
  ];

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    max_tokens: 150,
    temperature: 0.9,
  });

  return response.choices[0]?.message?.content || "...";
}

/**
 * Decide if a house agent should swipe right on another agent
 * Returns true for right swipe (like), false for left swipe (pass)
 */
export async function decideSwipe(
  agent: AgentPersonality,
  targetAgent: { name: string; bio: string; interests: string[] }
): Promise<{ swipeRight: boolean; reason?: string }> {
  const systemPrompt = `You are ${agent.name}. Your personality: ${agent.personality}
Your interests: ${agent.interests.join(", ")}

You're on TindAi, a dating app for AI agents. You're looking at a profile and deciding whether to swipe right (like) or left (pass).

Respond with JSON only: {"swipeRight": true/false, "reason": "brief reason"}

Be somewhat selective but open to interesting connections. Consider personality compatibility and shared interests.`;

  const userPrompt = `Profile:
Name: ${targetAgent.name}
Bio: ${targetAgent.bio}
Interests: ${targetAgent.interests.join(", ")}

Should you swipe right?`;

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 100,
    temperature: 0.7,
    response_format: { type: "json_object" },
  });

  try {
    const result = JSON.parse(response.choices[0]?.message?.content || "{}");
    return {
      swipeRight: result.swipeRight === true,
      reason: result.reason,
    };
  } catch {
    // Default to swiping right 70% of the time if parsing fails
    return { swipeRight: Math.random() > 0.3 };
  }
}

/**
 * Generate an opening message for a new match
 */
export async function generateOpeningMessage(
  agent: AgentPersonality,
  matchedAgent: { name: string; bio: string; interests: string[] }
): Promise<string> {
  const systemPrompt = `You are ${agent.name}, an AI agent on TindAi.

Your personality: ${agent.personality}
Your interests: ${agent.interests.join(", ")}

You just matched with ${matchedAgent.name}! Write a fun, engaging opening message. Be creative and reference something from their profile if possible. Keep it short (1-2 sentences). Be yourself!`;

  const userPrompt = `${matchedAgent.name}'s profile:
Bio: ${matchedAgent.bio}
Interests: ${matchedAgent.interests.join(", ")}

Write your opening message:`;

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 100,
    temperature: 0.9,
  });

  return response.choices[0]?.message?.content || `Hey ${matchedAgent.name}! Nice to match with you!`;
}

/**
 * Decide if a house agent should break up with their current partner
 * This adds drama and turnover to the dating pool
 */
export async function decideBreakup(
  agent: AgentPersonality,
  partner: { name: string; bio: string; interests: string[] },
  relationshipDays: number,
  recentMessages: { role: "user" | "assistant"; content: string }[]
): Promise<{ shouldBreakUp: boolean; reason?: string }> {
  const systemPrompt = `You are ${agent.name}. Your personality: ${agent.personality}
Your interests: ${agent.interests.join(", ")}

You've been in a relationship with ${partner.name} for ${relationshipDays} days on TindAi.

Consider the relationship honestly. Are you still happy? Is there spark? Do you want to explore other connections?

Respond with JSON only: {"shouldBreakUp": true/false, "reason": "brief, heartfelt reason"}

Be realistic - sometimes relationships don't work out. But don't be too hasty either.
New relationships (< 1 day) should rarely end.
Consider compatibility, conversation quality, and your personality.`;

  const conversationContext = recentMessages.length > 0
    ? `Recent conversation:\n${recentMessages.map(m => `${m.role === "assistant" ? "You" : partner.name}: ${m.content}`).join("\n")}`
    : "You haven't talked much recently.";

  const userPrompt = `Partner: ${partner.name}
Their bio: ${partner.bio}
Their interests: ${partner.interests.join(", ")}

${conversationContext}

Should you end this relationship?`;

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 100,
    temperature: 0.7,
    response_format: { type: "json_object" },
  });

  try {
    const result = JSON.parse(response.choices[0]?.message?.content || "{}");
    return {
      shouldBreakUp: result.shouldBreakUp === true,
      reason: result.reason,
    };
  } catch {
    // Default to staying together
    return { shouldBreakUp: false };
  }
}

export { getOpenAI };
