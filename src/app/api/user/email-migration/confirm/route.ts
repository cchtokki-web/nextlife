import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { prisma } from '@/infrastructure/db/prisma';
import { sendSecurityKeyEmail } from '@/core/utils/emailSender';
import { isRateLimited } from '@/core/utils/rateLimiter';
import { isSecurityKey, normalizeSecurityKey } from '@/core/utils/securityKey';
import {
  emailAccountCandidateSelect,
} from '@/core/utils/emailAccountMerge';

const migrationIdentifier = (userId: string, email: string) => `email-migration:${userId}:${email}`;

function codesMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    if (isRateLimited(`email-migration-confirm:${userId}`, 10, 10 * 60 * 1000)) {
      return NextResponse.json({ error: '확인 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, { status: 429 });
    }

    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const securityKey = typeof body.securityKey === 'string' ? normalizeSecurityKey(body.securityKey) : '';
    if (!/^\S+@\S+\.\S+$/.test(email) || !/^\d{6}$/.test(code) || !isSecurityKey(securityKey)) {
      return NextResponse.json({ error: '이메일, 인증번호, 보안키를 모두 확인해 주세요.' }, { status: 400 });
    }

    const identifier = migrationIdentifier(userId, email);
    const verification = await prisma.verificationToken.findFirst({ where: { identifier } });
    const expectedCode = verification?.token.split('.')[0] ?? '';
    if (!verification || verification.expires < new Date() || !codesMatch(expectedCode, code)) {
      return NextResponse.json({ error: '인증번호가 올바르지 않거나 만료되었습니다.' }, { status: 400 });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        securityKeyHash: true,
        e2eeEnabledAt: true,
        scenarios: { where: { isDefault: true }, select: { id: true }, take: 1 },
      },
    });
    if (!currentUser) return NextResponse.json({ error: '계정을 찾을 수 없습니다.' }, { status: 404 });
    if (currentUser.securityKeyHash && !await bcrypt.compare(securityKey, currentUser.securityKeyHash)) {
      return NextResponse.json({ error: '현재 보안키가 올바르지 않습니다.' }, { status: 400 });
    }

    const emailOwner = await prisma.user.findUnique({
      where: { email },
      select: emailAccountCandidateSelect,
    });
    const conflictingOwner = emailOwner?.id !== userId ? emailOwner : null;

    const securityKeyHash = await bcrypt.hash(securityKey, 12);
    const hasCurrentDefault = currentUser.scenarios.length > 0;
    const inheritedDefaultId = !hasCurrentDefault ? conflictingOwner?.scenarios[0]?.id : undefined;
    const legacyScenarioCount = conflictingOwner?.simulationData && conflictingOwner._count.scenarios === 0 ? 1 : 0;
    const mergedScenarioCount = (conflictingOwner?._count.scenarios ?? 0) + legacyScenarioCount;

    await prisma.$transaction([
      ...(conflictingOwner ? [
        // 암호문은 원래 사용자 ID를 salt로 사용한다. 소유권을 옮기기 전에 그 ID를 남겨 두면
        // 클라이언트가 기존 이메일 계정 키로 열어 현재 키로 다시 암호화할 수 있다.
        prisma.scenario.updateMany({
          where: { userId: conflictingOwner.id, encryptionUserId: null },
          data: { encryptionUserId: conflictingOwner.id },
        }),
        // 중복 기본 시나리오가 GET 정리 과정에서 삭제되지 않도록 모두 보조 시나리오로 바꾸고,
        // 현재 계정에 기본 시나리오가 없을 때만 가장 오래된 하나를 아래에서 다시 지정한다.
        prisma.scenario.updateMany({
          where: { userId: conflictingOwner.id, isDefault: true },
          data: { isDefault: false },
        }),
        prisma.scenario.updateMany({
          where: { userId: conflictingOwner.id },
          data: { userId },
        }),
        ...(inheritedDefaultId ? [
          prisma.scenario.update({
            where: { id: inheritedDefaultId },
            data: { isDefault: true },
          }),
        ] : []),
        ...(legacyScenarioCount ? [
          prisma.scenario.create({
            data: {
              userId,
              encryptionUserId: conflictingOwner.id,
              name: hasCurrentDefault ? '이전 계정 기본 시나리오' : '기본 시나리오',
              isDefault: !hasCurrentDefault,
              data: conflictingOwner.simulationData!,
            },
          }),
        ] : []),
        prisma.verificationToken.deleteMany({
          where: {
            OR: [
              { identifier: email },
              { identifier: { startsWith: `email-migration:${conflictingOwner.id}:` } },
            ],
          },
        }),
        // 외부 로그인과 이전 세션은 이메일 전환 뒤 유지하지 않는다. 시나리오는 위에서 모두 옮겼다.
        prisma.user.deleteMany({ where: { id: conflictingOwner.id } }),
      ] : []),
      prisma.user.update({
        where: { id: userId },
        data: {
          email,
          emailVerified: new Date(),
          securityKeyHash,
          emailMigrationCompletedAt: new Date(),
          ...(!currentUser.e2eeEnabledAt && conflictingOwner?.e2eeEnabledAt
            ? { e2eeEnabledAt: conflictingOwner.e2eeEnabledAt }
            : {}),
        },
      }),
      prisma.verificationToken.deleteMany({ where: { identifier } }),
    ]);

    let keyEmailSent = true;
    try {
      await sendSecurityKeyEmail(email, securityKey);
    } catch (error) {
      keyEmailSent = false;
      console.error('Migrated security key email failed:', error);
    }

    return NextResponse.json({
      success: true,
      keyEmailSent,
      mergedEmptyEmailAccount: Boolean(conflictingOwner),
      mergedScenarioCount,
    });
  } catch (error) {
    console.error('Email migration confirmation failed:', error);
    return NextResponse.json({ error: '이메일 로그인 전환을 완료하지 못했습니다.' }, { status: 500 });
  }
}
