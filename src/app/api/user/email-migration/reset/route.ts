import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { prisma } from '@/infrastructure/db/prisma';
import { sendSecurityKeyEmail } from '@/core/utils/emailSender';
import { isRateLimited } from '@/core/utils/rateLimiter';
import { generateSecurityKey } from '@/core/utils/securityKey';
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
    if (isRateLimited(`email-migration-reset:${userId}`, 2, 60 * 60 * 1000)) {
      return NextResponse.json({ error: '초기화 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, { status: 429 });
    }

    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!/^\S+@\S+\.\S+$/.test(email) || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: '이메일과 인증번호를 확인해 주세요.' }, { status: 400 });
    }

    const identifier = migrationIdentifier(userId, email);
    const verification = await prisma.verificationToken.findFirst({ where: { identifier } });
    const expectedCode = verification?.token.split('.')[0] ?? '';
    if (!verification || verification.expires < new Date() || !codesMatch(expectedCode, code)) {
      return NextResponse.json({ error: '인증번호가 올바르지 않거나 만료되었습니다.' }, { status: 400 });
    }

    const emailOwner = await prisma.user.findUnique({
      where: { email },
      select: emailAccountCandidateSelect,
    });
    const conflictingOwner = emailOwner?.id !== userId ? emailOwner : null;
    if (conflictingOwner && !isMergeableEmptyEmailAccount(conflictingOwner)) {
      return NextResponse.json({ error: occupiedEmailMessage, code: 'ACCOUNT_MERGE_REQUIRED' }, { status: 409 });
    }

    const newKey = generateSecurityKey();
    const securityKeyHash = await bcrypt.hash(newKey, 12);

    // 이메일 소유가 확인됐더라도 새 키 전달이 실패하면 데이터를 지우지 않는다.
    await sendSecurityKeyEmail(email, newKey);

    await prisma.$transaction([
      prisma.scenario.deleteMany({ where: { userId } }),
      ...(conflictingOwner
        ? [
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
          securityKeyResetPending: false,
          emailMigrationCompletedAt: new Date(),
          e2eeEnabledAt: null,
        },
      }),
      prisma.verificationToken.deleteMany({ where: { identifier } }),
    ]);

    return NextResponse.json({ success: true, mergedEmptyEmailAccount: Boolean(conflictingOwner) });
  } catch (error) {
    console.error('Email migration reset failed:', error);
    return NextResponse.json({ error: '데이터 초기화와 보안키 재발급을 완료하지 못했습니다.' }, { status: 500 });
  }
}
