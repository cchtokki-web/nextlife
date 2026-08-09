import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { prisma } from '@/infrastructure/db/prisma';
import { sendEmailMigrationCode } from '@/core/utils/emailSender';
import { isRateLimited } from '@/core/utils/rateLimiter';

const migrationIdentifier = (userId: string, email: string) => `email-migration:${userId}:${email}`;

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: '올바른 이메일 주소를 입력해 주세요.' }, { status: 400 });
    }
    if (isRateLimited(`email-migration:${userId}`, 5, 10 * 60 * 1000)) {
      return NextResponse.json({ error: '인증번호 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, { status: 429 });
    }

    const emailOwner = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (emailOwner && emailOwner.id !== userId) {
      return NextResponse.json({ error: '이미 다른 계정에서 사용 중인 이메일입니다.' }, { status: 409 });
    }

    const identifier = migrationIdentifier(userId, email);
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const storedToken = `${code}.${crypto.randomBytes(16).toString('hex')}`;
    await prisma.verificationToken.deleteMany({ where: { identifier } });
    await prisma.verificationToken.create({
      data: { identifier, token: storedToken, expires: new Date(Date.now() + 10 * 60 * 1000) },
    });

    try {
      await sendEmailMigrationCode(email, code);
    } catch (error) {
      await prisma.verificationToken.deleteMany({ where: { identifier } });
      throw error;
    }

    return NextResponse.json({ message: '입력한 이메일로 인증번호를 보냈습니다.' });
  } catch (error) {
    console.error('Email migration code request failed:', error);
    return NextResponse.json({ error: '인증번호를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 });
  }
}
