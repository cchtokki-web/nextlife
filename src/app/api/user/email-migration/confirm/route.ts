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
  isMergeableEmptyEmailAccount,
  occupiedEmailMessage,
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
      select: { securityKeyHash: true },
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
    if (conflictingOwner && !isMergeableEmptyEmailAccount(conflictingOwner)) {
      return NextResponse.json({ error: occupiedEmailMessage, code: 'ACCOUNT_MERGE_REQUIRED' }, { status: 409 });
    }

    const securityKeyHash = await bcrypt.hash(securityKey, 12);
    await prisma.$transaction([
      ...(conflictingOwner
        ? [
            // User와 관계없는 인증 토큰부터 지운다. Account/Scenario/Session은 아래 User 삭제에
            // cascade되지만 자동 통합 대상은 애초에 모두 0개여야 한다.
            prisma.verificationToken.deleteMany({
              where: {
                OR: [
                  { identifier: email },
                  { identifier: { startsWith: `email-migration:${conflictingOwner.id}:` } },
                ],
              },
            }),
            prisma.user.deleteMany({ where: { id: conflictingOwner.id } }),
          ]
        : []),
      prisma.user.update({
        where: { id: userId },
        data: {
          email,
          emailVerified: new Date(),
          securityKeyHash,
          emailMigrationCompletedAt: new Date(),
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
    });
  } catch (error) {
    console.error('Email migration confirmation failed:', error);
    return NextResponse.json({ error: '이메일 로그인 전환을 완료하지 못했습니다.' }, { status: 500 });
  }
}
