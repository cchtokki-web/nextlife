import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { prisma } from '@/infrastructure/db/prisma';
import { isDevMode } from '@/core/utils/isDevMode';
import { isRateLimited } from '@/core/utils/rateLimiter';
import { isKakaoAuthError, refreshKakaoAccessToken } from '@/infrastructure/kakao/tokens';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // 5분에 5회. 정상 흐름 하나가 최초 발급 1 + 재시도 2 + 초기화 재발급 1을 쓸 수 있어
    // 3회면 문제가 없는 사용자도 429를 맞는다. 각 발송은 본인 채팅방으로 가는 메모 1건이다.
    if (isRateLimited(`send-backup-key:${userId}`, 5, 5 * 60 * 1000)) {
      return NextResponse.json({ error: '너무 많은 요청입니다. 잠시 후 다시 시도해 주세요.' }, { status: 429 });
    }

    const body = await req.json();
    const { key } = body;

    if (!key || typeof key !== 'string' || key.trim().length !== 6) {
      return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
    }

    // Retrieve Kakao account details
    const account = await prisma.account.findFirst({
      where: {
        userId: userId,
        provider: 'kakao',
      },
    });

    if (!account || !account.access_token) {
      if (isDevMode() || userId === 'dev-mock-id' || userId === 'dev-user-id') {
        console.log(`[MOCK KAKAO MESSAGE] TO: ${session.user.name || 'User'}, KEY: ${key.toUpperCase()}`);
        return NextResponse.json({ success: true, message: 'Mock sent successfully (Dev Mode)' });
      }
      return NextResponse.json({ error: 'Kakao account or access token not found. Please log in with Kakao.' }, { status: 404 });
    }

    const templateObject = {
      object_type: 'text',
      text: `[NextLife] 회원님의 은퇴 자산 시뮬레이션 보안키입니다.\n\n🔑 보안키: ${key.toUpperCase()}\n\n기기를 변경하거나 브라우저 캐시를 삭제했을 때 데이터를 안전하게 복구하려면 이 키를 입력해 주세요.`,
      link: {
        web_url: process.env.NEXTAUTH_URL || 'http://localhost:3000',
        mobile_web_url: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      },
      button_title: '시뮬레이터로 이동',
    };

    const response = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${account.access_token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        template_object: JSON.stringify(templateObject),
      }),
    });

    const resData = await response.json();

    if (response.ok && resData.result_code === 0) {
      return NextResponse.json({ success: true });
    }

    // 액세스 토큰이 죽었으면 재발급 후 한 번 재시도한다. 재발급/저장 로직은 탈퇴의
    // unlink와 공유한다(infrastructure/kakao/tokens.ts) — 카카오 토큰은 6시간이고 세션
    // JWT는 30일이라 이 경로는 두 호출처 모두에서 예외가 아니라 흔한 경로다.
    if (isKakaoAuthError(response.status, resData)) {
      console.log('Kakao access token expired. Attempting to refresh...');
      const newAccessToken = await refreshKakaoAccessToken(account);

      if (newAccessToken) {
        const retryResponse = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${newAccessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            template_object: JSON.stringify(templateObject),
          }),
        });

        const retryResData = await retryResponse.json();
        if (retryResponse.ok && retryResData.result_code === 0) {
          return NextResponse.json({ success: true });
        }
        return NextResponse.json({ error: `Kakao API retry failed: ${JSON.stringify(retryResData)}` }, { status: 400 });
      }
    }

    return NextResponse.json({ error: `Kakao API failed: ${JSON.stringify(resData)}` }, { status: 400 });
  } catch (error) {
    console.error('Error sending backup key via Kakao:', error);
    return NextResponse.json({ error: 'Failed to send backup key' }, { status: 500 });
  }
}
