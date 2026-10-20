import type { ThrottlerGetTrackerFunction } from '@nestjs/throttler';
import type { AuthedRequest } from '../auth/auth.guard';

/**
 * Ключ лимита — id пользователя, а не IP. Guard стоит после AuthGuard, поэтому
 * req.user уже заполнен. Для публичных маршрутов остаётся IP.
 */
export const userOrIpTracker: ThrottlerGetTrackerFunction = (req) => {
  const user = (req as AuthedRequest).user;
  if (user?.id) return `user:${user.id}`;
  const ip = typeof req.ip === 'string' && req.ip ? req.ip : 'unknown';
  return `ip:${ip}`;
};
