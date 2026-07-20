import { describe, test, expect, vi, afterEach } from 'vitest';

// prisma는 실제 DB에 접근하지 않도록 모킹한다. admin/stats 라우트는
// prisma.analyticsEvent.groupBy / .count 만 사용한다.
vi.mock('@/infrastructure/db/prisma', () => ({
  prisma: {
    analyticsEvent: {
      groupBy: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

import { GET } from '@/app/api/admin/stats/route';

function makeRequest(authorizationHeader?: string) {
  const headers = new Headers();
  if (authorizationHeader !== undefined) {
    headers.set('authorization', authorizationHeader);
  }
  return new Request('http://localhost/api/admin/stats', { headers });
}

describe('GET /api/admin/stats - 인증', () => {
  const originalAdminKey = process.env.ADMIN_KEY;

  afterEach(() => {
    if (originalAdminKey === undefined) {
      delete process.env.ADMIN_KEY;
    } else {
      process.env.ADMIN_KEY = originalAdminKey;
    }
    vi.clearAllMocks();
  });

  test('Authorization 헤더가 없으면 401을 반환한다', async () => {
    process.env.ADMIN_KEY = 'correct-secret';
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  test('Bearer 형식이 아닌 헤더는 401을 반환한다', async () => {
    process.env.ADMIN_KEY = 'correct-secret';
    const res = await GET(makeRequest('correct-secret'));
    expect(res.status).toBe(401);
  });

  test('잘못된 키를 보내면 403을 반환한다', async () => {
    process.env.ADMIN_KEY = 'correct-secret';
    const res = await GET(makeRequest('Bearer wrong-secret'));
    expect(res.status).toBe(403);
  });

  test('ADMIN_KEY 환경변수가 설정되지 않은(undefined) 상태에서는 어떤 토큰을 보내도 거부된다', async () => {
    delete process.env.ADMIN_KEY;
    const res = await GET(makeRequest('Bearer anything'));
    expect(res.status).toBe(403);
  });

  // route.ts가 `authHeader.split(' ')[1]`(내부 공백에 취약) 대신 `slice('Bearer '.length)`을
  // 쓰고, ADMIN_KEY가 falsy(빈 문자열 포함)면 무조건 거부하도록 고쳐 이 우회가 막혔다.
  test('ADMIN_KEY가 빈 문자열이어도 인증이 우회되지 않는다', async () => {
    process.env.ADMIN_KEY = '';
    const res = await GET(makeRequest('Bearer  x'));
    expect(res.status).not.toBe(200);
    expect([401, 403]).toContain(res.status);
  });

  test('ADMIN_KEY 환경변수가 undefined이면, 빈 토큰으로도 통과할 수 없다', async () => {
    delete process.env.ADMIN_KEY;
    const res = await GET(makeRequest('Bearer  x'));
    expect(res.status).not.toBe(200);
    expect([401, 403]).toContain(res.status);
  });

  test('올바른 키를 보내면 통과하고 통계 데이터를 반환한다', async () => {
    process.env.ADMIN_KEY = 'correct-secret';
    const res = await GET(makeRequest('Bearer correct-secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.stats).toHaveProperty('daily');
    expect(json.stats).toHaveProperty('weekly');
    expect(json.stats).toHaveProperty('monthly');
    expect(json.stats).toHaveProperty('yearly');
  });
});
