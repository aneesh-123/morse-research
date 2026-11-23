import { redirect } from 'next/navigation';
import { currentParticipant } from '@/lib/server/http';
import { StudyRunner } from './StudyRunner';

export const dynamic = 'force-dynamic';

export default async function StudyPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const me = await currentParticipant();
  if (!me) redirect('/signin');
  const { sessionId } = await params;
  return <StudyRunner sessionId={sessionId} />;
}
