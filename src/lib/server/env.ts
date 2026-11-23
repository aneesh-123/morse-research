import 'server-only';

/** Centralised environment configuration. Secrets are read only on the server. */
export const env = {
  get databaseUrl(): string {
    const v = process.env.DATABASE_URL;
    if (!v) throw new Error('DATABASE_URL is not set');
    return v;
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },
  /** Public base URL, used in emailed links. */
  get appUrl(): string {
    return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  },
  /** Secure cookies unless explicitly disabled (needed only for plain-http local production runs). */
  get secureCookies(): boolean {
    if (process.env.INSECURE_COOKIES === '1') return false;
    return process.env.NODE_ENV === 'production';
  },
  get smtpUrl(): string | undefined {
    return process.env.SMTP_URL || undefined;
  },
  get emailFrom(): string | undefined {
    return process.env.EMAIL_FROM || undefined;
  },
  /** In development, emailed links/codes are written to the server log when SMTP is not configured. */
  get logEmailsInDev(): boolean {
    return !this.isProduction || process.env.EMAIL_DEV_LOG === '1';
  },
  get emailEnabled(): boolean {
    return Boolean(this.smtpUrl && this.emailFrom) || this.logEmailsInDev;
  },
};
