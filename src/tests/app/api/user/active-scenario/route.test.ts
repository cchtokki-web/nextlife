import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));
vi.mock('@/core/utils/authOptions', () => ({
  authOptions: {},
}));

vi.mock('@/infrastructure/db/prisma', () => ({
  prisma: {
    user: {
      updateMany: vi.fn(),
    },
    scenario: {
      findUnique: vi.fn(),
    },
  },
}));

import { getServerSession } from 'next-auth/next';
import { prisma } from '@/infrastructure/db/prisma';
import { PUT } from '@/app/api/user/active-scenario/route';

const USER_ID = 'user-1';
const SCENARIO_ID = 's1';

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedScenarioFindUnique = vi.mocked(prisma.scenario.findUnique);
const mockedUpdateMany = vi.mocked(prisma.user.updateMany);

function put(body: unknown) {
  return PUT(new Request('http://localhost/api/user/active-scenario', {
    method: 'PUT',
    body: JSON.stringify(body),
  }));
}

function stubScenarioOwner(userId: string | null) {
  mockedScenarioFindUnique.mockResolvedValue(
    userId === null ? null : ({ userId } as never)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetServerSession.mockResolvedValue({ user: { id: USER_ID } } as never);
  mockedUpdateMany.mockResolvedValue({ count: 1 });
  stubScenarioOwner(USER_ID);
});

describe('PUT /api/user/active-scenario', () => {
  test('내 시나리오면 계정에 기록한다', async () => {
    const res = await put({ scenarioId: SCENARIO_ID });

    expect(res.status).toBe(200);
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { lastActiveScenarioId: SCENARIO_ID },
    });
  });

  test('로그인하지 않았으면 401이고 아무것도 쓰지 않는다', async () => {
    mockedGetServerSession.mockResolvedValue(null as never);

    const res = await put({ scenarioId: SCENARIO_ID });

    expect(res.status).toBe(401);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  // 이 값은 다음 로그인에서 그대로 선택되므로, 남의 시나리오 id가 들어가면 사용자는 자기
  // 계정에서 열 수 없는 항목을 계속 가리키게 된다.
  test('남의 시나리오 id는 거부한다', async () => {
    stubScenarioOwner('someone-else');

    const res = await put({ scenarioId: SCENARIO_ID });

    expect(res.status).toBe(404);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  test('없는 시나리오 id는 거부한다', async () => {
    stubScenarioOwner(null);

    const res = await put({ scenarioId: SCENARIO_ID });

    expect(res.status).toBe(404);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  test('scenarioId가 없으면 400이다', async () => {
    const res = await put({});

    expect(res.status).toBe(400);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  // 비로그인 세션이 만든 임시 id. 서버에 대응하는 행이 없으므로 조회조차 하지 않는다.
  test('local- 임시 id는 조용히 무시한다', async () => {
    const res = await put({ scenarioId: 'local-default' });

    expect(res.status).toBe(200);
    expect(mockedScenarioFindUnique).not.toHaveBeenCalled();
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  // 세션 전략이 jwt라 탈퇴한 계정의 쿠키가 만료까지 살아 있다. 없는 행을 만들지 않는다.
  test('User 행이 없으면 401이다', async () => {
    mockedUpdateMany.mockResolvedValue({ count: 0 });

    const res = await put({ scenarioId: SCENARIO_ID });

    expect(res.status).toBe(401);
  });
});
