import { prisma } from './prisma';

/**
 * "이 계정의 데이터는 보안키로 잠겨 있다"를 서버에 한 번 기록한다.
 *
 * 한 번 세워지면 내려가지 않는다. 초기화(handleResetAndReissueKey)도 새 키로 다시 암호화하므로
 * 계속 참이고, 시나리오를 모두 지워도 참으로 남아야 한다 — "지금 암호문이 있느냐"가 아니라
 * "이 계정에 키가 있느냐"를 뜻하는 값이기 때문이다. 그 구분이 이 플래그의 존재 이유다.
 *
 * 실패해도 호출자의 쓰기를 되돌리지 않는다. 다음 GET이 같은 판정으로 다시 기록을 시도한다.
 */
export async function markE2eeEnabled(userId: string): Promise<void> {
  try {
    // update가 아니라 updateMany + where로 거른다. 이미 세워진 값을 덮어써 시각이 밀리지 않고,
    // 동시 요청 두 개가 겹쳐도 한쪽만 쓴다.
    await prisma.user.updateMany({
      where: { id: userId, e2eeEnabledAt: null },
      data: { e2eeEnabledAt: new Date() },
    });
  } catch (error) {
    console.error('Failed to mark E2EE as enabled for user', userId, error);
  }
}
