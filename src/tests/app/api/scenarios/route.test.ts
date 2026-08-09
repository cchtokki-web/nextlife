import { describe, test, expect, vi, beforeEach } from 'vitest';

// authOptions는 next-auth adapter/bcrypt까지 끌고 오므로 더미로 바꾼다.
// 이 파일이 검증하는 것은 세션 판단이 아니라 E2EE 잠금 플래그의 수명이다.
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));
vi.mock('@/core/utils/authOptions', () => ({
  authOptions: {},
}));

vi.mock('@/core/utils/isDevMode', () => ({
  isDevMode: vi.fn(() => false),
}));

vi.mock('@/infrastructure/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    scenario: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { getServerSession } from 'next-auth/next';
import { prisma } from '@/infrastructure/db/prisma';
import { isDevMode } from '@/core/utils/isDevMode';
import { GET, POST } from '@/app/api/scenarios/route';

const USER_ID = 'user-1';
const encrypted = { isEncrypted: true, ciphertext: 'abc', iv: 'def' };
const plain = { userProfile: { currentAge: 40 } };

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedFindUnique = vi.mocked(prisma.user.findUnique);
const mockedUpdateMany = vi.mocked(prisma.user.updateMany);
const mockedIsDevMode = vi.mocked(isDevMode);
const mockedUserCreate = vi.mocked(prisma.user.create);

type ScenarioRow = { id: string; name: string; isDefault: boolean; data: string };

function stubUser(scenarios: ScenarioRow[], e2eeEnabledAt: Date | null) {
  mockedFindUnique.mockResolvedValue({
    id: USER_ID,
    e2eeEnabledAt,
    scenarios: scenarios.map(s => ({ ...s, userId: USER_ID, createdAt: new Date(0), updatedAt: new Date(0) })),
    simulationData: null,
  } as unknown as Awaited<ReturnType<typeof prisma.user.findUnique>>);
}

function row(id: string, data: unknown): ScenarioRow {
  return { id, name: id, isDefault: id === 's1', data: JSON.stringify(data) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetServerSession.mockResolvedValue({ user: { id: USER_ID } } as never);
  mockedUpdateMany.mockResolvedValue({ count: 1 });
  vi.mocked(prisma.scenario.count).mockResolvedValue(0);
  mockedIsDevMode.mockReturnValue(false);
});

describe('GET /api/scenarios — E2EE 잠금 플래그', () => {
  test('암호문이 있는데 플래그가 없으면 소급해 기록한다', async () => {
    stubUser([row('s1', encrypted)], null);

    const res = await GET(new Request('http://localhost/api/scenarios'));
    const body = await res.json();

    expect(body.e2eeEnabled).toBe(true);
    // 첫 쓰기를 기다리면 그 전에 다른 브라우저가 키 없이 열 수 있다.
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, e2eeEnabledAt: null },
      data: { e2eeEnabledAt: expect.any(Date) },
    });
  });

  // 이 케이스가 이 파일의 핵심이다. 예전에는 클라이언트가 payload 모양만 보고 키를 요구해서,
  // 평문 행이 하나 생기는 순간 그 계정은 어느 브라우저에서든 키 없이 열렸다.
  test('플래그가 서 있으면 지금 평문만 있어도 잠긴 계정으로 답한다', async () => {
    stubUser([row('s1', plain)], new Date('2026-01-01'));

    const res = await GET(new Request('http://localhost/api/scenarios'));
    const body = await res.json();

    expect(body.e2eeEnabled).toBe(true);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  test('키를 받은 적 없는 계정은 잠기지 않은 것으로 답한다', async () => {
    stubUser([row('s1', plain)], null);

    const res = await GET(new Request('http://localhost/api/scenarios'));
    const body = await res.json();

    expect(body.e2eeEnabled).toBe(false);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  test('시나리오가 없어도 플래그가 서 있으면 잠긴 계정으로 답한다', async () => {
    stubUser([], new Date('2026-01-01'));

    const res = await GET(new Request('http://localhost/api/scenarios'));
    const body = await res.json();

    expect(body.e2eeEnabled).toBe(true);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/scenarios — E2EE 잠금 플래그', () => {
  function postBody(data: unknown) {
    return new Request('http://localhost/api/scenarios', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', data, isDefault: false }),
    });
  }

  beforeEach(() => {
    mockedFindUnique.mockResolvedValue({ id: USER_ID, e2eeEnabledAt: null } as never);
    vi.mocked(prisma.scenario.create).mockResolvedValue({
      id: 's1', userId: USER_ID, name: 'x', isDefault: false,
      data: JSON.stringify(encrypted), createdAt: new Date(0), updatedAt: new Date(0),
    } as never);
  });

  test('암호문을 받으면 잠긴 계정으로 기록한다', async () => {
    await POST(postBody(encrypted));

    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, e2eeEnabledAt: null },
      data: { e2eeEnabledAt: expect.any(Date) },
    });
  });

  test('평문을 받으면 기록하지 않는다', async () => {
    await POST(postBody(plain));

    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  test('잠긴 계정에 평문을 쓰려 하면 거부하고 아무것도 만들지 않는다', async () => {
    mockedFindUnique.mockResolvedValue({ id: USER_ID, e2eeEnabledAt: new Date('2026-01-01') } as never);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(postBody(plain));

    expect(res.status).toBe(409);
    expect(vi.mocked(prisma.scenario.create)).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test('시나리오 생성이 실패하면 플래그를 세우지 않는다', async () => {
    vi.mocked(prisma.scenario.create).mockRejectedValue(new Error('db down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(postBody(encrypted));

    expect(res.status).toBe(500);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test.each([5, 6])('기존 시나리오가 %i개면 신규 생성을 막고 기존 행은 유지한다', async (count) => {
    vi.mocked(prisma.scenario.count).mockResolvedValue(count);

    const res = await POST(postBody(encrypted));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: '시나리오는 최대 5개까지만 생성할 수 있습니다.' });
    expect(vi.mocked(prisma.scenario.create)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.scenario.deleteMany)).not.toHaveBeenCalled();
  });

  test('기존 시나리오가 4개면 다섯 번째 생성을 허용한다', async () => {
    vi.mocked(prisma.scenario.count).mockResolvedValue(4);

    const res = await POST(postBody(encrypted));

    expect(res.status).toBe(201);
    expect(vi.mocked(prisma.scenario.create)).toHaveBeenCalled();
  });
});

// 세션 전략이 jwt라 User 행을 지워도 쿠키는 만료까지 살아 있다. 예전에는 이 라우트가 그
// 토큰만 보고 없는 행을 되살려서, 탈퇴한 사용자가 시뮬레이터를 한 번 열기만 해도 같은 id로
// 빈 계정이 부활했다.
describe('/api/scenarios — 삭제된 사용자 부활 차단', () => {
  function postBody() {
    return new Request('http://localhost/api/scenarios', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', data: encrypted, isDefault: false }),
    });
  }

  test('운영 모드에서 User 행이 없으면 GET이 401을 반환하고 사용자를 만들지 않는다', async () => {
    mockedFindUnique.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/scenarios'));

    expect(res.status).toBe(401);
    expect(mockedUserCreate).not.toHaveBeenCalled();
  });

  test('운영 모드에서 User 행이 없으면 POST가 401을 반환하고 사용자를 만들지 않는다', async () => {
    mockedFindUnique.mockResolvedValue(null);

    const res = await POST(postBody());

    expect(res.status).toBe(401);
    expect(mockedUserCreate).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.scenario.create)).not.toHaveBeenCalled();
  });

  // 과잉 게이팅으로 로컬 개발이 통째로 막히는 것을 잡는다. 개발 세션(dev-user-id)은
  // DB 행 없이 발급되므로 여기서 행이 만들어져야 한다.
  test('개발 모드에서 User 행이 없으면 행을 만들어 계속 진행한다', async () => {
    mockedIsDevMode.mockReturnValue(true);
    mockedFindUnique.mockResolvedValue(null);
    mockedUserCreate.mockResolvedValue({ id: USER_ID, e2eeEnabledAt: null, scenarios: [], simulationData: null } as never);

    const res = await GET(new Request('http://localhost/api/scenarios'));

    expect(res.status).toBe(200);
    expect(mockedUserCreate).toHaveBeenCalled();
  });
});
