import { SimulationParams } from '../../entities/types';
import { MonteCarloConfig } from '../../entities/montecarlo';

// 수익률 프리셋별 연 변동성(%p).
//
// **새 입력 UI를 만들지 않고 기존 리스크 성향 축에 얹는 이유**: 사용자는 이미 「투자 전략」
// 에서 성향을 고르는데, 그 선택이 기대수익률(applyYieldPreset)만 바꾸고 변동성은 그대로
// 두는 것이 오히려 비일관이었다. 노브를 하나 더 주면 두 값이 모순되는 조합(보수적 성향에
// 높은 변동성)을 사용자가 만들 수 있게 된다.
//
// 값의 근거: 글로벌 주식 연 변동성은 대체로 15~18%p, 채권 혼합은 10%p 안팎, 고베타
// 포트폴리오는 20%p 이상이다.
//
// **불확실**: 이 숫자들은 과거 시장 통계의 대략적 구간이지 특정 지수의 실측값이 아니다.
// 과거 수익률 시계열이 이 저장소에 없어 부트스트랩으로 대체할 수 없었다.
export const VOLATILITY_BY_YIELD_PRESET = {
  conservative: 10,
  base: 15,
  aggressive: 20,
} as const;

// 몬테카를로의 기본 시드.
//
// 고정 상수여야 하는 이유는 MonteCarloConfig.seed 주석에 있다 — 재현되지 않는 성공률은
// 사용자가 믿을 수 없는 숫자다.
export const DEFAULT_MONTE_CARLO_SEED = 20260101;

// 기본 시행 횟수.
//
// 1000회에서 성공률의 표준오차는 √(0.9 × 0.1 / 1000) ≈ 0.95%p로, 1%p 단위 표시에서
// 안정적이다. 그 이상은 표시 정밀도에 기여하지 않으면서 계산 시간만 늘린다.
export const DEFAULT_MONTE_CARLO_TRIALS = 1000;

/** Single source of truth for translating the existing return preset into market volatility. */
export function annualStdDevForYieldPreset(
  preset: SimulationParams['yieldPreset'],
  fallback: number = VOLATILITY_BY_YIELD_PRESET.base,
): number {
  return preset === 'conservative' || preset === 'base' || preset === 'aggressive'
    ? VOLATILITY_BY_YIELD_PRESET[preset]
    : fallback;
}

// 결정론 params에서 MC 설정을 유도한다. 저장되는 값이 아니다(MonteCarloConfig 주석).
export function resolveMonteCarloConfig(params: SimulationParams): MonteCarloConfig {
  // 'custom'이거나 미지정이면 base를 쓴다. custom은 사용자가 자산별 수익률을 직접
  // 정한 경우인데, 거기서 변동성을 추론할 방법이 없다(수익률과 변동성은 독립 입력이다).
  const annualStdDev = annualStdDevForYieldPreset(params.yieldPreset);

  return {
    trials: DEFAULT_MONTE_CARLO_TRIALS,
    seed: DEFAULT_MONTE_CARLO_SEED,
    annualStdDev,
  };
}
