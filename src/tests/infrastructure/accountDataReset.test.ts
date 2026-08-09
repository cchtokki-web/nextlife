import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'nextlife-account-reset-'));
const databaseUrl = `file:${resolve(temporaryDirectory, 'reset.db')}`;
const prismaCli = resolve(process.cwd(), 'node_modules/prisma/build/index.js');
const resetSql = resolve(process.cwd(), 'prisma/reset-account-data.sql');
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

function runPrisma(...args: string[]) {
  execFileSync(process.execPath, [prismaCli, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}

beforeAll(() => {
  runPrisma('db', 'push', '--skip-generate');
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('Docker 계정 데이터 초기화', () => {
  test('계정 종속 데이터만 삭제하고 분석 이벤트는 보존한다', async () => {
    const user = await prisma.user.create({ data: { email: 'legacy@example.com' } });
    await prisma.scenario.create({
      data: { userId: user.id, name: '기존 시나리오', data: '{}' },
    });
    await prisma.verificationToken.create({
      data: {
        identifier: user.email!,
        token: 'legacy-token',
        expires: new Date(Date.now() + 60_000),
      },
    });
    await prisma.analyticsEvent.create({
      data: { type: 'page_view', sessionId: 'legacy-session' },
    });

    runPrisma('db', 'execute', '--url', databaseUrl, '--file', resetSql);

    await expect(prisma.user.count()).resolves.toBe(0);
    await expect(prisma.scenario.count()).resolves.toBe(0);
    await expect(prisma.verificationToken.count()).resolves.toBe(0);
    await expect(prisma.analyticsEvent.count()).resolves.toBe(1);
  });
});
