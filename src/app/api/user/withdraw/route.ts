import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { prisma } from '@/infrastructure/db/prisma';
import { isRateLimited } from '@/core/utils/rateLimiter';

/** 클라이언트가 사용자에게 입력받아 그대로 보내는 확인 문구. */
export const WITHDRAW_CONFIRM_PHRASE = '탈퇴';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    // 되돌릴 수 없는 작업이므로 어떤 부수효과보다 먼저 건다.
    //
    // 오배선이나 반복 요청으로 인한 과도한 삭제 시도를 제한한다.
    if (isRateLimited(`withdraw:${userId}`, 3, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: '너무 많은 요청입니다. 잠시 후 다시 시도해 주세요.' },
        { status: 429 }
      );
    }

    // 확인 문구. CSRF는 sameSite=lax 쿠키가 대체로 막아 주므로 이건 CSRF 방어가 아니다.
    // 오배선된 클라이언트(프리페치, 복붙한 fetch, 재시도 루프)가 계정을 사고로 날리는 것을
    // 막기 위한 것이다 — if 하나로 되돌릴 수 없는 작업에 의도 확인을 붙인다.
    const body = await req.json().catch(() => null);
    if (!body || body.confirm !== WITHDRAW_CONFIRM_PHRASE) {
      return NextResponse.json({ error: '탈퇴 확인 값이 올바르지 않습니다.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    // 이미 없는 계정. 탈퇴는 멱등하게 답한다 — 목표 상태에 이미 도달했는데 "탈퇴 실패"를
    // 띄우면(더블클릭, 동시 탭) 사용자는 계정이 남았다고 오해한다.
    if (!user) {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    // Scenario는 onDelete: Cascade로 함께 사라진다.
    // VerificationToken만 User와 관계가 없어 직접 지운다 —
    // 남겨 두면 같은 이메일로 재가입했을 때 예전 인증/비밀번호 재설정 토큰이 그대로 통한다.
    //
    await prisma.$transaction([
      // delete가 아니라 deleteMany인 이유: 위 findUnique와 여기 사이에 행이 사라져도
      // (더블클릭, 동시 탭) P2025로 던지지 않고 count 0으로 넘어간다.
      prisma.user.deleteMany({ where: { id: userId } }),
      prisma.verificationToken.deleteMany({
        where: {
          identifier: user.email ?? '',
        },
      }),
    ]);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error withdrawing user:', error);
    return NextResponse.json(
      { error: '탈퇴 처리 중 오류가 발생했습니다. 다시 시도해 주세요.' },
      { status: 500 }
    );
  }
}
