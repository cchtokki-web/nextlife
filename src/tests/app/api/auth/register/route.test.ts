import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/infrastructure/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() } },
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
const deleteUserMock = vi.mocked(prisma.user.delete);
const sendEmailMock = vi.mocked(sendSecurityKeyEmail);
const rateLimitMock = vi.mocked(isRateLimited);

function request(email: unknown) {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockReturnValue(false);
    findUserMock.mockResolvedValue(null);
    createUserMock.mockResolvedValue({ id: 'user-1' } as never);
    deleteUserMock.mockResolvedValue({} as never);
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

  test('이미 가입한 이메일은 덮어쓰지 않는다', async () => {
    findUserMock.mockResolvedValue({ id: 'existing' } as never);
    const response = await POST(request('user@example.com'));
    expect(response.status).toBe(409);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  test('메일 발송에 실패하면 재가입할 수 있도록 방금 만든 계정을 지운다', async () => {
    sendEmailMock.mockRejectedValue(new Error('smtp failure'));
    const response = await POST(request('user@example.com'));
    expect(response.status).toBe(500);
    expect(deleteUserMock).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  test('같은 이메일의 반복 가입 요청을 제한한다', async () => {
    rateLimitMock.mockReturnValue(true);
    const response = await POST(request('user@example.com'));
    expect(response.status).toBe(429);
    expect(rateLimitMock).toHaveBeenCalledWith('register:user@example.com', 3, 10 * 60 * 1000);
  });
});
