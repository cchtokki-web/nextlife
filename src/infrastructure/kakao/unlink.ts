import { KakaoTokenAccount, isKakaoAuthError, refreshKakaoAccessToken } from './tokens';

const UNLINK_URL = 'https://kapi.kakao.com/v1/user/unlink';

async function callUnlink(accessToken: string): Promise<{ ok: boolean; status: number; body: { code?: number } | null }> {
  const res = await fetch(UNLINK_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

/**
 * 카카오 앱 연결을 끊는다. 성공 여부만 boolean으로 돌려주고 절대 throw하지 않는다 —
 * 호출자(탈퇴)는 이 결과와 무관하게 계정 삭제를 진행해야 하므로, 여기서 던지면 DNS 문제
 * 하나가 탈퇴 전체를 중단시킨다.
 *
 * 401을 "이미 연결이 끊겼다"로 해석하면 안 된다. 토큰 만료와 연결 해제는 다른 사건이고,
 * 카카오 액세스 토큰(약 6시간)은 세션 JWT(30일)보다 훨씬 짧아서 탈퇴 시점의 토큰은 대개
 * 죽어 있다. 401에서 포기하면 대다수의 unlink가 조용히 no-op이 된다 — 사용자의 카카오
 * '연결된 서비스' 목록에 앱이 그대로 남는다.
 */
export async function unlinkKakaoAccount(account: KakaoTokenAccount): Promise<boolean> {
  if (!account.access_token) return false;

  try {
    const first = await callUnlink(account.access_token);
    if (first.ok) return true;

    if (!isKakaoAuthError(first.status, first.body)) {
      console.error('Kakao unlink failed:', first.status, first.body);
      return false;
    }

    const refreshed = await refreshKakaoAccessToken(account);
    if (!refreshed) return false;

    const retry = await callUnlink(refreshed);
    if (!retry.ok) {
      console.error('Kakao unlink retry failed:', retry.status, retry.body);
    }
    return retry.ok;
  } catch (err) {
    console.error('Kakao unlink threw:', err);
    return false;
  }
}
