import { SimulationParams } from '../../entities/types';
import { MonteCarloConfig } from '../../entities/montecarlo';
import { YIELD_PRESET_RATES } from '../scenario/applyYieldPreset';
import { weightedAverageTotalReturn } from '../returns/portfolioReturn';

// 수익률 프리셋별 연 변동성(%p).
//
// **새 입력 UI를 만들지 않는 이유**: 변동성은 사용자가 직접 입력하는 값이 아니다. 대신
// 아래 volatilityForStockReturn이 이 표의 세 점을 양 끝 앵커 삼아, 사용자가 실제로 입력한
// (자산 가중평균) 수익률에서 변동성을 선형으로 유도한다. 즉 이 표 자체는 화면에 노출되는
// 축이 아니라 그 유도선의 좌표일 뿐이다 — base 값은 자산이 없어 유도할 수 없을 때의
// 폴백으로도 쓰인다(derivedVolatility 참조).
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
// **문턱이 아니라 예산이 이 값을 정한다.** 한때 1000회였고 근거는 「√(0.9×0.1/1000) ≈
// 0.95%p라 1%p 단위 표시에서 안정적」이었다. 계산은 맞지만 결론이 반대였다 — 표준오차가
// 표시 단위와 «같은 크기»면 마지막 자리를 믿을 수 없다. 그래서 10000회까지 올려 봤고,
// 95% 구간의 반폭은 ±0.59%p가 됐다.
//
// 그런데 그 사이에 화면과 PDF가 신뢰구간을 «함께 인쇄»하게 됐다
// (resolveSimulationVerdict.confidence). 구간을 밝히는 순간 「반폭이 표시 단위보다 작아야
// 한다」는 요구는 힘을 잃는다 — 정밀도가 얼마든 사용자가 그것을 보고 판단하기 때문이다.
// 문턱이 필요했던 것은 숫자가 «홀로» 서 있을 때뿐이었다.
//
// 남은 것은 정밀도와 실행 시간의 맞바꿈이고, 실측은 이렇다(0.44ms/시행, p=0.9 기준 반폭):
//
//   시행수    대시보드   옵티마이저   반폭
//    1,000      0.5s       2.2s     ±1.86%p   ← 표시 단위의 두 배 가까이
//    3,000      1.5s       4.7s     ±1.07%p   ← 현재
//    5,000      2.6s       7.0s     ±0.83%p
//   10,000      4.9s      13.3s     ±0.59%p   ← 옵티마이저가 너무 느리다
//
// 3000회를 고른 이유는 옵티마이저다. 사용자는 전략 추천을 받으려고 그 워커를 기다리는데,
// 13초는 「멈춘 것 아닌가」로 읽히는 길이다. 4.7초는 기다릴 만하고, 그 대가인 ±1.07%p는
// 구간으로 정직하게 공시된다.
//
// 둘 다 Web Worker라 메인 스레드는 멈추지 않는다. computeSequenceRisk는 이 config에서
// annualStdDev와 seed만 읽으므로(sequenceRisk.ts) 메인 스레드 비용은 늘지 않는다.
//
// **이 값을 «모든» 몬테카를로가 쓰는 것은 아니다.** 스크리닝(StrategyOptimizer의
// screeningTrials, 200)과 증액 게이트(SPENDING_INCREASE_GATE.trials, 300)는 각각
// 순위 매기기와 이진 판정이라 표시 정밀도가 필요 없고, 각자의 주석에 근거가 있다.
// 그쪽은 후보 수만큼 곱해지는 항이라 함께 올리면 비용만 커지고 결과는 같다.
export const DEFAULT_MONTE_CARLO_TRIALS = 3000;

// **직접 입력한 수익률 → 연 변동성.**
//
// 예전에는 프리셋을 고르지 않은 사용자 — 즉 「입력 수익률 유지」(기본값)와 「사용자
// 직접입력」을 고른 사람 전부 — 가 자산에 3%를 넣든 12%를 넣든 같은 15%p로 계산됐다.
// **수익률만 사용자 값을 쓰고 변동성은 남의 프리셋을 쓰는 비대칭**이었다.
//
// 새 숫자를 만들지 않는다. 저장소의 두 표가 이미 세 쌍의 (수익률, 변동성)을 갖고 있고,
// 그 세 점이 한 직선 위에 오차 없이 놓인다:
//   안정형 5% → 10%p · 중립형 7% → 15%p · 공격형 9% → 20%p
// 양 끝 앵커로 직선을 긋고 그 위에 사용자의 수익률을 얹는다. 기울기를 상수로 적어 두면
// 두 표를 고쳤을 때 이 선만 옛 값에 남으므로, 매번 표에서 계산한다.
//
// **불확실**: 두 표 모두 근거가 기록된 적이 없다(YIELD_PRESET_RATES 주석은 base·aggressive
// 값의 출처가 없다고 명시하고, VOLATILITY_BY_YIELD_PRESET은 "대략적 구간이지 실측값이
// 아니다"라고 적혀 있다). 세 점이 정확히 선형인 것은 우연일 가능성이 높다. 그럼에도 이
// 유도를 쓰는 이유는 위의 비대칭이 더 나쁘기 때문이지, 이 직선이 옳다고 볼 근거가 있어서가
// 아니다. 실측 변동성 자료가 생기면 이 함수부터 갈아낄 자리다.
export function volatilityForStockReturn(stockReturnPercent: number): number {
  // 표가 `as const`라 값이 리터럴 타입이 된다. number로 넓히지 않으면 아래 0 나눗셈 가드가
  // 「9와 5는 겹칠 수 없다」는 타입 오류가 된다 — 지금의 표에서는 참이지만, 그 가드는 표를
  // 고칠 미래를 위한 것이다.
  const lowReturn: number = YIELD_PRESET_RATES.conservative.stockGrowth;
  const highReturn: number = YIELD_PRESET_RATES.aggressive.stockGrowth;
  const lowVol: number = VOLATILITY_BY_YIELD_PRESET.conservative;
  const highVol: number = VOLATILITY_BY_YIELD_PRESET.aggressive;

  // 두 앵커의 수익률이 같아지면(표를 그렇게 고치면) 직선을 그을 수 없다. 0으로 나누는
  // 대신 유도를 포기하고 중립형으로 떨어뜨린다 — 화면이 NaN을 인쇄하는 것보다 낫다.
  if (highReturn === lowReturn) return VOLATILITY_BY_YIELD_PRESET.base;

  const slope = (highVol - lowVol) / (highReturn - lowReturn);
  const derived = lowVol + slope * (stockReturnPercent - lowReturn);

  // **구간 밖으로 나가지 않는다.** 저장소가 근거를 표명한 범위는 [안정형, 공격형]뿐이고,
  // 그 밖에서는 곧 음수 변동성이 나온다(이 직선에서 수익률 1%가 0%p다).
  return Math.min(highVol, Math.max(lowVol, derived));
}

// 결정론 params에서 MC 설정을 유도한다. 저장되는 값이 아니다(MonteCarloConfig 주석).
export function resolveMonteCarloConfig(params: SimulationParams): MonteCarloConfig {
  // **언제나 실제 수익률에서 유도한다.** 예전에는 params.yieldPreset을 먼저 읽었는데,
  // 프리셋이 수익률을 지배하던 시절에는 "유도해도 같은 값이 나온다"가 성립했다.
  // 그 지배가 사라진 뒤로 이 분기는 옛 프리셋 값에 변동성을 묶어 두는 일만 한다 —
  // 화면은 strategy.riskProfile만 바꾸고 yieldPreset은 그대로 두기 때문이다.
  return {
    trials: DEFAULT_MONTE_CARLO_TRIALS,
    seed: DEFAULT_MONTE_CARLO_SEED,
    annualStdDev: derivedVolatility(params),
  };
}

function derivedVolatility(params: SimulationParams): number {
  const averageReturn = weightedAverageTotalReturn(params);
  return averageReturn === null
    ? VOLATILITY_BY_YIELD_PRESET.base
    : volatilityForStockReturn(averageReturn);
}
