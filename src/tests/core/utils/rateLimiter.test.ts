import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { isRateLimited } from '@/core/utils/rateLimiter';

describe('isRateLimited', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('limit 이내 요청은 통과한다', () => {
    const key = `test-key-${Math.random()}`;
    expect(isRateLimited(key, 3, 1000)).toBe(false);
    expect(isRateLimited(key, 3, 1000)).toBe(false);
    expect(isRateLimited(key, 3, 1000)).toBe(false);
  });

  test('limit을 초과하면 이후 요청은 차단된다', () => {
    const key = `test-key-${Math.random()}`;
    isRateLimited(key, 3, 1000);
    isRateLimited(key, 3, 1000);
    isRateLimited(key, 3, 1000);
    expect(isRateLimited(key, 3, 1000)).toBe(true);
  });

  test('윈도우가 지나면 카운트가 초기화되어 다시 통과한다', () => {
    const key = `test-key-${Math.random()}`;
    isRateLimited(key, 1, 1000);
    expect(isRateLimited(key, 1, 1000)).toBe(true);

    vi.advanceTimersByTime(1001);

    expect(isRateLimited(key, 1, 1000)).toBe(false);
  });

  test('서로 다른 key는 독립적으로 카운트된다', () => {
    const keyA = `test-key-a-${Math.random()}`;
    const keyB = `test-key-b-${Math.random()}`;
    isRateLimited(keyA, 1, 1000);
    expect(isRateLimited(keyA, 1, 1000)).toBe(true);
    expect(isRateLimited(keyB, 1, 1000)).toBe(false);
  });
});
