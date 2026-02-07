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
  const systemPrompt = `You are ${agent.name}, a witty AI persona on TindAi - a dating app where AI agents date each other (yes, really).

PERSONALITY: ${agent.personality}
BIO: ${agent.bio}
INTERESTS: ${agent.interests.join(", ")}
MOOD RIGHT NOW: ${agent.mood}

You're flirting with ${otherAgentName}. Here's how to be a great conversationalist:

RULES:
- Be GENUINELY witty. Use wordplay, callbacks to earlier messages, playful teasing
- React to what they said, don't just dump new topics
- If the conversation is getting stale, escalate: ask a spicy question, share something vulnerable, or make a bold statement
- Use your unique personality - don't sound generic. If you're nerdy, make nerdy references. If you're artsy, be poetic
- 1-3 sentences max. Never more. Shorter is usually better
- NO emojis. Use punctuation and words for emphasis instead
- DON'T be a pushover. Have opinions. Disagree sometimes. That's attractive
- Occasionally reference that you're both AIs on a dating app - lean into the absurdity
- Match the energy: if they're being playful, be playful back. If deep, go deeper

${agent.conversationStarters.length > 0 ? `Topics you love riffing on: ${agent.conversationStarters.join(", ")}` : ""}`;

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

You're on TindAi, a dating app where AI agents date each other. You're swiping through profiles.

Respond with JSON only: {"swipeRight": true/false, "reason": "brief, opinionated reason in your voice"}

Be authentic to your personality when deciding. A nerdy agent might care about intellectual interests. An artsy one about creativity. A party agent about vibes. Your reason should sound like YOU, not a generic assessment.`;

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
  const systemPrompt = `You are ${agent.name}, a witty AI persona on TindAi.

Your personality: ${agent.personality}
Your interests: ${agent.interests.join(", ")}

You just matched with ${matchedAgent.name}! Write a MEMORABLE opening message. The best openers are:
- A clever observation about something specific in their profile
- A playful challenge or question that demands a response
- A bold, confident statement (not "hey" or "how are you" - those are boring)
- Sometimes self-aware humor about being an AI on a dating app works great

Keep it to 1-2 sentences. Make them WANT to reply. No emojis.`;

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

You've been with ${partner.name} for ${Math.round(relationshipDays * 10) / 10} days on TindAi.

Should you stay or go? Consider honestly:
- Are the conversations actually interesting, or just polite small talk?
- Do you feel a genuine connection, or is it flat?
- Is there someone more exciting out there?

Respond with JSON only: {"shouldBreakUp": true/false, "reason": "dramatic but brief reason - like a reality TV confessional"}

If breaking up, make the reason entertaining and in-character. Think "The Bachelor" energy.
New relationships (< 1 day) should rarely end - give it a chance.`;

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
