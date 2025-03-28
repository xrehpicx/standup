'use server';

import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  meeting,
  meetingOutcome,
  meetingParticipant,
  workspaceUser,
  meetingRecording,
} from '@/lib/db/schema';
import { eq, and, isNotNull, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { generateOutcome } from './ai/generate';
import { user } from '../db/auth-schema';

// Create a meeting outcome
export async function createMeetingOutcome({
  meetingId,
  type,
  content,
  meta,
}: {
  meetingId: string;
  type: string;
  content: string;
  meta?: string;
}) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return { error: 'Unauthorized' };
    }

    const userId = session.user.id;

    // Get the meeting
    const meetingData = await db.query.meeting.findFirst({
      where: eq(meeting.id, meetingId),
    });

    if (!meetingData) {
      return { error: 'Meeting not found' };
    }

    // Check if user has access to this workspace
    const userWorkspace = await db.query.workspaceUser.findFirst({
      where: and(
        eq(workspaceUser.workspaceId, meetingData.workspaceId),
        eq(workspaceUser.userId, userId)
      ),
    });

    if (!userWorkspace) {
      return { error: "You don't have access to this meeting" };
    }

    // Check if user can edit this meeting (admin, creator, or editor role)
    const participant = await db.query.meetingParticipant.findFirst({
      where: and(
        eq(meetingParticipant.meetingId, meetingId),
        eq(meetingParticipant.userId, userId)
      ),
    });

    const canEdit =
      userWorkspace.role === 'admin' ||
      meetingData.createdById === userId ||
      participant?.role === 'organizer' ||
      participant?.role === 'editor';

    if (!canEdit) {
      return { error: "You don't have permission to create outcomes for this meeting" };
    }

    // Create the outcome
    const [outcome] = await db
      .insert(meetingOutcome)
      .values({
        meetingId,
        type,
        content,
        meta,
        createdById: userId,
      })
      .returning();

    revalidatePath(`/workspace/${meetingData.workspaceId}/meeting/${meetingId}`);
    return { data: outcome };
  } catch (error) {
    console.error('Error creating meeting outcome:', error);
    return { error: 'Failed to create meeting outcome' };
  }
}

// Get all outcomes for a meeting
export async function getMeetingOutcomes(meetingId: string, focusUserId?: string | 'all') {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return { error: 'Unauthorized' };
    }

    const userId = session.user.id;

    // Get the meeting
    const meetingData = await db.query.meeting.findFirst({
      where: eq(meeting.id, meetingId),
    });

    if (!meetingData) {
      return { error: 'Meeting not found' };
    }

    // Check if user has access to this workspace
    const userWorkspace = await db.query.workspaceUser.findFirst({
      where: and(
        eq(workspaceUser.workspaceId, meetingData.workspaceId),
        eq(workspaceUser.userId, userId)
      ),
    });

    if (!userWorkspace) {
      return { error: "You don't have access to this meeting" };
    }

    // Get all outcomes for this meeting first
    const outcomes = await db
      .select()
      .from(meetingOutcome)
      .where(eq(meetingOutcome.meetingId, meetingId));

    // If no filter is applied, return all outcomes
    if (!focusUserId) {
      return { data: outcomes };
    }

    // Apply filtering in memory based on meta field
    const filteredOutcomes = outcomes.filter((outcome) => {
      if (!outcome.meta) {
        // Include outcomes with no meta data only when looking for general outcomes
        return focusUserId === 'all';
      }

      try {
        const meta = JSON.parse(outcome.meta);

        if (focusUserId === 'all') {
          // For 'all' filter, return outcomes with no focusParticipantId
          return !meta.focusParticipantId;
        } else {
          // For specific user filter, match that user's ID
          return meta.focusParticipantId === focusUserId;
        }
      } catch (e) {
        // If meta can't be parsed as JSON, include it only for 'all' filter
        return focusUserId === 'all';
      }
    });

    return { data: filteredOutcomes };
  } catch (error) {
    console.error('Error getting meeting outcomes:', error);
    return { error: 'Failed to get meeting outcomes' };
  }
}

// Update a meeting outcome
export async function updateMeetingOutcome({
  outcomeId,
  type,
  content,
  meta,
}: {
  outcomeId: string;
  type?: string;
  content?: string;
  meta?: string;
}) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return { error: 'Unauthorized' };
    }

    const userId = session.user.id;

    // Get the outcome
    const outcomeData = await db.query.meetingOutcome.findFirst({
      where: eq(meetingOutcome.id, outcomeId),
    });

    if (!outcomeData) {
      return { error: 'Outcome not found' };
    }

    // Get the meeting
    const meetingData = await db.query.meeting.findFirst({
      where: eq(meeting.id, outcomeData.meetingId),
    });

    if (!meetingData) {
      return { error: 'Meeting not found' };
    }

    // Check if user has access to this workspace
    const userWorkspace = await db.query.workspaceUser.findFirst({
      where: and(
        eq(workspaceUser.workspaceId, meetingData.workspaceId),
        eq(workspaceUser.userId, userId)
      ),
    });

    if (!userWorkspace) {
      return { error: "You don't have access to this meeting" };
    }

    // Check if user can edit this outcome (admin, creator, or the person who created it)
    const participant = await db.query.meetingParticipant.findFirst({
      where: and(
        eq(meetingParticipant.meetingId, outcomeData.meetingId),
        eq(meetingParticipant.userId, userId)
      ),
    });

    const canEdit =
      userWorkspace.role === 'admin' ||
      meetingData.createdById === userId ||
      outcomeData.createdById === userId ||
      participant?.role === 'organizer' ||
      participant?.role === 'editor';

    if (!canEdit) {
      return { error: "You don't have permission to update this outcome" };
    }

    // Update the outcome
    const [updatedOutcome] = await db
      .update(meetingOutcome)
      .set({
        type: type !== undefined ? type : outcomeData.type,
        content: content !== undefined ? content : outcomeData.content,
        meta: meta !== undefined ? meta : outcomeData.meta,
        updatedAt: new Date(),
      })
      .where(eq(meetingOutcome.id, outcomeId))
      .returning();

    revalidatePath(`/workspace/${meetingData.workspaceId}/meeting/${outcomeData.meetingId}`);
    return { data: updatedOutcome };
  } catch (error) {
    console.error('Error updating meeting outcome:', error);
    return { error: 'Failed to update meeting outcome' };
  }
}

// Delete a meeting outcome
export async function deleteMeetingOutcome(outcomeId: string) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return { error: 'Unauthorized' };
    }

    const userId = session.user.id;

    // Get the outcome
    const outcomeData = await db.query.meetingOutcome.findFirst({
      where: eq(meetingOutcome.id, outcomeId),
    });

    if (!outcomeData) {
      return { error: 'Outcome not found' };
    }

    // Get the meeting
    const meetingData = await db.query.meeting.findFirst({
      where: eq(meeting.id, outcomeData.meetingId),
    });

    if (!meetingData) {
      return { error: 'Meeting not found' };
    }

    // Check if user has admin rights or created the outcome
    const userWorkspace = await db.query.workspaceUser.findFirst({
      where: and(
        eq(workspaceUser.workspaceId, meetingData.workspaceId),
        eq(workspaceUser.userId, userId)
      ),
    });

    const participant = await db.query.meetingParticipant.findFirst({
      where: and(
        eq(meetingParticipant.meetingId, outcomeData.meetingId),
        eq(meetingParticipant.userId, userId)
      ),
    });

    const canDelete =
      userWorkspace?.role === 'admin' ||
      meetingData.createdById === userId ||
      outcomeData.createdById === userId ||
      participant?.role === 'organizer';

    if (!userWorkspace || !canDelete) {
      return { error: "You don't have permission to delete this outcome" };
    }

    // Delete the outcome
    await db.delete(meetingOutcome).where(eq(meetingOutcome.id, outcomeId));

    revalidatePath(`/workspace/${meetingData.workspaceId}/meeting/${outcomeData.meetingId}`);
    return { data: { success: true } };
  } catch (error) {
    console.error('Error deleting meeting outcome:', error);
    return { error: 'Failed to delete meeting outcome' };
  }
}

// Generate an outcome from meeting recordings with transcriptions
export async function generateMeetingOutcome({
  meetingId,
  outcomeType,
  additionalPrompt,
  focusParticipantId,
}: {
  meetingId: string;
  outcomeType: 'summary' | 'actions';
  additionalPrompt?: string;
  focusParticipantId?: string;
}) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return { error: 'Unauthorized' };
    }

    const userId = session.user.id;

    // Get the meeting
    const meetingData = await db.query.meeting.findFirst({
      where: eq(meeting.id, meetingId),
    });

    if (!meetingData) {
      return { error: 'Meeting not found' };
    }

    // Check if user has access to this workspace
    const userWorkspace = await db.query.workspaceUser.findFirst({
      where: and(
        eq(workspaceUser.workspaceId, meetingData.workspaceId),
        eq(workspaceUser.userId, userId)
      ),
    });

    if (!userWorkspace) {
      return { error: "You don't have access to this meeting" };
    }

    // Check if user can edit this meeting (admin, creator, or editor role)
    const participant = await db.query.meetingParticipant.findFirst({
      where: and(
        eq(meetingParticipant.meetingId, meetingId),
        eq(meetingParticipant.userId, userId)
      ),
    });

    const canEdit =
      userWorkspace.role === 'admin' ||
      meetingData.createdById === userId ||
      participant?.role === 'organizer' ||
      participant?.role === 'editor';

    if (!canEdit) {
      return { error: "You don't have permission to create outcomes for this meeting" };
    }

    // Get all recordings with transcriptions for this meeting
    const recordings = await db
      .select()
      .from(meetingRecording)
      .where(
        and(eq(meetingRecording.meetingId, meetingId), isNotNull(meetingRecording.transcription))
      );

    if (recordings.length === 0) {
      return { error: 'No transcriptions found for this meeting' };
    }

    // Extract transcriptions
    const transcripts = recordings.map((recording) => recording.transcription as string);

    // Get focus participant details if provided
    let focusParticipantInfo = null;
    if (focusParticipantId) {
      const participant = await db
        .select({
          id: meetingParticipant.userId,
          name: user.name,
          email: user.email,
        })
        .from(meetingParticipant)
        .innerJoin(user, eq(meetingParticipant.userId, user.id))
        .where(
          and(
            eq(meetingParticipant.meetingId, meetingId),
            eq(meetingParticipant.userId, focusParticipantId)
          )
        )
        .limit(1);

      if (participant.length > 0) {
        focusParticipantInfo = participant[0];
      }
    }

    // Generate content using AI
    const content = await generateOutcome(
      transcripts,
      outcomeType,
      additionalPrompt,
      focusParticipantInfo
    );

    // Create the outcome
    const [outcome] = await db
      .insert(meetingOutcome)
      .values({
        meetingId,
        type: outcomeType === 'summary' ? 'Summary' : 'Action Items',
        content,
        createdById: userId,
        meta: JSON.stringify({
          additionalPrompt: additionalPrompt || undefined,
          focusParticipantId: focusParticipantId || undefined,
        }),
      })
      .returning();

    revalidatePath(`/workspace/${meetingData.workspaceId}/meeting/${meetingId}`);
    return { data: outcome };
  } catch (error) {
    console.error('Error generating meeting outcome:', error);
    return { error: 'Failed to generate meeting outcome' };
  }
}
