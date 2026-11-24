import { env } from '@/lib/server/env';
import { SignIn } from './SignIn';

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  return <SignIn emailAvailable={env.emailEnabled} />;
}
