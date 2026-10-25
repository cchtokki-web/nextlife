import { describe, expect, test } from 'vitest';
// Next.js 16.2.7의 파일 규약은 Proxy지만 테스트 유틸 export는 아직 옛 이름을 유지한다.
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { config } from '@/proxy';

describe('proxy matcher', () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({
    config,
    nextConfig: {},
    url,
  });

  test.each(['/simulator', '/admin', '/settings/profile'])('%s는 인증 Proxy를 통과한다', (url) => {
    expect(matches(url)).toBe(true);
  });

  test.each([
    '/',
    '/login',
    '/register',
    '/api/auth/session',
    '/_next/static/chunk.js',
    '/_next/image',
    '/sitemap.xml',
    '/robots.txt',
    '/icon.png',
  ])('%s는 인증 Proxy에서 제외한다', (url) => {
    expect(matches(url)).toBe(false);
  });
});
