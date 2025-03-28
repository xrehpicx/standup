import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Mic, FileText, Calendar, Users, Clock } from 'lucide-react';
import { db } from '@/lib/db';
import { meeting, meetingParticipant, meetingRecording } from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';
import { Link } from '../ui/link';

interface MeetingsListProps {
  meetings: (typeof meeting.$inferSelect)[];
  workspaceId: string;
}

export default async function MeetingsList({ meetings, workspaceId }: MeetingsListProps) {
  // Get recording and participant counts for each meeting
  const meetingIds = meetings.map((m) => m.id);

  // For each meeting, get the recording count
  const recordingCounts = await Promise.all(
    meetingIds.map(async (id) => {
      const [result] = await db
        .select({ count: count() })
        .from(meetingRecording)
        .where(eq(meetingRecording.meetingId, id));
      return { meetingId: id, count: result.count };
    })
  );

  // For each meeting, get the participant count
  const participantCounts = await Promise.all(
    meetingIds.map(async (id) => {
      const [result] = await db
        .select({ count: count() })
        .from(meetingParticipant)
        .where(eq(meetingParticipant.meetingId, id));
      return { meetingId: id, count: result.count };
    })
  );

  // Create a map for quick lookup
  const recordingsMap = new Map(recordingCounts.map((r) => [r.meetingId, r.count]));
  const participantsMap = new Map(participantCounts.map((p) => [p.meetingId, p.count]));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {meetings.map((meeting) => {
        const recordingCount = recordingsMap.get(meeting.id) || 0;
        const participantCount = participantsMap.get(meeting.id) || 0;

        // Calculate duration if start and end times are available
        let duration = null;
        if (meeting.startTime && meeting.endTime) {
          const durationMs =
            new Date(meeting.endTime).getTime() - new Date(meeting.startTime).getTime();
          const durationMins = Math.round(durationMs / 60000);
          duration = durationMins > 0 ? `${durationMins} min` : 'Less than a minute';
        }

        return (
          <Link
            href={`/workspace/${workspaceId}/meeting/${meeting.id}`}
            prefetch
            key={meeting.id}
            className="block transition-transform hover:scale-[1.02]"
          >
            <Card className="h-full gap-2 overflow-hidden py-3 pb-0 hover:shadow-md">
              <CardHeader className="px-4 pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="line-clamp-1 text-lg">{meeting.title}</CardTitle>
                  {recordingCount > 0 && (
                    <Badge variant="secondary" className="flex items-center gap-1 text-xs">
                      <Mic className="h-3 w-3" />
                      <span>
                        {recordingCount} Recording
                        {recordingCount !== 1 ? 's' : ''}
                      </span>
                    </Badge>
                  )}
                </div>
                <CardDescription className="line-clamp-2 text-xs">
                  {meeting.description || 'No description'}
                </CardDescription>
              </CardHeader>
              <CardContent className="gap-1 px-4 py-0">
                <div className="text-muted-foreground flex flex-col gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span>
                      {meeting.startTime
                        ? new Date(meeting.startTime).toLocaleDateString()
                        : 'Date not set'}
                    </span>
                  </div>

                  {duration && (
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      <span>{duration}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    <span>
                      {participantCount} Participant
                      {participantCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              </CardContent>
              <div className="text-muted-foreground mt-2 border-t px-4 py-2 text-xs">
                Created{' '}
                {formatDistanceToNow(new Date(meeting.createdAt), {
                  addSuffix: true,
                })}
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
