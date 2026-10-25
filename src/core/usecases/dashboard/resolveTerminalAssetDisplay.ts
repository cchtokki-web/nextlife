import type { MonteCarloResult } from '../../entities/montecarlo';

export type TerminalAssetBasis = 'monte_carlo_median' | 'deterministic';

export interface TerminalAssetDisplay {
  basis: TerminalAssetBasis;
  /** 화면에 크게 쓰는 값. basis가 정한다. */
  amount: number;
  /** 기준 수익률 경로(변동 없음)의 기말자산. 자산 추이 차트가 끝나는 지점과 같은 값이다. */
  deterministicAmount: number;
  /** 중앙값이 몇 회의 표본에서 나왔는지. 결정론으로 되돌아갔으면 null. */
  trials: number | null;
}

export type TerminalAssetMonteCarloInput = Pick<MonteCarloResult, 'endingAssets' | 'trials'>;

/**
 * 진단 카드의 「N세 예상자산」이 **어느 기준의 값인지**를 정한다.
 *
 * 몬테카를로가 끝났으면 중앙값을 쓴다. 같은 카드의 목표 달성 확률과 실패 시행 수가 이미
 * 몬테카를로인데 자산만 결정론 경로를 쓰면, 한 상자 안에서 두 기준이 섞인다 — "1000회 중
 * 328회에서 생활비를 채우지 못합니다" 바로 옆에 변동이 전혀 없는 경로의 기말자산이 선다.
 *
 * 결정론 값을 버리지 않고 함께 드는 이유는 자산 추이 차트다. 그 곡선은 흔들리지 않는다고
 * 가정한 경로라 결정론 값에서 끝나므로, 부기하지 않으면 KPI와 차트가 이유 없이 어긋난다.
 *
 * **중앙값이 0원인 것과 값이 없는 것을 구분한다.** 0을 falsy로 다루면 절반 넘는 시행에서
 * 자산이 바닥나는 계획이 화면에서는 가장 낙관적인 숫자를 받는다. 되돌아가는 조건은
 * 「측정되지 않았다」뿐이다 — 워커가 아직 결과를 주지 않았거나(undefined), 표본이 0회여서
 * 분위수가 빈 배열의 잔재인 경우.
 */
export function resolveTerminalAssetDisplay(
  deterministicTerminalAssets: number,
  monteCarlo: TerminalAssetMonteCarloInput | undefined,
): TerminalAssetDisplay {
  if (monteCarlo === undefined || monteCarlo.trials <= 0) {
    return {
      basis: 'deterministic',
      amount: deterministicTerminalAssets,
      deterministicAmount: deterministicTerminalAssets,
      trials: null,
    };
  }

  return {
    basis: 'monte_carlo_median',
    amount: monteCarlo.endingAssets.p50,
    deterministicAmount: deterministicTerminalAssets,
    trials: monteCarlo.trials,
  };
}
