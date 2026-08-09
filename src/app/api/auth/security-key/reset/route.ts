import bcrypt from 'bcrypt';
import { NextResponse } from 'next/server';
import { prisma } from '@/infrastructure/db/prisma';
import { sendSecurityKeyEmail } from '@/core/utils/emailSender';
import { isRateLimited } from '@/core/utils/rateLimiter';
import { generateSecurityKey } from '@/core/utils/securityKey';

const ACCEPTED_MESSAGE = '새 보안키를 받을 수 있는 계정이라면 입력한 이메일로 발송했습니다.';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: '올바른 이메일 주소를 입력해 주세요.' }, { status: 400 });
    }
    if (isRateLimited(`security-key-reset:${email}`, 2, 60 * 60 * 1000)) {
      return NextResponse.json({ error: '재발급 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, { status: 429 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, securityKeyHash: true, securityKeyResetPending: true },
    });

    // 이메일의 가입 여부를 응답으로 노출하지 않는다.
    if (!user?.email) return NextResponse.json({ message: ACCEPTED_MESSAGE });

    const newKey = generateSecurityKey();
    const newHash = await bcrypt.hash(newKey, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { securityKeyHash: newHash, securityKeyResetPending: true },
    });

    try {
      await sendSecurityKeyEmail(user.email, newKey);
    } catch (error) {
      // 메일을 받지 못했는데 기존 키까지 무효화되는 일을 막는다.
      await prisma.user.update({
        where: { id: user.id },
        data: {
          securityKeyHash: user.securityKeyHash,
          securityKeyResetPending: user.securityKeyResetPending,
        },
      });
      throw error;
    }

    return NextResponse.json({ message: ACCEPTED_MESSAGE });
  } catch (error) {
    console.error('Security key reset request failed:', error);
    return NextResponse.json({ error: '보안키를 재발급하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 });
  }
}
