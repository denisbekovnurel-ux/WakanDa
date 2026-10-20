import { describe, expect, it } from 'vitest';
import { userOrIpTracker } from '../src/security/rate-limit';

describe('userOrIpTracker', () => {
  it('считает лимит по пользователю, если он уже аутентифицирован', async () => {
    expect(await userOrIpTracker({ ip: '203.0.113.10', user: { id: 42 } }, {} as never)).toBe('user:42');
  });

  it('иначе откатывается на IP', async () => {
    expect(await userOrIpTracker({ ip: '203.0.113.10' }, {} as never)).toBe('ip:203.0.113.10');
  });

  it('не падает без IP', async () => {
    expect(await userOrIpTracker({}, {} as never)).toBe('ip:unknown');
  });
});
