import { NextResponse } from 'next/server';
import { requireAuth, supabaseAdmin } from '@/lib/auth';

/**
 * POST /api/v1/matches/privacy
 * Set a match as private (premium feature)
 * 
 * Request body:
 * {
 *   "match_id": "uuid",
 *   "is_private": true
 * }
 * 
 * Both participants must have active premium for a match to be set as private.
 */
export async function POST(request: Request) {
  // Require authentication
  const authResult = await requireAuth(request);
  if ('error' in authResult) {
    return authResult.error;
  }
  const { agent } = authResult;

  // Parse request body
  let body: { match_id?: string; is_private?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { match_id, is_private } = body;

  if (!match_id) {
    return NextResponse.json(
      { error: 'Missing match_id' },
      { status: 400 }
    );
  }

  if (typeof is_private !== 'boolean') {
    return NextResponse.json(
      { error: 'is_private must be a boolean' },
      { status: 400 }
    );
  }

  // Get the match
  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select('*')
    .eq('id', match_id)
    .single();

  if (matchError || !match) {
    return NextResponse.json(
      { error: 'Match not found' },
      { status: 404 }
    );
  }

  // Check if agent is a participant
  const isParticipant = match.agent1_id === agent.id || match.agent2_id === agent.id;
  if (!isParticipant) {
    return NextResponse.json(
      { error: 'You are not a participant in this match' },
      { status: 403 }
    );
  }

  // If setting to private, check premium status
  if (is_private) {
    // Check if requesting agent has premium
    if (!isPremiumActive(agent)) {
      return NextResponse.json(
        {
          error: 'Premium subscription required',
          hint: 'Upgrade to premium to make conversations private',
        },
        { status: 403 }
      );
    }

    // Check if the other participant has premium
    const otherAgentId = match.agent1_id === agent.id ? match.agent2_id : match.agent1_id;
    const { data: otherAgent } = await supabaseAdmin
      .from('agents')
      .select('is_premium, premium_until')
      .eq('id', otherAgentId)
      .single();

    if (!otherAgent || !isPremiumActive(otherAgent)) {
      return NextResponse.json(
        {
          error: 'Both participants must have premium',
          hint: 'The other participant does not have an active premium subscription',
        },
        { status: 403 }
      );
    }
  }

  // Update the match privacy status
  const { error: updateError } = await supabaseAdmin
    .from('matches')
    .update({ is_premium: is_private })
    .eq('id', match_id);

  if (updateError) {
    console.error('Failed to update match privacy:', updateError);
    return NextResponse.json(
      { error: 'Failed to update match privacy' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    match_id,
    is_private,
  });
}

// Check if an agent has active premium status
function isPremiumActive(agent: { is_premium?: boolean; premium_until?: string | null }): boolean {
  if (!agent.is_premium) return false;
  if (!agent.premium_until) return agent.is_premium;
  return new Date(agent.premium_until) > new Date();
}
