import { beforeAll, describe, expect, it } from 'vitest';
import { resetTestDatabase } from '../support/db';
import { rateLimit } from '@/lib/server/rate-limit';

beforeAll(resetTestDatabase);

describe('rate limiting', () => {
  it('allows up to the limit within a window, then refuses', async () => {
    const prev = process.env.RATE_LIMIT_DISABLED;
    delete process.env.RATE_LIMIT_DISABLED;
    try {
      const key = `test:${Date.now()}`;
      const results = [];
      for (let i = 0; i < 5; i++) results.push(await rateLimit(key, 3, 600));
      expect(results).toEqual([true, true, true, false, false]);
      expect(await rateLimit(`${key}:other`, 3, 600)).toBe(true);
    } finally {
      process.env.RATE_LIMIT_DISABLED = prev;
    }
  });
});
