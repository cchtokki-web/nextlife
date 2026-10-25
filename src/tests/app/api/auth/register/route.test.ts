import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/infrastructure/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() } },
}));
vi.mock('@/core/utils/emailSender', () => ({ sendSecurityKeyEmail: vi.fn() }));
vi.mock('@/core/utils/securityKey', () => ({ generateSecurityKey: vi.fn(() => 'ABC234') }));
vi.mock('@/core/utils/rateLimiter', () => ({ isRateLimited: vi.fn(() => false) }));
vi.mock('bcrypt', () => ({ default: { hash: vi.fn(async () => 'hashed-key') } }));

import { prisma } from '@/infrastructure/db/prisma';
import { sendSecurityKeyEmail } from '@/core/utils/emailSender';
import { isRateLimited } from '@/core/utils/rateLimiter';
import { POST } from '@/app/api/auth/register/route';

const findUserMock = vi.mocked(prisma.user.findUnique);
const createUserMock = vi.mocked(prisma.user.create);
const updateUserMock = vi.mocked(prisma.user.update);
const sendEmailMock = vi.mocked(sendSecurityKeyEmail);
const rateLimitMock = vi.mocked(isRateLimited);

function request(email: unknown, confirmReset = false) {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, confirmReset }),
  });
}

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockReturnValue(false);
    findUserMock.mockResolvedValue(null);
    createUserMock.mockResolvedValue({ id: 'user-1' } as never);
    updateUserMock.mockResolvedValue({} as never);
    sendEmailMock.mockResolvedValue({} as never);
  });

  test('이메일을 정규화하고 보안키 원문 대신 해시만 사용자에 저장한다', async () => {
    const response = await POST(request(' User@Example.COM '));
    expect(response.status).toBe(201);
    expect(createUserMock).toHaveBeenCalledWith({
      data: { email: 'user@example.com', securityKeyHash: 'hashed-key' },
    });
    expect(sendEmailMock).toHaveBeenCalledWith('user@example.com', 'ABC234');
  });

  test('기존 이메일은 경고 확인 전까지 키와 데이터를 건드리지 않는다', async () => {
    findUserMock.mockResolvedValue({ id: 'existing' } as never);
    const response = await POST(request('user@example.com'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'ACCOUNT_RESET_REQUIRED' });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  test('초기화를 확인하면 새 키를 보낸 뒤 로그인 시 데이터 삭제를 예약한다', async () => {
    findUserMock.mockResolvedValue({ id: 'existing' } as never);
    const response = await POST(request('user@example.com', true));
    expect(response.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledWith('user@example.com', 'ABC234');
    expect(updateUserMock).toHaveBeenCalledWith({
      where: { id: 'existing' },
      data: {
        securityKeyHash: 'hashed-key',
        securityKeyResetPending: true,
        emailVerified: null,
      },
    });
    expect(await response.json()).toMatchObject({ resetPending: true });
  });

  test('메일 발송에 실패하면 새 계정도 기존 계정 변경도 수행하지 않는다', async () => {
    sendEmailMock.mockRejectedValue(new Error('smtp failure'));
    const response = await POST(request('user@example.com'));
    expect(response.status).toBe(500);
    expect(createUserMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  test('같은 이메일의 반복 가입 요청을 제한한다', async () => {
    rateLimitMock.mockReturnValue(true);
    const response = await POST(request('user@example.com'));
    expect(response.status).toBe(429);
    expect(rateLimitMock).toHaveBeenCalledWith('register:user@example.com', 3, 10 * 60 * 1000);
  });
});
