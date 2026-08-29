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
import { PUT, DELETE } from '@/app/api/scenarios/[id]/route';

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

function stubUser(
  e2eeEnabledAt: Date | null,
  lastActiveScenarioId: string | null = null,
  compareScenarioIds: string | null = null,
) {
  mockedUserFindUnique.mockResolvedValue(
    { id: USER_ID, e2eeEnabledAt, lastActiveScenarioId, compareScenarioIds } as never
  );
}

function putBody(body: unknown) {
  return PUT(
    new Request(`http://localhost/api/scenarios/${SCENARIO_ID}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: SCENARIO_ID }) }
  );
}

function del(id: string) {
  return DELETE(
    new Request(`http://localhost/api/scenarios/${id}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id }) }
  );
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

// 결과 화면을 복원하는 유일한 근거다. 이 표시가 저장되지 않으면 사용자는 다시 로그인할 때마다
// 「분석 시작」을 다시 눌러야 한다 — 설정은 남아 있는데 계획만 사라진 것처럼 보인다.
describe('PUT /api/scenarios/[id] — 분석 표시', () => {
  test('analyzed: true면 분석 시각을 기록한다', async () => {
    stubUser(null);

    const res = await putBody({ analyzed: true });

    expect(res.status).toBe(200);
    expect(mockedScenarioUpdate).toHaveBeenCalledWith({
      where: { id: SCENARIO_ID },
      data: { analyzedAt: expect.any(Date) },
    });
  });

  test('analyzed: false면 분석 시각을 지운다', async () => {
    stubUser(null);

    const res = await putBody({ analyzed: false });

    expect(res.status).toBe(200);
    expect(mockedScenarioUpdate).toHaveBeenCalledWith({
      where: { id: SCENARIO_ID },
      data: { analyzedAt: null, analyzedParamsHash: null },
    });
  });

  // 이 기능이 실제로 저장되는 «유일한» 경로다. if/else if의 순서가 뒤바뀌어 analyzed:true가
  // 먼저 걸리면 해시가 조용히 저장되지 않고, 모든 시나리오가 영원히 「분석 완료」로 읽힌다.
  test('analyzed: true와 해시가 함께 오면 둘 다 기록한다', async () => {
    stubUser(null);

    const res = await putBody({ analyzed: true, analyzedParamsHash: 'v1:0123456789abcdef' });

    expect(res.status).toBe(200);
    expect(mockedScenarioUpdate).toHaveBeenCalledWith({
      where: { id: SCENARIO_ID },
      data: { analyzedAt: expect.any(Date), analyzedParamsHash: 'v1:0123456789abcdef' },
    });
  });

  // 해시를 «모른다»고 명시적으로 말하는 요청. 키를 빼고 보내면 서버가 옛 해시를 유지해
  // 방금 분석한 시나리오가 다음 접속부터 영원히 「재분석 필요」가 된다.
  test('해시가 null이면 모른다는 뜻으로 받아 지운다', async () => {
    stubUser(null);

    const res = await putBody({ analyzed: true, analyzedParamsHash: null });

    expect(res.status).toBe(200);
    expect(mockedScenarioUpdate).toHaveBeenCalledWith({
      where: { id: SCENARIO_ID },
      data: { analyzedAt: expect.any(Date), analyzedParamsHash: null },
    });
  });

  // else가 load-bearing이다. 두 개의 독립된 if로 펴면 이 동작이 바뀐다.
  test('analyzed: false는 같은 요청에 실려 온 해시를 이긴다', async () => {
    stubUser(null);

    const res = await putBody({ analyzed: false, analyzedParamsHash: 'v1:0123456789abcdef' });

    expect(res.status).toBe(200);
    expect(mockedScenarioUpdate).toHaveBeenCalledWith({
      where: { id: SCENARIO_ID },
      data: { analyzedAt: null, analyzedParamsHash: null },
    });
  });

  // 키가 아예 없는 요청은 기존 값을 유지한다 — 해시를 모르는 호출(자동저장 등)이 남의 값을
  // 지우면 안 된다.
  test('해시 키가 없는 요청은 저장된 해시를 건드리지 않는다', async () => {
    stubUser(null);

    const res = await putBody({ analyzed: true });

    expect(res.status).toBe(200);
    expect(mockedScenarioUpdate).toHaveBeenCalledWith({
      where: { id: SCENARIO_ID },
      data: { analyzedAt: expect.any(Date) },
    });
  });

  // 검사 없이 Prisma로 넘기면 그 안에서 던져 일반 500이 되고, 클라이언트는 그것을
  // "서버가 죽었다"와 구분할 수 없다.
  test('형식이 맞지 않는 해시는 400으로 거절하고 아무것도 쓰지 않는다', async () => {
    for (const malformed of [123, {}, [], 'plain-string', 'v1:ZZZZ']) {
      mockedScenarioUpdate.mockClear();
      stubUser(null);

      const res = await putBody({ analyzed: true, analyzedParamsHash: malformed });

      expect(res.status).toBe(400);
      expect(mockedScenarioUpdate).not.toHaveBeenCalled();
    }
  });

  // 새 필드도 analyzedAt과 같은 길을 탄다. 잠금 판정에 끌려 들어가면 정상적으로 E2EE를
  // 쓰는 모든 계정에서 409가 난다.
  test('잠긴 계정에서도 해시를 포함한 분석 표시는 통과한다', async () => {
    stubUser(new Date('2026-01-01'));

    const res = await putBody({ analyzed: true, analyzedParamsHash: 'v1:0123456789abcdef' });

    expect(res.status).toBe(200);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  // 데이터를 건드리지 않는 요청이므로 잠금 판정에 관여하지 않는다. 여기서 막히면 잠긴 계정
  // (=정상적으로 E2EE를 쓰는 모든 계정)에서 분석 표시가 영영 저장되지 않는다.
  test('잠긴 계정에서도 분석 표시만 바꾸는 요청은 통과한다', async () => {
    stubUser(new Date('2026-01-01'));

    const res = await putBody({ analyzed: true });

    expect(res.status).toBe(200);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  // 데이터 저장과 분석 표시가 한 요청에 섞여 오면 둘 다 반영해야 한다.
  test('데이터와 함께 오면 둘 다 반영한다', async () => {
    stubUser(null);

    const res = await putBody({ data: encrypted, analyzed: true });

    expect(res.status).toBe(200);
    expect(mockedScenarioUpdate).toHaveBeenCalledWith({
      where: { id: SCENARIO_ID },
      data: { data: JSON.stringify(encrypted), analyzedAt: expect.any(Date) },
    });
  });

  test('남의 시나리오에는 분석 표시를 쓸 수 없다', async () => {
    stubUser(null);
    vi.mocked(prisma.scenario.findUnique).mockResolvedValue({
      id: SCENARIO_ID, userId: 'someone-else', name: 'x', isDefault: false,
      data: '{}', createdAt: new Date(0), updatedAt: new Date(0),
    } as never);

    const res = await putBody({ analyzed: true });

    expect(res.status).toBe(404);
    expect(mockedScenarioUpdate).not.toHaveBeenCalled();
  });
});

// 마지막 선택은 다음 로그인에서 그대로 열린다. 지운 시나리오를 계속 가리키게 두면 클라이언트가
// 매번 첫 시나리오로 되돌려야 하고, 그 정정 요청이 실패하면 어긋난 채로 남는다.
describe('DELETE /api/scenarios/[id] — 마지막 선택 정리', () => {
  test('지운 시나리오가 마지막 선택이었으면 비운다', async () => {
    stubUser(null, SCENARIO_ID);

    const res = await del(SCENARIO_ID);

    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.user.update)).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { lastActiveScenarioId: null },
    });
  });

  test('다른 시나리오를 가리키고 있었으면 건드리지 않는다', async () => {
    stubUser(null, 's2');

    const res = await del(SCENARIO_ID);

    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.user.update)).not.toHaveBeenCalled();
  });

  // 비교 목록도 다음 로그인에서 그대로 복원된다. 지운 id가 남아 있으면 클라이언트가 매번
  // 걸러 내야 하고, 그 정정이 올라가지 못하면 계정에는 없는 시나리오가 계속 남는다.
  test('지운 시나리오를 비교 목록에서도 빼낸다', async () => {
    stubUser(null, 's9', JSON.stringify(['s0', SCENARIO_ID, 's2']));

    const res = await del(SCENARIO_ID);

    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.user.update)).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { compareScenarioIds: JSON.stringify(['s0', 's2']) },
    });
  });

  test('비교 목록에 없으면 건드리지 않는다', async () => {
    stubUser(null, 's9', JSON.stringify(['s0', 's2']));

    const res = await del(SCENARIO_ID);

    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.user.update)).not.toHaveBeenCalled();
  });

  // 마지막 선택과 비교 목록을 각각 update하면 두 번째가 실패했을 때 절반만 정리된 상태가 남는다.
  test('마지막 선택과 비교 목록을 한 번에 정리한다', async () => {
    stubUser(null, SCENARIO_ID, JSON.stringify([SCENARIO_ID]));

    const res = await del(SCENARIO_ID);

    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.user.update)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.user.update)).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { lastActiveScenarioId: null, compareScenarioIds: null },
    });
  });

  test('기본 시나리오는 지울 수 없고 마지막 선택도 그대로다', async () => {
    stubUser(null, SCENARIO_ID);
    vi.mocked(prisma.scenario.findUnique).mockResolvedValue({
      id: SCENARIO_ID, userId: USER_ID, name: 'x', isDefault: true,
      data: '{}', createdAt: new Date(0), updatedAt: new Date(0),
    } as never);

    const res = await del(SCENARIO_ID);

    expect(res.status).toBe(400);
    expect(vi.mocked(prisma.scenario.delete)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.user.update)).not.toHaveBeenCalled();
  });
});
