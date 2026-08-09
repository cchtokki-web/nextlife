import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// next-auth 세션 조회를 모킹한다. authOptions 자체는 next-auth adapter/bcrypt 등
// 무거운 의존성을 가지므로, 세션 판단 로직만 필요한 이 라우트 테스트에서는
// authOptions를 더미 객체로 교체해 import 시 부작용을 없앤다.
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));
vi.mock('@/core/utils/authOptions', () => ({
  authOptions: {},
}));

// prisma는 실제 DB에 접근하지 않도록 account.findFirst / account.update만 모킹한다.
vi.mock('@/infrastructure/db/prisma', () => ({
  prisma: {
    account: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/core/utils/isDevMode', () => ({
  isDevMode: vi.fn(() => false),
}));

vi.mock('@/core/utils/rateLimiter', () => ({
  isRateLimited: vi.fn(() => false),
}));

import type { Session } from 'next-auth';
import { getServerSession } from 'next-auth/next';
import { prisma } from '@/infrastructure/db/prisma';
import { isDevMode } from '@/core/utils/isDevMode';
import { isRateLimited } from '@/core/utils/rateLimiter';
import { POST } from '@/app/api/user/send-backup-key/route';

type AccountRecord = NonNullable<Awaited<ReturnType<typeof prisma.account.findFirst>>>;

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedFindFirst = vi.mocked(prisma.account.findFirst);
const mockedUpdate = vi.mocked(prisma.account.update);
const mockedIsDevMode = vi.mocked(isDevMode);
const mockedIsRateLimited = vi.mocked(isRateLimited);

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/user/send-backup-key', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function session(userId = 'user-1', name = '홍길동') {
  return { user: { id: userId, name } } as unknown as Session;
}

const validBody = { key: 'ABC123' };

describe('POST /api/user/send-backup-key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsDevMode.mockReturnValue(false);
    mockedIsRateLimited.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('세션이 없으면 401을 반환한다', async () => {
    mockedGetServerSession.mockResolvedValue(null);

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(401);
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });

  test('session.user.id가 없으면 401을 반환한다', async () => {
    mockedGetServerSession.mockResolvedValue({ user: {} } as unknown as Session);

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(401);
  });

  test('요청 제한(rate limit)에 걸리면 429를 반환한다', async () => {
    mockedGetServerSession.mockResolvedValue(session());
    mockedIsRateLimited.mockReturnValue(true);

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(429);
    // 정상 흐름 하나가 최초 발급 1 + 재시도 2 + 초기화 재발급 1을 쓸 수 있어 한도는 5다.
    expect(mockedIsRateLimited).toHaveBeenCalledWith('send-backup-key:user-1', 5, 5 * 60 * 1000);
    // 요청 제한에 걸리면 그 이후 로직(계정 조회 등)은 실행되지 않아야 한다.
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });

  test('key가 6자리가 아니면 400을 반환한다', async () => {
    mockedGetServerSession.mockResolvedValue(session());

    const res = await POST(makeRequest({ key: 'short' }));

    expect(res.status).toBe(400);
  });

  test('카카오 계정/액세스 토큰이 없고 개발 모드이면 목(mock) 전송으로 성공 처리한다', async () => {
    mockedGetServerSession.mockResolvedValue(session());
    mockedIsDevMode.mockReturnValue(true);
    mockedFindFirst.mockResolvedValue(null);
    const fetchSpy = vi.spyOn(global, 'fetch');

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // 개발 모드 목 분기이므로 실제 카카오 API를 호출하면 안 된다.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('카카오 계정/액세스 토큰이 없고 dev-mock-id 사용자이면(운영 모드여도) 목 전송으로 성공 처리한다', async () => {
    mockedGetServerSession.mockResolvedValue(session('dev-mock-id'));
    mockedIsDevMode.mockReturnValue(false);
    mockedFindFirst.mockResolvedValue(null);
    const fetchSpy = vi.spyOn(global, 'fetch');

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('카카오 계정/액세스 토큰이 없고 개발 모드/목 계정도 아니면 404를 반환한다', async () => {
    mockedGetServerSession.mockResolvedValue(session('real-user-id'));
    mockedIsDevMode.mockReturnValue(false);
    mockedFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(404);
  });

  test('카카오 API 전송이 첫 시도에 성공하면 success:true를 반환한다', async () => {
    mockedGetServerSession.mockResolvedValue(session());
    mockedFindFirst.mockResolvedValue({
      id: 'account-1',
      access_token: 'valid-token',
      refresh_token: 'refresh-token',
    } as unknown as AccountRecord);

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result_code: 0 }), { status: 200 })
    );

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, options] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toBe('https://kapi.kakao.com/v2/api/talk/memo/default/send');
    expect((options as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer valid-token',
    });
  });

  test('액세스 토큰 만료(401) 시 리프레시 토큰으로 재발급 후 재전송에 성공하면 success:true를 반환한다', async () => {
    mockedGetServerSession.mockResolvedValue(session());
    mockedFindFirst.mockResolvedValue({
      id: 'account-1',
      access_token: 'expired-token',
      refresh_token: 'refresh-token',
    } as unknown as AccountRecord);
    mockedUpdate.mockResolvedValue({} as unknown as AccountRecord);

    const fetchSpy = vi
      .spyOn(global, 'fetch')
      // 1) 최초 카카오 메시지 전송 -> 401 (토큰 만료)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: -401, msg: 'expired' }), { status: 401 })
      )
      // 2) 카카오 토큰 리프레시 -> 성공
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 3600 }),
          { status: 200 }
        )
      )
      // 3) 재시도 메시지 전송 -> 성공
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result_code: 0 }), { status: 200 })
      );

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // 갱신된 토큰으로 prisma.account.update가 호출되어야 한다.
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: expect.objectContaining({
        access_token: 'new-token',
        refresh_token: 'new-refresh',
      }),
    });

    // 재시도 요청은 새 액세스 토큰을 사용해야 한다.
    const retryCall = fetchSpy.mock.calls[2];
    expect((retryCall[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer new-token',
    });
  });

  test('액세스 토큰 만료(401) 후 리프레시 토큰 재발급 자체가 실패하면 에러를 반환한다', async () => {
    mockedGetServerSession.mockResolvedValue(session());
    mockedFindFirst.mockResolvedValue({
      id: 'account-1',
      access_token: 'expired-token',
      refresh_token: 'refresh-token',
    } as unknown as AccountRecord);

    const fetchSpy = vi
      .spyOn(global, 'fetch')
      // 1) 최초 전송 -> 401
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: -401, msg: 'expired' }), { status: 401 })
      )
      // 2) 리프레시 시도 -> 실패
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
      );

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(400);
    // 리프레시가 실패했으므로 메시지 재전송(3번째 호출)은 일어나지 않아야 한다.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  test('refresh_token이 없으면 401 응답이어도 리프레시를 시도하지 않고 에러를 반환한다', async () => {
    mockedGetServerSession.mockResolvedValue(session());
    mockedFindFirst.mockResolvedValue({
      id: 'account-1',
      access_token: 'expired-token',
      refresh_token: null,
    } as unknown as AccountRecord);

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: -401, msg: 'expired' }), { status: 401 })
    );

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
