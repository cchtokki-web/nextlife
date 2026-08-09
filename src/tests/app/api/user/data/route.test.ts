import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));
vi.mock('@/core/utils/authOptions', () => ({
  authOptions: {},
}));
vi.mock('@/core/utils/isDevMode', () => ({
  isDevMode: vi.fn(() => false),
}));
vi.mock('@/infrastructure/db/prisma', () => ({
  prisma: {
    user: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import type { Session } from 'next-auth';
import { getServerSession } from 'next-auth/next';
import { prisma } from '@/infrastructure/db/prisma';
import { isDevMode } from '@/core/utils/isDevMode';
import { PUT } from '@/app/api/user/data/route';

const EMAIL = 'a@b.com';

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedUpsert = vi.mocked(prisma.user.upsert);
const mockedUpdateMany = vi.mocked(prisma.user.updateMany);
const mockedIsDevMode = vi.mocked(isDevMode);

function makeRequest() {
  return new Request('http://localhost/api/user/data', {
    method: 'PUT',
    body: JSON.stringify({ userProfile: { currentAge: 40 } }),
  });
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetServerSession.mockResolvedValue({ user: { email: EMAIL } } as unknown as Session);
  mockedIsDevMode.mockReturnValue(false);
  mockedUpdateMany.mockResolvedValue({ count: 1 });
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

// 세션 전략이 jwt라 User 행을 지워도 쿠키는 만료까지 살아 있다. 예전에는 이 라우트의 upsert가
// 그 토큰만 보고 행을 되살려서, 탈퇴한 계정이 저장 한 번으로 부활했다.
describe('PUT /api/user/data — 삭제된 사용자 부활 차단', () => {
  test('운영 모드에서 해당 이메일의 행이 없으면 401을 반환하고 행을 만들지 않는다', async () => {
    mockedUpdateMany.mockResolvedValue({ count: 0 });

    const res = await PUT(makeRequest());

    expect(res.status).toBe(401);
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  test('운영 모드에서 행이 있으면 갱신하고 성공한다', async () => {
    const res = await PUT(makeRequest());

    expect(res.status).toBe(200);
    expect(mockedUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: EMAIL } })
    );
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  // 개발 세션은 DB 행 없이 발급되므로 upsert가 유일한 저장 수단이다.
  test('개발 모드에서는 upsert로 행을 만든다', async () => {
    mockedIsDevMode.mockReturnValue(true);

    const res = await PUT(makeRequest());

    expect(res.status).toBe(200);
    expect(mockedUpsert).toHaveBeenCalled();
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  test('세션에 이메일이 없으면 401을 반환한다', async () => {
    mockedGetServerSession.mockResolvedValue({ user: {} } as unknown as Session);

    const res = await PUT(makeRequest());

    expect(res.status).toBe(401);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
    expect(mockedUpsert).not.toHaveBeenCalled();
  });
});
