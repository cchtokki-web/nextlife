'use client';

import { useSession, signOut } from 'next-auth/react';
import { clearLocalAccountData } from '../../../infrastructure/storage/clearLocalAccountData';

export type WithdrawOutcome = { ok: true } | { ok: false; message: string };

/** 서버가 요구하는 확인 문구. 사용자가 모달에 직접 입력하는 값과 같다. */
export const WITHDRAW_CONFIRM_PHRASE = '탈퇴';

// 실패 문구는 전부 "계정은 삭제되지 않았습니다"로 끝난다. 그렇지 않으면 사용자는 절반쯤
// 일어난 것인지 알 수 없고, 확인할 방법도 없다.
function withdrawFailureMessage(status: number, serverMessage?: string): string {
  if (status === 401) {
    return '로그인이 만료되었습니다. 다시 로그인한 뒤 탈퇴를 진행해 주세요. 계정은 삭제되지 않았습니다.';
  }
  if (status === 429) {
    return '너무 많은 요청입니다. 잠시 후 다시 시도해 주세요. 계정은 삭제되지 않았습니다.';
  }
  return serverMessage ?? '계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요. 계정과 데이터는 그대로 남아 있습니다.';
}

interface UseWithdrawAccountOptions {
  // 삭제가 확정된 뒤 signOut 직전에 부른다. useScenarios의 beforeunload 가드를 내려
  // "저장되지 않은 변경" 프롬프트가 이미 삭제된 계정 위에 뜨는 것을 막는다.
  onBeforeSignOut?: () => void;
}

/**
 * 탈퇴 시퀀스. 순서 자체가 불변식이다.
 *
 *   1. userId를 먼저 붙잡는다 — signOut 뒤에는 세션이 없어 보안키의 키 이름조차 만들 수 없다.
 *   2. 서버가 먼저다. 로컬을 먼저 지우면 삭제가 실패했을 때 서버에 남아 있는 데이터를 열
 *      열쇠만 사라진다. 계정은 살아 있는데 아무도 못 여는, 탈퇴보다 나쁜 상태다.
 *   3. 서버 성공이 확인된 뒤에만 로컬을 지운다.
 *   4. 가드를 내리고 마지막에 signOut.
 *
 * signOut은 절대 finally에 넣지 않는다. 모든 실패 경로가 그 앞에서 return하므로 오류 메시지는
 * 살아 있는 페이지에 렌더된다 — signOut은 실제 내비게이션이라 그 뒤 코드는 보장되지 않는다.
 */
export function useWithdrawAccount(
  { onBeforeSignOut }: UseWithdrawAccountOptions = {}
): () => Promise<WithdrawOutcome> {
  const { data: session } = useSession();

  return async () => {
    const userId = session?.user?.id;
    if (!userId) {
      return { ok: false, message: '로그인 정보를 확인할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.' };
    }

    let res: Response;
    try {
      res = await fetch('/api/user/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: WITHDRAW_CONFIRM_PHRASE }),
      });
    } catch (err) {
      console.error('Failed to reach withdraw endpoint:', err);
      return { ok: false, message: '네트워크에 연결하지 못했습니다. 계정은 삭제되지 않았습니다. 잠시 후 다시 시도해 주세요.' };
    }

    if (!res.ok) {
      // 본문 파싱 실패는 오류 사유를 모른다는 뜻일 뿐이므로 상태 코드로 판단한다.
      const body = await res.json().catch(() => null);
      return { ok: false, message: withdrawFailureMessage(res.status, body?.error) };
    }

    // 2xx면 성공이다. 본문 파싱 실패를 실패로 취급하면 이미 삭제된 계정에 대해 사용자가
    // 재시도하게 되고, 그 재시도는 401을 맞는다.
    clearLocalAccountData(userId);

    onBeforeSignOut?.();
    await signOut({ callbackUrl: '/' });
    return { ok: true };
  };
}
