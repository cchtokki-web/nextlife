import crypto from 'crypto';

const READABLE_KEY_CHARACTERS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * 이메일 인증과 클라이언트 E2EE에 함께 쓰는 6자리 보안키를 만든다.
 * randomInt를 사용해 문자 선택의 modulo bias를 피한다.
 */
export function generateSecurityKey(): string {
  return Array.from(
    { length: 6 },
    () => READABLE_KEY_CHARACTERS[crypto.randomInt(READABLE_KEY_CHARACTERS.length)],
  ).join('');
}

export function normalizeSecurityKey(value: string): string {
  return value.trim().toUpperCase();
}

export function isSecurityKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9]{6}$/.test(normalizeSecurityKey(value));
}
