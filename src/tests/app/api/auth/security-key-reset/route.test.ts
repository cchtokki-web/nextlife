import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/infrastructure/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('@/core/utils/emailSender', () => ({ sendSecurityKeyEmail: vi.fn() }));
vi.mock('@/core/utils/rateLimiter', () => ({ isRateLimited: vi.fn(() => false) }));
vi.mock('@/core/utils/securityKey', () => ({ generateSecurityKey: vi.fn(() => 'NEW234') }));
vi.mock('bcrypt', () => ({ default: { hash: vi.fn(async () => 'new-hash') } }));

import { prisma } from '@/infrastructure/db/prisma';
import { sendSecurityKeyEmail } from '@/core/utils/emailSender';
import { POST } from '@/app/api/auth/security-key/reset/route';

const findUserMock = vi.mocked(prisma.user.findUnique);
const updateUserMock = vi.mocked(prisma.user.update);
const sendEmailMock = vi.mocked(sendSecurityKeyEmail);

function request(email = 'user@example.com') {
  return new Request('http://localhost/api/auth/security-key/reset', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

describe('POST /api/auth/security-key/reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUserMock.mockResolvedValue({
      id: 'user-1', email: 'user@example.com', securityKeyHash: 'old-hash', securityKeyResetPending: false,
    } as never);
    updateUserMock.mockResolvedValue({} as never);
    sendEmailMock.mockResolvedValue({} as never);
  });

  test('데이터는 지우지 않고 새 키 검증 대기 상태로 만든 뒤 이메일을 보낸다', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(updateUserMock).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { securityKeyHash: 'new-hash', securityKeyResetPending: true },
    });
    expect(sendEmailMock).toHaveBeenCalledWith('user@example.com', 'NEW234');
  });

  test('메일 발송에 실패하면 기존 로그인 키와 대기 상태를 복원한다', async () => {
    sendEmailMock.mockRejectedValue(new Error('smtp failure'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(updateUserMock).toHaveBeenLastCalledWith({
      where: { id: 'user-1' },
      data: { securityKeyHash: 'old-hash', securityKeyResetPending: false },
    });
  });

  test('가입 여부를 응답으로 노출하지 않는다', async () => {
    findUserMock.mockResolvedValue(null);
    const response = await POST(request('missing@example.com'));
    expect(response.status).toBe(200);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
