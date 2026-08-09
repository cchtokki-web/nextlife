import { describe, test, expect, vi, beforeEach } from 'vitest';

// 자동저장과 재암호화가 전부 이 라우트로 나간다. 그런데 이 파일이 생기기 전까지 테스트가
// 하나도 없어서, 잠금 플래그를 세우는 코드를 통째로 지워도 아무것도 깨지지 않았다.
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));
vi.mock('@/core/utils/authOptions', () => ({
  authOptions: {},
}));

vi.mock('@/infrastructure/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    scenario: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { getServerSession } from 'next-auth/next';
import { prisma } from '@/infrastructure/db/prisma';
import { PUT } from '@/app/api/scenarios/[id]/route';

const USER_ID = 'user-1';
const SCENARIO_ID = 's1';
const encrypted = { isEncrypted: true, ciphertext: 'abc', iv: 'def' };
const plain = { userProfile: { currentAge: 40 } };

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockedUpdateMany = vi.mocked(prisma.user.updateMany);
const mockedScenarioUpdate = vi.mocked(prisma.scenario.update);

function put(data: unknown) {
  return PUT(
    new Request(`http://localhost/api/scenarios/${SCENARIO_ID}`, {
      method: 'PUT',
      body: JSON.stringify({ data }),
    }),
    { params: Promise.resolve({ id: SCENARIO_ID }) }
  );
}

function stubUser(e2eeEnabledAt: Date | null) {
  mockedUserFindUnique.mockResolvedValue({ id: USER_ID, e2eeEnabledAt } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetServerSession.mockResolvedValue({ user: { id: USER_ID } } as never);
  mockedUpdateMany.mockResolvedValue({ count: 1 });
  vi.mocked(prisma.scenario.findUnique).mockResolvedValue({
    id: SCENARIO_ID, userId: USER_ID, name: 'x', isDefault: false,
    data: '{}', createdAt: new Date(0), updatedAt: new Date(0),
  } as never);
  mockedScenarioUpdate.mockResolvedValue({
    id: SCENARIO_ID, userId: USER_ID, name: 'x', isDefault: false,
    data: JSON.stringify(encrypted), createdAt: new Date(0), updatedAt: new Date(0),
  } as never);
});

describe('PUT /api/scenarios/[id] — E2EE 잠금 플래그', () => {
  test('암호문을 받으면 잠긴 계정으로 기록한다', async () => {
    stubUser(null);

    const res = await put(encrypted);

    expect(res.status).toBe(200);
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, e2eeEnabledAt: null },
      data: { e2eeEnabledAt: expect.any(Date) },
    });
  });

  // 이 플래그는 되돌릴 수 없다. 평문에 잘못 세우면 그 계정은 자기 데이터를 열 수 없는 상태로
  // 영구히 잠기고, 남는 길은 전부 지우는 초기화뿐이다.
  test('평문을 받으면 기록하지 않는다', async () => {
    stubUser(null);

    const res = await put(plain);

    expect(res.status).toBe(200);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  // 클라이언트만 막으면 배포 전 번들이 열려 있는 탭, 새로고침하지 않은 다른 기기, 세션 쿠키를
  // 가진 요청이 전부 우회한다. 플래그를 들고 있는 서버가 막을 수 있는 유일한 지점이다.
  test('잠긴 계정에 평문을 쓰려 하면 거부하고 아무것도 쓰지 않는다', async () => {
    stubUser(new Date('2026-01-01'));

    const res = await put(plain);

    expect(res.status).toBe(409);
    expect(mockedScenarioUpdate).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.user.update)).not.toHaveBeenCalled();
  });

  test('잠긴 계정이어도 암호문은 그대로 받는다', async () => {
    stubUser(new Date('2026-01-01'));

    const res = await put(encrypted);

    expect(res.status).toBe(200);
    expect(mockedScenarioUpdate).toHaveBeenCalled();
  });

  // 쓰기보다 먼저 세우면, 쓰기가 실패했을 때 "플래그는 섰는데 암호문은 없는" 계정이 남는다.
  // 그 상태에서는 맞는 키도 대조할 대상이 없어 검증에 실패한다.
  test('시나리오 쓰기가 실패하면 플래그를 세우지 않는다', async () => {
    stubUser(null);
    mockedScenarioUpdate.mockRejectedValue(new Error('db down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await put(encrypted);

    expect(res.status).toBe(500);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test('name만 바꾸는 요청은 잠금 판정에 관여하지 않는다', async () => {
    stubUser(new Date('2026-01-01'));

    const res = await PUT(
      new Request(`http://localhost/api/scenarios/${SCENARIO_ID}`, {
        method: 'PUT',
        body: JSON.stringify({ name: '새 이름' }),
      }),
      { params: Promise.resolve({ id: SCENARIO_ID }) }
    );

    expect(res.status).toBe(200);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });
});
