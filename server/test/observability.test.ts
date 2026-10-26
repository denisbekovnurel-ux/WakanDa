import { describe, expect, it } from 'vitest';
import { sanitizeClientError } from '../src/observability/client-error';
import { sanitizeRequestId } from '../src/observability/request-id';

describe('request id', () => {
  it('принимает безопасный внешний id и первое значение массива', () => {
    expect(sanitizeRequestId('proxy-request-1234')).toBe('proxy-request-1234');
    expect(sanitizeRequestId(['proxy-request-1234', 'other'])).toBe('proxy-request-1234');
  });

  it('отбрасывает пустые, короткие и небезопасные значения', () => {
    expect(sanitizeRequestId(undefined)).toBeNull();
    expect(sanitizeRequestId('short')).toBeNull();
    expect(sanitizeRequestId('bad id with spaces')).toBeNull();
    expect(sanitizeRequestId('bad\nheader')).toBeNull();
  });
});

describe('client error report', () => {
  it('оставляет только технические поля и обрезает url до пути', () => {
    const report = sanitizeClientError({
      message: '  Boom  ',
      stack: 'Error: Boom\n    at app.js:1:1',
      componentStack: '\n    at Page',
      source: 'react',
      url: 'https://example.test/daily?token=secret#hash',
      release: 'abc123',
      token: 'must-not-be-kept',
      state: { secret: true },
    });

    expect(report).toEqual({
      message: 'Boom',
      stack: 'Error: Boom\n    at app.js:1:1',
      componentStack: 'at Page',
      source: 'react',
      url: '/daily',
      release: 'abc123',
    });
    expect(report).not.toHaveProperty('token');
    expect(report).not.toHaveProperty('state');
  });

  it('подставляет безопасный source и отбрасывает мусор', () => {
    expect(sanitizeClientError({ message: 'Boom', source: 'script' })).toMatchObject({
      message: 'Boom',
      source: 'window',
    });
    expect(sanitizeClientError({})).toBeNull();
    expect(sanitizeClientError('Boom')).toBeNull();
  });

  it('ограничивает длину полей', () => {
    const report = sanitizeClientError({ message: 'x'.repeat(2000), stack: 'y'.repeat(6000) });
    expect(report?.message).toHaveLength(1000);
    expect(report?.stack).toHaveLength(4000);
  });
});
