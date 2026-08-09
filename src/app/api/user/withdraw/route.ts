import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { prisma } from '@/infrastructure/db/prisma';
import { isRateLimited } from '@/core/utils/rateLimiter';
import { unlinkKakaoAccount } from '@/infrastructure/kakao/unlink';

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
    // 10분에 3회. 1회로 조이지 않는 이유는 아래 unlink-먼저 순서 때문이다 — 삭제가 실패하면
    // 재시도가 지정된 복구 경로인데, 1회면 보호하려던 사용자를 가둔다. 여기서 막는 대상은
    // DB가 아니라(한 번 성공하면 지울 것이 없다) 바깥으로 나가는 카카오 API 호출이다.
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

    // 카카오 계정을 함께 읽는다. Account는 onDelete: Cascade라, 사용자를 먼저 지우면
    // 액세스 토큰이 그 순간 사라져 unlink를 부를 방법이 영원히 없어진다.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { accounts: { where: { provider: 'kakao' } } },
    });

    // 이미 없는 계정. 탈퇴는 멱등하게 답한다 — 목표 상태에 이미 도달했는데 "탈퇴 실패"를
    // 띄우면(더블클릭, 동시 탭) 사용자는 계정이 남았다고 오해한다.
    if (!user) {
      return NextResponse.json({ success: true, kakaoUnlinked: false }, { status: 200 });
    }

    // unlink를 삭제보다 먼저 하는 이유는 실패했을 때의 복구 가능성이다.
    //   삭제 먼저 → unlink 실패: 토큰이 cascade로 사라져 아무도 다시 시도할 수 없다.
    //     카카오 '연결된 서비스'에 앱이 talk_message 권한과 함께 영영 남는다.
    //   unlink 먼저 → 삭제 실패: User 행이 그대로라 세션도 살아 있고, 사용자가 버튼을
    //     다시 누르면 된다. 카카오 unlink는 멱등이라 두 번째 호출도 안전하다.
    // 복구 가능한 실패를 택한다.
    const kakaoAccount = user.accounts[0] ?? null;
    const kakaoUnlinked = kakaoAccount ? await unlinkKakaoAccount(kakaoAccount) : false;

    // Scenario/Account/Session은 onDelete: Cascade로 함께 사라진다.
    // VerificationToken만 User와 관계가 없어 직접 지운다 —
    // 남겨 두면 같은 이메일로 재가입했을 때 예전 인증/비밀번호 재설정 토큰이 그대로 통한다.
    //
    // 이메일 전환 인증번호는 `email-migration:${userId}:` 접두사를 사용한다. 전환 도중 탈퇴하면
    // user.email이 여전히 null일 수 있으므로 사용자 ID 접두사도 반드시 함께 지운다.
    //
    // 트랜잭션은 이 두 문장만 감싼다. 위의 fetch를 안에 넣으면 카카오 왕복 동안 SQLite
    // 쓰기 락을 쥐고 있게 되어 다른 모든 쓰기를 막는다.
    await prisma.$transaction([
      // delete가 아니라 deleteMany인 이유: 위 findUnique와 여기 사이에 행이 사라져도
      // (더블클릭, 동시 탭) P2025로 던지지 않고 count 0으로 넘어간다.
      prisma.user.deleteMany({ where: { id: userId } }),
      prisma.verificationToken.deleteMany({
        where: {
          OR: [
            { identifier: { startsWith: `email-migration:${userId}:` } },
            ...(user.email ? [{ identifier: user.email }] : []),
          ],
        },
      }),
    ]);

    return NextResponse.json({ success: true, kakaoUnlinked }, { status: 200 });
  } catch (error) {
    console.error('Error withdrawing user:', error);
    return NextResponse.json(
      { error: '탈퇴 처리 중 오류가 발생했습니다. 다시 시도해 주세요.' },
      { status: 500 }
    );
  }
}
