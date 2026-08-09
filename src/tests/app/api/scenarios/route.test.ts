import { describe, test, expect, vi, beforeEach } from 'vitest';

// authOptions는 next-auth adapter/bcrypt까지 끌고 오므로 더미로 바꾼다.
// 이 파일이 검증하는 것은 세션 판단이 아니라 E2EE 잠금 플래그의 수명이다.
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
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    scenario: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { getServerSession } from 'next-auth/next';
import { prisma } from '@/infrastructure/db/prisma';
import { GET, POST } from '@/app/api/scenarios/route';

const USER_ID = 'user-1';
const encrypted = { isEncrypted: true, ciphertext: 'abc', iv: 'def' };
const plain = { userProfile: { currentAge: 40 } };

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedFindUnique = vi.mocked(prisma.user.findUnique);
const mockedUpdateMany = vi.mocked(prisma.user.updateMany);

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
});
