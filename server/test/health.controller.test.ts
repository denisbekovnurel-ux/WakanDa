import { describe, expect, it, vi } from 'vitest';
import { HealthController } from '../src/health.controller';
import type { DatabaseService } from '../src/database/database.service';
import type { PushService } from '../src/push/push.service';

const scheduler = {
  pushReady: true,
  telegramReady: false,
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
};

function controllerWith(ping: () => boolean) {
  const database = { ping } as unknown as DatabaseService;
  const push = { schedulerStatus: () => scheduler } as unknown as PushService;
  return new HealthController(database, push);
}

function response() {
  return { status: vi.fn() } as never;
}

describe('health controller', () => {
  it('отдаёт ok, когда база отвечает', () => {
    const res = response();
    const payload = controllerWith(() => true).check(res);
    expect(payload.status).toBe('ok');
    expect(payload.database).toBe('ok');
    expect(payload.scheduler).toEqual(scheduler);
    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).not.toHaveBeenCalled();
  });

  it('отдаёт 503, когда база недоступна', () => {
    const res = response();
    const controller = controllerWith(() => false);
    const payload = controller.check(res);
    expect(payload.status).toBe('degraded');
    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(503);
  });
});
