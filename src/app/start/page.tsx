import { env } from '@/lib/server/env';
import { StartForm } from './StartForm';

export const dynamic = 'force-dynamic';

export default function StartPage() {
  return <StartForm emailAvailable={env.emailEnabled} />;
}
