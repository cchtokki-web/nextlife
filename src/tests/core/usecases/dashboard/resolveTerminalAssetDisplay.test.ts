import { describe, expect, test } from 'vitest';
import { resolveTerminalAssetDisplay } from '@/core/usecases/dashboard/resolveTerminalAssetDisplay';

/**
 * **「예상자산」이라는 한 단어가 화면에서 두 가지를 가리키던 것을 하나로 만든다.**
 *
 * 진단 카드는 결정론 1회 실행의 기말자산을, 추천 카드는 1000회 몬테카를로의 중앙값을
 * 보여줬다. 실측(51세·60세 은퇴·월 350만·90세)에서 그 둘은 11.44억과 2.67억이었다 — 같은
 * 계획인데 4배가 넘게 벌어진다. 기말자산 분포는 아래로 0에서 막히고 위로는 열려 있어
 * 심하게 우편향하고, 그래서 결정론 경로는 중앙값이 아니라 상위 1/3 지점(그 실측에서 68분위)이다.
 *
 * 두 숫자 모두 정직했지만 사용자에게는 "추천을 적용하면 자산이 반토막"으로 읽혔다. 어느
 * 기준을 쓸지는 표시 문구가 아니라 판정이므로 core에 둔다.
 */

const mc = (p50: number, trials = 1000) => ({
  endingAssets: { p10: 0, p50, p90: p50 * 3 },
  trials,
});

describe('resolveTerminalAssetDisplay', () => {
  test('몬테카를로가 아직 없으면 기준 수익률 경로의 값을 쓴다', () => {
    const display = resolveTerminalAssetDisplay(2_150_000_000, undefined);

    // 워커가 늦게 도착하는 동안 칸이 비면 사용자는 계산이 실패했다고 읽는다.
    expect(display.basis).toBe('deterministic');
    expect(display.amount).toBe(2_150_000_000);
    expect(display.trials).toBeNull();
  });

  test('몬테카를로가 있으면 중앙값을 쓰고 기준 수익률 값을 함께 든다', () => {
    const display = resolveTerminalAssetDisplay(2_150_000_000, mc(914_400_000));

    expect(display.basis).toBe('monte_carlo_median');
    expect(display.amount).toBe(914_400_000);
    // 부기 값을 버리면 자산 추이 차트가 끝나는 지점과 이 칸이 어긋난 채로 남는다.
    expect(display.deterministicAmount).toBe(2_150_000_000);
    expect(display.trials).toBe(1000);
  });

  test('중앙값이 0원이어도 기준 수익률 값으로 되돌아가지 않는다', () => {
    const display = resolveTerminalAssetDisplay(2_150_000_000, mc(0));

    // 0을 「값이 없다」로 다루면, 절반 넘는 시행에서 자산이 바닥나는 계획이 화면에서는
    // 21.5억이 남는 계획으로 보인다. 실측 픽스처에서 1000회 중 409회가 0원이었다.
    expect(display.basis).toBe('monte_carlo_median');
    expect(display.amount).toBe(0);
  });

  test('시행이 0회면 분위수를 믿지 않고 기준 수익률 경로로 되돌아간다', () => {
    const display = resolveTerminalAssetDisplay(2_150_000_000, mc(0, 0));

    // 시행이 없으면 p50은 표본이 아니라 빈 배열의 잔재다.
    expect(display.basis).toBe('deterministic');
    expect(display.amount).toBe(2_150_000_000);
  });
});
