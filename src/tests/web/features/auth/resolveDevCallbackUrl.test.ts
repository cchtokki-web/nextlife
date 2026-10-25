import { describe, test, expect } from 'vitest';
import { resolveDevCallbackUrl } from '@/web/features/auth/resolveDevCallbackUrl';

describe('resolveDevCallbackUrl', () => {
  test('같은 출처의 경로는 그대로 쓴다', () => {
    expect(resolveDevCallbackUrl('?callbackUrl=/simulator')).toBe('/simulator');
    expect(resolveDevCallbackUrl('?callbackUrl=/simulator%3Ftab%3D1')).toBe('/simulator?tab=1');
  });

  test('callbackUrl이 없으면 루트로 보낸다', () => {
    expect(resolveDevCallbackUrl('')).toBe('/');
    expect(resolveDevCallbackUrl('?other=1')).toBe('/');
  });

  // startsWith('/')만 보면 이 두 형태가 통과하고, window.location.href에 넣으면
  // 실제로 외부 사이트로 나간다.
  test('프로토콜 상대 URL은 외부로 나가므로 막는다', () => {
    expect(resolveDevCallbackUrl('?callbackUrl=//evil.com')).toBe('/');
    expect(resolveDevCallbackUrl('?callbackUrl=//evil.com/path')).toBe('/');
  });

  test('백슬래시 변형도 막는다', () => {
    expect(resolveDevCallbackUrl('?callbackUrl=/\\evil.com')).toBe('/');
  });

  test('절대 URL은 막는다', () => {
    expect(resolveDevCallbackUrl('?callbackUrl=https://evil.com')).toBe('/');
    expect(resolveDevCallbackUrl('?callbackUrl=javascript:alert(1)')).toBe('/');
  });
});
