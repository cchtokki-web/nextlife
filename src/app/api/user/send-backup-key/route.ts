import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/core/utils/authOptions';
import { prisma } from '@/infrastructure/db/prisma';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user || !(session.user as any).id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const body = await req.json();
    const { key } = body;

    if (!key || typeof key !== 'string' || key.trim().length !== 6) {
      return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
    }

    const isDevMode = process.env.NEXT_PUBLIC_DEV_MODE === 'true';
    
    // Retrieve Kakao account details
    const account = await prisma.account.findFirst({
      where: {
        userId: userId,
        provider: 'kakao',
      },
    });

    if (!account || !account.access_token) {
      if (isDevMode || userId === 'dev-mock-id' || userId === 'dev-user-id') {
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

    // Handle token refresh
    if ((resData.code === -401 || response.status === 401) && account.refresh_token) {
      console.log('Kakao access token expired. Attempting to refresh...');
      
      const tokenResponse = await fetch('https://kauth.kakao.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: process.env.KAKAO_CLIENT_ID || '',
          client_secret: process.env.KAKAO_CLIENT_SECRET || '',
          refresh_token: account.refresh_token,
        }),
      });

      const tokenData = await tokenResponse.json();

      if (tokenResponse.ok && tokenData.access_token) {
        await prisma.account.update({
          where: { id: account.id },
          data: {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token || account.refresh_token,
            expires_at: tokenData.expires_in ? Math.floor(Date.now() / 1000) + tokenData.expires_in : account.expires_at,
          },
        });

        const retryResponse = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
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
  } catch (error: any) {
    console.error('Error sending backup key via Kakao:', error);
    return NextResponse.json({ error: 'Failed to send backup key' }, { status: 500 });
  }
}
