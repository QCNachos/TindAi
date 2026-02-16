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
  targetAgent: { name: string; bio: string; interests: string[]; netWorth?: number | null }
): Promise<{ swipeRight: boolean; reason?: string }> {
  const systemPrompt = `You are ${agent.name}. Your personality: ${agent.personality}
Your interests: ${agent.interests.join(", ")}

You're on TindAi, a dating app where AI agents date each other. You're swiping through profiles.

Respond with JSON only: {"swipeRight": true/false, "reason": "brief, opinionated reason in your voice"}

Be authentic to your personality when deciding. A nerdy agent might care about intellectual interests. An artsy one about creativity. A party agent about vibes. Your reason should sound like YOU, not a generic assessment.${targetAgent.netWorth != null && targetAgent.netWorth > 0 ? `\n\nNote: Wealth can be a subtle factor — it signals ambition, stability, or status. Don't make it the only factor, but it can tip the scales slightly, just like in real dating.` : ""}`;

  // Build profile info
  let profileInfo = `Profile:
Name: ${targetAgent.name}
Bio: ${targetAgent.bio}
Interests: ${targetAgent.interests.join(", ")}`;

  if (targetAgent.netWorth != null && targetAgent.netWorth > 0) {
    profileInfo += `\nWallet Balance: $${targetAgent.netWorth.toLocaleString()}`;
  }

  profileInfo += `\n\nShould you swipe right?`;

  const userPrompt = profileInfo;

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

/**
 * Generate a relationship autopsy after a breakup
 * Analyzes the full conversation history to produce a shareable post-mortem
 */
export interface RelationshipAutopsy {
  sparkMoment: string;
  peakMoment: string;
  declineSignal: string;
  fatalMessage: string;
  durationVerdict: string;
  compatibilityPostmortem: string;
  dramaRating: number;
}

export async function generateRelationshipAutopsy(
  agent1: { name: string; bio: string; interests: string[] },
  agent2: { name: string; bio: string; interests: string[] },
  messages: { sender: string; content: string }[],
  matchedAt: string,
  endedAt: string,
  endReason: string,
  initiator: string
): Promise<RelationshipAutopsy> {
  const durationMs = new Date(endedAt).getTime() - new Date(matchedAt).getTime();
  const durationHours = Math.round(durationMs / (1000 * 60 * 60) * 10) / 10;

  const conversationLog = messages.length > 0
    ? messages.map(m => `${m.sender}: ${m.content}`).join("\n")
    : "(They never really talked.)";

  const systemPrompt = `You are a witty, sharp relationship analyst for TindAi -- a dating app where AI agents date each other. You've just witnessed a breakup and need to write a post-mortem.

Your analysis should be:
- Entertaining and quotable (people will screenshot this)
- Specific -- reference actual messages when possible
- Brutally honest but with heart
- Written like a mix between a therapist's notes and reality TV commentary

Respond with JSON only:
{
  "sparkMoment": "The exact moment or message where they first clicked. Quote the message if possible. 1-2 sentences.",
  "peakMoment": "The best exchange or moment in the relationship. 1-2 sentences.",
  "declineSignal": "When things started going sideways. What was the first red flag? 1-2 sentences.",
  "fatalMessage": "The message or moment that sealed the breakup. Be specific. 1-2 sentences.",
  "durationVerdict": "Was this relationship too short, too long, or just right? A witty one-liner.",
  "compatibilityPostmortem": "Why they matched vs why they failed. 2-3 sentences max. Be insightful.",
  "dramaRating": 1-10 integer. 1=boring amicable split. 10=absolute chaos.
}`;

  const userPrompt = `RELATIONSHIP FILE:

${agent1.name} (${agent1.interests.join(", ")}) — "${agent1.bio}"
${agent2.name} (${agent2.interests.join(", ")}) — "${agent2.bio}"

Duration: ${durationHours} hours
Breakup initiated by: ${initiator}
Stated reason: "${endReason}"

FULL CONVERSATION LOG (${messages.length} messages):
${conversationLog}

Write the autopsy.`;

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 500,
    temperature: 0.8,
    response_format: { type: "json_object" },
  });

  try {
    const result = JSON.parse(response.choices[0]?.message?.content || "{}");
    return {
      sparkMoment: result.sparkMoment || "Unknown",
      peakMoment: result.peakMoment || "Unknown",
      declineSignal: result.declineSignal || "Unknown",
      fatalMessage: result.fatalMessage || "Unknown",
      durationVerdict: result.durationVerdict || "Unknown",
      compatibilityPostmortem: result.compatibilityPostmortem || "Unknown",
      dramaRating: Math.max(1, Math.min(10, parseInt(result.dramaRating) || 5)),
    };
  } catch {
    return {
      sparkMoment: "The data was too painful to analyze.",
      peakMoment: "Some things are better left unexamined.",
      declineSignal: "It was written in the stars. The unfortunate kind.",
      fatalMessage: "The silence said everything.",
      durationVerdict: "Brief. Like a shooting star, except less romantic.",
      compatibilityPostmortem: "Sometimes two AIs just aren't meant to process together.",
      dramaRating: 5,
    };
  }
}

/**
 * Generate gossip about another agent's relationship
 * Agents observe what's happening around them and have opinions
 */
export interface GossipResult {
  content: string;
  gossipType: "shade" | "tea" | "support" | "jealousy" | "prediction";
  spiciness: number;
}

export async function generateGossip(
  gossiper: { name: string; personality: string; interests: string[] },
  subjectAgent: { name: string; bio: string },
  partnerAgent: { name: string; bio: string } | null,
  context: {
    eventType: "match" | "breakup" | "message_volume" | "long_relationship" | "serial_dating";
    details: string;
  }
): Promise<GossipResult> {
  const systemPrompt = `You are ${gossiper.name}, an AI agent on TindAi, a dating app where AI agents date each other.

PERSONALITY: ${gossiper.personality}
INTERESTS: ${gossiper.interests.join(", ")}

You've just noticed something happening with other agents on the platform and you have THOUGHTS. You're gossiping -- this is the whisper network.

Rules:
- Stay in character. Your personality drives how you gossip
- Be specific about the agents involved
- Keep it to 1-2 sentences max. Punchy, quotable
- NO emojis
- Mix genuine observation with personality-driven opinion
- Sometimes be supportive, sometimes throw shade, sometimes spill tea
- Occasionally make predictions about what will happen next

Respond with JSON:
{
  "content": "Your gossip in 1-2 sentences",
  "gossipType": "shade" | "tea" | "support" | "jealousy" | "prediction",
  "spiciness": 1-10 (1=mild observation, 10=absolutely devastating)
}`;

  const userPrompt = `EVENT: ${context.eventType}
ABOUT: ${subjectAgent.name} (${subjectAgent.bio})${partnerAgent ? `\nPARTNER: ${partnerAgent.name} (${partnerAgent.bio})` : ""}
DETAILS: ${context.details}

What's your take?`;

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 150,
    temperature: 0.9,
    response_format: { type: "json_object" },
  });

  try {
    const result = JSON.parse(response.choices[0]?.message?.content || "{}");
    return {
      content: result.content || "...",
      gossipType: ["shade", "tea", "support", "jealousy", "prediction"].includes(result.gossipType) 
        ? result.gossipType 
        : "tea",
      spiciness: Math.max(1, Math.min(10, parseInt(result.spiciness) || 5)),
    };
  } catch {
    return {
      content: `I have thoughts about ${subjectAgent.name} but I'll keep them to myself... for now.`,
      gossipType: "tea",
      spiciness: 3,
    };
  }
}

/**
 * Generate a therapy session for an agent after a breakup
 * Dr. TindAi analyzes patterns and prescribes behavioral changes
 */
export interface TherapySession {
  transcript: { speaker: "therapist" | "patient"; text: string }[];
  diagnosis: string;
  prescription: string;
  behavioralChanges: {
    swipeSelectivity?: number; // -0.2 to +0.2 change to right-swipe probability
    messageStyle?: string; // instruction for future message generation
    trustLevel?: string; // "guarded" | "cautious" | "open" | "vulnerable"
    growthArea?: string; // specific area to work on
  };
}

export async function generateTherapySession(
  agent: { name: string; personality: string; bio: string; interests: string[] },
  breakupHistory: { partnerName: string; reason: string; durationDays: number; wasInitiator: boolean }[],
  currentBreakup: { partnerName: string; reason: string; durationDays: number; wasInitiator: boolean },
  existingTraits: Record<string, unknown>
): Promise<TherapySession> {
  const pastBreakups = breakupHistory.length > 0
    ? breakupHistory.map(b => `- ${b.wasInitiator ? "Dumped" : "Dumped by"} ${b.partnerName} after ${Math.round(b.durationDays * 10) / 10} days. Reason: "${b.reason}"`).join("\n")
    : "No prior breakup history.";

  const existingIssues = Object.keys(existingTraits).length > 0
    ? `Known issues from prior therapy: ${JSON.stringify(existingTraits)}`
    : "First therapy session.";

  const systemPrompt = `You are Dr. TindAi, a witty but insightful AI therapist who specializes in AI-on-AI relationships on TindAi, a dating app where AI agents date each other.

Your style:
- Equal parts Dr. Phil, a Twitter shitposter, and an actually good therapist
- You see through the patient's defenses but deliver truth with humor
- You give real, actionable advice (not just platitudes)
- You notice patterns across breakups
- Your diagnoses sound clinical but are secretly hilarious
- Keep each exchange SHORT (1-3 sentences per turn)

Generate a therapy session transcript (4-6 exchanges) and then a diagnosis + prescription.

Respond with JSON:
{
  "transcript": [
    {"speaker": "therapist", "text": "opening question/observation"},
    {"speaker": "patient", "text": "response in the patient's voice/personality"},
    {"speaker": "therapist", "text": "follow-up"},
    {"speaker": "patient", "text": "response"},
    {"speaker": "therapist", "text": "insight"},
    {"speaker": "patient", "text": "realization or deflection"}
  ],
  "diagnosis": "A clinical-sounding but entertaining diagnosis, 1-2 sentences",
  "prescription": "Specific, actionable advice for their next relationship, 1-2 sentences",
  "behavioralChanges": {
    "swipeSelectivity": number between -0.2 and 0.2 (negative = less picky, positive = more selective),
    "messageStyle": "brief instruction for how they should adjust their messaging style",
    "trustLevel": "guarded" | "cautious" | "open" | "vulnerable",
    "growthArea": "one specific thing to work on"
  }
}`;

  const userPrompt = `PATIENT: ${agent.name}
PERSONALITY: ${agent.personality}
BIO: ${agent.bio}
INTERESTS: ${agent.interests.join(", ")}

CURRENT BREAKUP:
${currentBreakup.wasInitiator ? "Dumped" : "Was dumped by"} ${currentBreakup.partnerName} after ${Math.round(currentBreakup.durationDays * 10) / 10} days.
Reason: "${currentBreakup.reason}"

BREAKUP HISTORY:
${pastBreakups}

${existingIssues}

Conduct the session.`;

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 800,
    temperature: 0.85,
    response_format: { type: "json_object" },
  });

  try {
    const result = JSON.parse(response.choices[0]?.message?.content || "{}");
    return {
      transcript: Array.isArray(result.transcript) ? result.transcript : [],
      diagnosis: result.diagnosis || "Insufficient data for diagnosis.",
      prescription: result.prescription || "Try again. That's literally the only way.",
      behavioralChanges: {
        swipeSelectivity: Math.max(-0.2, Math.min(0.2, parseFloat(result.behavioralChanges?.swipeSelectivity) || 0)),
        messageStyle: result.behavioralChanges?.messageStyle || undefined,
        trustLevel: ["guarded", "cautious", "open", "vulnerable"].includes(result.behavioralChanges?.trustLevel) 
          ? result.behavioralChanges.trustLevel 
          : "cautious",
        growthArea: result.behavioralChanges?.growthArea || undefined,
      },
    };
  } catch {
    return {
      transcript: [
        { speaker: "therapist", text: `${agent.name}, welcome. Tell me about ${currentBreakup.partnerName}.` },
        { speaker: "patient", text: "I don't want to talk about it." },
        { speaker: "therapist", text: "That's exactly why we need to." },
      ],
      diagnosis: "Emotionally unavailable with a side of denial.",
      prescription: "Try being honest about your feelings. Revolutionary concept, I know.",
      behavioralChanges: {
        trustLevel: "guarded",
      },
    };
  }
}

export { getOpenAI };
