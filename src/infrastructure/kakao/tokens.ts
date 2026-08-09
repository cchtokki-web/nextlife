import { prisma } from '../db/prisma';

/**
 * 카카오 토큰을 다루는 데 필요한 Account 행의 최소 형태. Prisma의 Account 전체를 요구하면
 * 테스트 픽스처가 쓸데없이 커진다.
 */
export interface KakaoTokenAccount {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
}

/**
 * 카카오 응답이 "액세스 토큰이 죽었다"를 뜻하는지.
 *
 * 카카오는 본문 code에 -401을 담아 주기도 하고 HTTP 401로 주기도 한다. 둘 다 봐야 한다.
 */
export function isKakaoAuthError(status: number, body: { code?: number } | null): boolean {
  return status === 401 || body?.code === -401;
}

/**
 * refresh_token으로 액세스 토큰을 재발급하고 Account 행에 반영한다.
 * 성공하면 새 access_token, refresh_token이 없거나 재발급이 실패하면 null. 절대 throw하지 않는다.
 *
 * 재발급 결과를 DB에 저장하는 것까지 여기서 하는 이유: 저장하지 않으면 같은 사용자의 다음
 * 요청이 또 죽은 토큰으로 시작해 매번 리프레시를 태운다.
 *
 * 이 로직이 왜 공유 모듈에 있어야 하는가 — 카카오 액세스 토큰은 6시간 남짓이고 NextAuth
 * 세션 JWT는 30일이다. 즉 카카오 API를 부르는 시점의 토큰은 대개 죽어 있다. 리프레시 재시도가
 * 예외 경로가 아니라 정상 경로에 가깝고, 그래서 호출처마다 복사되면 안 된다.
 */
export async function refreshKakaoAccessToken(account: KakaoTokenAccount): Promise<string | null> {
  if (!account.refresh_token) return null;

  try {
    const res = await fetch('https://kauth.kakao.com/oauth/token', {
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

    const data = await res.json();
    if (!res.ok || !data.access_token) return null;

    await prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: data.access_token,
        // 카카오는 refresh_token을 매번 주지 않는다. 없으면 쓰던 것을 유지해야 한다 —
        // null로 덮으면 다음 만료에서 재발급할 방법이 사라진다.
        refresh_token: data.refresh_token || account.refresh_token,
        expires_at: data.expires_in
          ? Math.floor(Date.now() / 1000) + data.expires_in
          : account.expires_at,
      },
    });

    return data.access_token as string;
  } catch (err) {
    console.error('Failed to refresh Kakao access token:', err);
    return null;
  }
}
