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
      findMany: vi.fn(),
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
const mockedScenarioFindMany = vi.mocked(prisma.scenario.findMany);
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

/** 요청한 id들이 전부 내 시나리오라고 답하게 한다. */
function stubOwnedScenarios(ids: string[]) {
  mockedScenarioFindMany.mockResolvedValue(ids.map(id => ({ id })) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetServerSession.mockResolvedValue({ user: { id: USER_ID } } as never);
  mockedUpdateMany.mockResolvedValue({ count: 1 });
  stubScenarioOwner(USER_ID);
  stubOwnedScenarios([]);
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

// 비교 대상은 결과 화면을 바꾸는 사용자 결정이다. 브라우저에만 두면 다시 로그인한 순간
// 대시보드의 비교 카드가 통째로 사라진다 — 마지막 선택을 계정으로 옮긴 것과 같은 이유다.
describe('PUT /api/user/active-scenario — 비교 목록', () => {
  test('내 시나리오들이면 계정에 기록한다', async () => {
    stubOwnedScenarios(['s1', 's2']);

    const res = await put({ compareScenarioIds: ['s1', 's2'] });

    expect(res.status).toBe(200);
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { compareScenarioIds: JSON.stringify(['s1', 's2']) },
    });
  });

  // 고른 순서대로 카드가 늘어선다. 정렬하거나 집합으로 바꾸면 화면의 순서가 달라진다.
  test('고른 순서를 그대로 보존한다', async () => {
    stubOwnedScenarios(['s1', 's2', 's3']);

    await put({ compareScenarioIds: ['s3', 's1', 's2'] });

    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { compareScenarioIds: JSON.stringify(['s3', 's1', 's2']) },
    });
  });

  test('빈 배열이면 비교 목록을 비운다', async () => {
    const res = await put({ compareScenarioIds: [] });

    expect(res.status).toBe(200);
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { compareScenarioIds: null },
    });
    // 확인할 id가 없으므로 조회조차 하지 않는다.
    expect(mockedScenarioFindMany).not.toHaveBeenCalled();
  });

  test('남의 시나리오 id가 섞이면 거부하고 아무것도 쓰지 않는다', async () => {
    stubOwnedScenarios(['s1']);

    const res = await put({ compareScenarioIds: ['s1', 'not-mine'] });

    expect(res.status).toBe(404);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  // 차트 범례와 색상이 3개를 전제로 한다. 그 이상을 저장해 두면 다음 로그인에서 화면이 깨진다.
  test('한도를 넘는 개수는 거부한다', async () => {
    stubOwnedScenarios(['s1', 's2', 's3', 's4']);

    const res = await put({ compareScenarioIds: ['s1', 's2', 's3', 's4'] });

    expect(res.status).toBe(400);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  test('배열이 아니면 거부한다', async () => {
    const res = await put({ compareScenarioIds: 's1' });

    expect(res.status).toBe(400);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  test('로그인하지 않았으면 401이고 아무것도 쓰지 않는다', async () => {
    mockedGetServerSession.mockResolvedValue(null as never);

    const res = await put({ compareScenarioIds: ['s1'] });

    expect(res.status).toBe(401);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  // 두 값이 한 요청에 오면 한 번의 update로 함께 쓴다. 나눠 쓰면 둘째가 실패했을 때 화면과
  // 계정이 어긋난 채로 남는다.
  test('마지막 선택과 함께 오면 한 번에 기록한다', async () => {
    stubOwnedScenarios(['s2']);

    const res = await put({ scenarioId: SCENARIO_ID, compareScenarioIds: ['s2'] });

    expect(res.status).toBe(200);
    expect(mockedUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: {
        lastActiveScenarioId: SCENARIO_ID,
        compareScenarioIds: JSON.stringify(['s2']),
      },
    });
  });

  // 둘 다 없는 요청은 무엇을 하라는 것인지 알 수 없다. 조용히 200으로 답하면 클라이언트의
  // 오타가 "기록됐다"로 읽힌다.
  test('아무 값도 없으면 400이다', async () => {
    const res = await put({});

    expect(res.status).toBe(400);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });
});
