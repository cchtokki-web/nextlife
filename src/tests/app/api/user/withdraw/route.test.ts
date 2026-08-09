import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('next-auth/next', () => ({ getServerSession: vi.fn() }));
vi.mock('@/core/utils/authOptions', () => ({ authOptions: {} }));
vi.mock('@/infrastructure/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), deleteMany: vi.fn() },
    verificationToken: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/core/utils/rateLimiter', () => ({ isRateLimited: vi.fn(() => false) }));

import type { Session } from 'next-auth';
import { getServerSession } from 'next-auth/next';
import { prisma } from '@/infrastructure/db/prisma';
import { isRateLimited } from '@/core/utils/rateLimiter';
import { POST } from '@/app/api/user/withdraw/route';

const USER_ID = 'user-1';
const sessionMock = vi.mocked(getServerSession);
const findUserMock = vi.mocked(prisma.user.findUnique);
const deleteUserMock = vi.mocked(prisma.user.deleteMany);
const deleteTokenMock = vi.mocked(prisma.verificationToken.deleteMany);
const transactionMock = vi.mocked(prisma.$transaction);
const rateLimitMock = vi.mocked(isRateLimited);

function request(body: unknown = { confirm: '탈퇴' }) {
  return new Request('http://localhost/api/user/withdraw', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function session(userId: string | null = USER_ID) {
  return { user: userId ? { id: userId } : {} } as unknown as Session;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue(session());
  rateLimitMock.mockReturnValue(false);
  findUserMock.mockResolvedValue({ email: 'user@example.com' } as never);
  transactionMock.mockImplementation(async (ops: unknown) => Promise.all(ops as Promise<unknown>[]));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('POST /api/user/withdraw', () => {
  test('인증되지 않은 요청은 거부한다', async () => {
    sessionMock.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(findUserMock).not.toHaveBeenCalled();
  });

  test('확인 문구가 다르면 삭제하지 않는다', async () => {
    expect((await POST(request({ confirm: '삭제' }))).status).toBe(400);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  test('요청 제한에 걸리면 삭제하지 않는다', async () => {
    rateLimitMock.mockReturnValue(true);
    expect((await POST(request())).status).toBe(429);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  test('사용자와 이메일 토큰을 한 트랜잭션으로 삭제한다', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(deleteUserMock).toHaveBeenCalledWith({ where: { id: USER_ID } });
    expect(deleteTokenMock).toHaveBeenCalledWith({ where: { identifier: 'user@example.com' } });
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });

  test('이미 삭제된 사용자는 성공으로 처리한다', async () => {
    findUserMock.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  test('DB 삭제 실패는 성공으로 숨기지 않는다', async () => {
    transactionMock.mockRejectedValue(new Error('db down'));
    expect((await POST(request())).status).toBe(500);
  });
});
