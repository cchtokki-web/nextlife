import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('next-auth/next', () => ({ getServerSession: vi.fn() }));
vi.mock('@/core/utils/authOptions', () => ({ authOptions: {} }));
vi.mock('@/infrastructure/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('@/core/utils/emailSender', () => ({ sendSecurityKeyEmail: vi.fn() }));
vi.mock('@/core/utils/rateLimiter', () => ({ isRateLimited: vi.fn(() => false) }));
vi.mock('bcrypt', () => ({ default: { hash: vi.fn(async () => 'hashed-key') } }));

import { getServerSession } from 'next-auth/next';
import { prisma } from '@/infrastructure/db/prisma';
import { sendSecurityKeyEmail } from '@/core/utils/emailSender';
import { isRateLimited } from '@/core/utils/rateLimiter';
import { POST } from '@/app/api/user/send-backup-key/route';

const getSessionMock = vi.mocked(getServerSession);
const findUserMock = vi.mocked(prisma.user.findUnique);
const updateUserMock = vi.mocked(prisma.user.update);
const sendEmailMock = vi.mocked(sendSecurityKeyEmail);
const rateLimitMock = vi.mocked(isRateLimited);

function request(body: unknown) {
  return new Request('http://localhost/api/user/send-backup-key', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/user/send-backup-key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockReturnValue(false);
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.com' } } as never);
    findUserMock.mockResolvedValue({ email: 'user@example.com' } as never);
    updateUserMock.mockResolvedValue({} as never);
    sendEmailMock.mockResolvedValue({} as never);
  });

  test('세션이 없으면 401을 반환한다', async () => {
    getSessionMock.mockResolvedValue(null);
    const response = await POST(request({ key: 'ABC234' }));
    expect(response.status).toBe(401);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test('5분에 5회 발송 제한을 적용한다', async () => {
    rateLimitMock.mockReturnValue(true);
    const response = await POST(request({ key: 'ABC234' }));
    expect(response.status).toBe(429);
    expect(rateLimitMock).toHaveBeenCalledWith('send-backup-key:user-1', 5, 5 * 60 * 1000);
  });

  test('6자리가 아닌 키를 거부한다', async () => {
    const response = await POST(request({ key: 'SHORT' }));
    expect(response.status).toBe(400);
    expect(findUserMock).not.toHaveBeenCalled();
  });

  test('가입 이메일이 없으면 재발급하지 않는다', async () => {
    findUserMock.mockResolvedValue({ email: null } as never);
    const response = await POST(request({ key: 'ABC234' }));
    expect(response.status).toBe(409);
  });

  test('새 키 해시를 저장한 뒤 가입 이메일로 보낸다', async () => {
    const response = await POST(request({ key: 'abc234' }));
    expect(response.status).toBe(200);
    expect(updateUserMock).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { securityKeyHash: 'hashed-key', emailVerified: expect.any(Date) },
    });
    expect(sendEmailMock).toHaveBeenCalledWith('user@example.com', 'ABC234');
  });

  test('메일 전송 실패는 사용자용 오류로 바꾼다', async () => {
    sendEmailMock.mockRejectedValue(new Error('smtp details'));
    const response = await POST(request({ key: 'ABC234' }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: '이메일로 보안키를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  });
});
