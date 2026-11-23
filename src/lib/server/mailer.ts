import 'server-only';
import nodemailer from 'nodemailer';
import { env } from './env';
import { log } from './log';

/**
 * Sends sign-in / verification emails through SMTP (any provider: Resend, Postmark, SES, Gmail…).
 * Without SMTP configured, development builds print the message to the server console instead,
 * and production builds hide the email option entirely.
 */

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

export interface AuthEmail { to: string; purpose: 'verify_email' | 'sign_in'; link: string; code: string }

/** Test hook: the latest messages "sent" while in dev-log mode. */
export const devOutbox: AuthEmail[] = [];

export async function sendAuthEmail(m: AuthEmail): Promise<void> {
  const subject = m.purpose === 'sign_in' ? 'Your Morse study sign-in link' : 'Confirm your email for the Morse study';
  const text = [
    m.purpose === 'sign_in' ? 'Use this link to sign in to your learner profile:' : 'Use this link to confirm your email address:',
    m.link,
    '',
    `Or enter this code: ${m.code}`,
    '',
    'The link and code expire in 15 minutes. If you did not ask for this, you can ignore this email.',
  ].join('\n');

  if (env.smtpUrl && env.emailFrom) {
    transport ??= nodemailer.createTransport(env.smtpUrl);
    await transport.sendMail({ from: env.emailFrom, to: m.to, subject, text });
    log('info', 'auth email sent', { purpose: m.purpose });
    return;
  }
  if (env.logEmailsInDev) {
    devOutbox.push(m);
    if (devOutbox.length > 50) devOutbox.shift();
    // Development only: printed so the flow can be tested without an email provider.
    console.log(`\n[dev email] to=${m.to} purpose=${m.purpose}\n  link: ${m.link}\n  code: ${m.code}\n`);
    return;
  }
  throw new Error('Email is not configured');
}
