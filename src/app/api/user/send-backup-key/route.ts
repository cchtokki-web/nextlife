import { NextResponse } from 'next/server';
import { getAppSession } from '@/core/utils/getAppSession';
import { prisma } from '@/infrastructure/db/prisma';
import { sendSecurityKeyEmail } from '@/core/utils/emailSender';
import { isRateLimited } from '@/core/utils/rateLimiter';
import { isSecurityKey, normalizeSecurityKey } from '@/core/utils/securityKey';
import bcrypt from 'bcrypt';

const SEND_FAILED_MESSAGE = '이메일로 보안키를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.';

export async function POST(req: Request) {
  try {
    const session = await getAppSession();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: '로그인이 필요합니다. 다시 로그인해 주세요.' }, { status: 401 });
    }

    if (isRateLimited(`send-backup-key:${userId}`, 5, 5 * 60 * 1000)) {
      return NextResponse.json({ error: '너무 많은 요청입니다. 잠시 후 다시 시도해 주세요.' }, { status: 429 });
    }

    const { key } = await req.json();
    if (!isSecurityKey(key)) {
      return NextResponse.json({ error: SEND_FAILED_MESSAGE }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user?.email) {
      return NextResponse.json({ error: '보안키를 받을 이메일 계정이 없습니다.' }, { status: 409 });
    }

    const normalizedKey = normalizeSecurityKey(key);
    // 재발급 키는 다음 로그인 자격증명이기도 하다. 메일 전송 전에 해시를 갱신해, 메일 전송이
    // 실패하더라도 화면에 표시되는 새 키로 다시 로그인할 수 있게 한다.
    await prisma.user.update({
      where: { id: userId },
      data: { securityKeyHash: await bcrypt.hash(normalizedKey, 12), emailVerified: new Date() },
    });
    await sendSecurityKeyEmail(user.email, normalizedKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending backup key via email:', error);
    return NextResponse.json({ error: SEND_FAILED_MESSAGE }, { status: 500 });
  }
}
