import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('next-auth/next', () => ({ getServerSession: vi.fn() }));
vi.mock('@/core/utils/authOptions', () => ({ authOptions: {} }));
vi.mock('@/infrastructure/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    scenario: { deleteMany: vi.fn() },
    verificationToken: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(async () => []),
  },
}));
vi.mock('@/core/utils/emailSender', () => ({
  sendEmailMigrationCode: vi.fn(),
  sendSecurityKeyEmail: vi.fn(),
}));
vi.mock('@/core/utils/rateLimiter', () => ({ isRateLimited: vi.fn(() => false) }));
vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn(async () => true),
    hash: vi.fn(async () => 'security-key-hash'),
  },
}));

import bcrypt from 'bcrypt';
import { getServerSession } from 'next-auth/next';
import { prisma } from '@/infrastructure/db/prisma';
import { sendEmailMigrationCode, sendSecurityKeyEmail } from '@/core/utils/emailSender';
import { POST as requestCode } from '@/app/api/user/email-migration/request/route';
import { POST as confirmMigration } from '@/app/api/user/email-migration/confirm/route';
import { POST as resetMigration } from '@/app/api/user/email-migration/reset/route';

const sessionMock = vi.mocked(getServerSession);
const findUserMock = vi.mocked(prisma.user.findUnique);
const findTokenMock = vi.mocked(prisma.verificationToken.findFirst);
const sendCodeMock = vi.mocked(sendEmailMigrationCode);
const sendKeyMock = vi.mocked(sendSecurityKeyEmail);

function request(url: string, body: unknown) {
  return new Request(url, { method: 'POST', body: JSON.stringify(body) });
}

describe('카카오 계정 이메일 로그인 전환 API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.mockResolvedValue({ user: { id: 'kakao-user', provider: 'kakao' } } as never);
    vi.mocked(prisma.verificationToken.create).mockResolvedValue({} as never);
    vi.mocked(prisma.verificationToken.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.scenario.deleteMany).mockResolvedValue({ count: 1 } as never);
    sendCodeMock.mockResolvedValue({} as never);
    sendKeyMock.mockResolvedValue({} as never);
  });

  test('이미 다른 계정이 쓰는 이메일에는 인증번호를 보내지 않는다', async () => {
    findUserMock.mockResolvedValue({ id: 'another-user' } as never);
    const response = await requestCode(request('http://localhost/api/user/email-migration/request', { email: 'used@example.com' }));
    expect(response.status).toBe(409);
    expect(sendCodeMock).not.toHaveBeenCalled();
  });

  test('인증번호를 10분 만료 토큰으로 저장하고 입력한 이메일로 보낸다', async () => {
    findUserMock.mockResolvedValue(null);
    const response = await requestCode(request('http://localhost/api/user/email-migration/request', { email: ' NEW@Example.com ' }));
    expect(response.status).toBe(200);
    expect(prisma.verificationToken.create).toHaveBeenCalledWith({
      data: {
        identifier: 'email-migration:kakao-user:new@example.com',
        token: expect.stringMatching(/^\d{6}\.[a-f0-9]{32}$/),
        expires: expect.any(Date),
      },
    });
    expect(sendCodeMock).toHaveBeenCalledWith('new@example.com', expect.stringMatching(/^\d{6}$/));
  });

  test('인증번호와 기존 키가 맞으면 같은 사용자에 이메일 로그인을 연결한다', async () => {
    findTokenMock.mockResolvedValue({
      identifier: 'email-migration:kakao-user:new@example.com',
      token: '123456.random',
      expires: new Date(Date.now() + 60_000),
    });
    findUserMock
      .mockResolvedValueOnce({ securityKeyHash: 'old-key-hash' } as never)
      .mockResolvedValueOnce(null);

    const response = await confirmMigration(request('http://localhost/api/user/email-migration/confirm', {
      email: 'new@example.com', code: '123456', securityKey: 'ABC234',
    }));

    expect(response.status).toBe(200);
    expect(bcrypt.compare).toHaveBeenCalledWith('ABC234', 'old-key-hash');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'kakao-user' },
      data: {
        email: 'new@example.com',
        emailVerified: expect.any(Date),
        securityKeyHash: 'security-key-hash',
        emailMigrationCompletedAt: expect.any(Date),
      },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(sendKeyMock).toHaveBeenCalledWith('new@example.com', 'ABC234');
  });

  test('서버에 기존 키 해시가 있으면 잘못된 보안키를 거부한다', async () => {
    findTokenMock.mockResolvedValue({
      identifier: 'email-migration:kakao-user:new@example.com',
      token: '123456.random',
      expires: new Date(Date.now() + 60_000),
    });
    findUserMock.mockResolvedValueOnce({ securityKeyHash: 'old-key-hash' } as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

    const response = await confirmMigration(request('http://localhost/api/user/email-migration/confirm', {
      email: 'new@example.com', code: '123456', securityKey: 'WRONG2',
    }));
    expect(response.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('만료된 인증번호는 계정을 변경하지 않는다', async () => {
    findTokenMock.mockResolvedValue({
      identifier: 'email-migration:kakao-user:new@example.com',
      token: '123456.random',
      expires: new Date(Date.now() - 1),
    });
    const response = await confirmMigration(request('http://localhost/api/user/email-migration/confirm', {
      email: 'new@example.com', code: '123456', securityKey: 'ABC234',
    }));
    expect(response.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('키 분실 초기화는 새 키 메일 발송에 성공한 뒤 데이터를 삭제하고 전환한다', async () => {
    findTokenMock.mockResolvedValue({
      identifier: 'email-migration:kakao-user:new@example.com',
      token: '123456.random',
      expires: new Date(Date.now() + 60_000),
    });
    findUserMock.mockResolvedValue(null);

    const response = await resetMigration(request('http://localhost/api/user/email-migration/reset', {
      email: 'new@example.com', code: '123456',
    }));

    expect(response.status).toBe(200);
    expect(sendKeyMock).toHaveBeenCalledWith('new@example.com', expect.stringMatching(/^[A-Z0-9]{6}$/));
    expect(prisma.scenario.deleteMany).toHaveBeenCalledWith({ where: { userId: 'kakao-user' } });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'kakao-user' },
      data: expect.objectContaining({
        email: 'new@example.com',
        emailMigrationCompletedAt: expect.any(Date),
        e2eeEnabledAt: null,
      }),
    }));
  });

  test('새 키 이메일 발송이 실패하면 데이터를 삭제하지 않는다', async () => {
    findTokenMock.mockResolvedValue({
      identifier: 'email-migration:kakao-user:new@example.com',
      token: '123456.random',
      expires: new Date(Date.now() + 60_000),
    });
    findUserMock.mockResolvedValue(null);
    sendKeyMock.mockRejectedValue(new Error('smtp failure'));

    const response = await resetMigration(request('http://localhost/api/user/email-migration/reset', {
      email: 'new@example.com', code: '123456',
    }));
    expect(response.status).toBe(500);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
