// 결정론 준비도 점수에 몬테카를로 성공률을 반영해 "이 계획을 얼마나 믿을 수 있는가"를 낸다.
//
// **왜 엔진이 아니라 여기인가.**
//
// SimulationEngine.calculateRetirementScore는 순수 결정론이다. 거기에 MC를 넣으면
// (1) 대시보드의 모든 리렌더가 1000시행을 기다리고, (2) RecommendationEngine이 후보마다
// (최악 216+4개) MC를 돌려야 하며, (3) "한 번 계산해 5개 목표로 재채점" 불변식이 깨진다.
// UtilityEngine.ts:185-206에 같은 이유로 효용 축의 MC 재정의를 접은 기록이 남아 있다.
//
// 화면과 PDF는 이미 MC 결과를 손에 들고 있으므로(useMonteCarlo), 판정만 이 자리에서 합친다.
//
// **왜 합쳐야 하는가.**
//
// 실제 리포트에서 첫 페이지는 "은퇴 준비도 64점(주의)"이라 말하고, 뒷페이지는 "1,000회 중
// 37%만 90세까지 자산이 남음"이라 말했다. 두 문장은 같은 계획에 대한 것인데 사용자가 받는
// 인상은 정반대다. 64점은 "조금 부족하지만 괜찮다"로 읽히지만 실제 의미는 "시장 변동을
// 고려하면 10번 중 6번은 계획이 실패한다"에 가깝다.

// 성공률 구간별 판정. **점수가 아니라 성공률에서 직접 정한다** — 성공률이야말로 이 판정이
// 말하려는 것이고, 보정 점수를 다시 구간화하면 결정론 점수가 낮은 계획과 성공률이 낮은
// 계획이 같은 밴드에 섞인다.
//
// 구간을 5단계에서 6단계로 늘려 30% 미만을 따로 가른다 — 39%와 12%를 같은 '매우 위험'으로
// 뭉개면 "조정하면 되는 계획"과 "구조 자체를 다시 짜야 하는 계획"이 구분되지 않는다.
//
// **밴드를 표시 문구가 아니라 키로 돌려준다.** 두 가지 이유가 있다.
//   (1) heroHeadline·CoreKpiGrid·PDF의 verdictText/verdictAccent가 밴드로 분기하는데,
//       분기 대상이 한국어 문구면 카피 한 줄만 고쳐도 로직이 조용히 깨진다.
//   (2) 표시 라벨 집합(매우 안정~매우 위험)은 RetirementGrade를 완전히 포함한다. 둘 다
//       문자열 유니온이면 **은퇴 준비도 등급을 확률 밴드 자리에 넘겨도 컴파일이 통과한다.**
//       heroHeadline이 실제로 그 사고를 저지르고 있었다(효용 점수를 준비도 임계표로 등급화).
//       resolvePlanAssetStatus가 number 두 개를 거부한 것과 같은 종류의 방어다.
export type PlanConfidenceBandKey =
  | 'very_stable' | 'stable' | 'moderate' | 'caution' | 'risky' | 'very_risky';

// 키 이름을 옛 것(stable/good/caution/risky)에서 통째로 바꾼다. 같은 키에 다른 경계를 넣으면
// 기존 테스트가 고치지 않아도 통과해 버린다(0.9 → 옛 '안정' / 새 '매우 안정').
export const PLAN_CONFIDENCE_THRESHOLDS = {
  veryStable: 0.9,
  stable: 0.8,
  moderate: 0.7,
  caution: 0.5,
  risky: 0.3,
  // 그 미만: very_risky
} as const;

// 표시 라벨은 retirementGrade.ts의 RetirementGrade와 **같은 어휘**를 쓴다. 한 화면에 결정론
// 등급과 확률 밴드가 나란히 놓이는데 어휘가 다르면(예전의 '양호') 사용자는 둘을 비교할 수 없다.
export const PLAN_CONFIDENCE_BAND_LABEL: Record<PlanConfidenceBandKey, string> = {
  very_stable: '매우 안정',
  stable: '안정',
  moderate: '보통',
  caution: '주의',
  risky: '위험',
  very_risky: '매우 위험',
};

// 6밴드를 3색으로 접는 규칙. getRetirementGradeColorTier와 같은 관례를 따르되, 이쪽은
// 점수가 아니라 확률에서 나온다.
export const PLAN_CONFIDENCE_BAND_TIER: Record<PlanConfidenceBandKey, 'green' | 'orange' | 'red'> = {
  very_stable: 'green',
  stable: 'green',
  moderate: 'orange',
  caution: 'orange',
  risky: 'red',
  very_risky: 'red',
};

export function getPlanConfidenceBand(successRate: number): PlanConfidenceBandKey {
  if (successRate >= PLAN_CONFIDENCE_THRESHOLDS.veryStable) return 'very_stable';
  if (successRate >= PLAN_CONFIDENCE_THRESHOLDS.stable) return 'stable';
  if (successRate >= PLAN_CONFIDENCE_THRESHOLDS.moderate) return 'moderate';
  if (successRate >= PLAN_CONFIDENCE_THRESHOLDS.caution) return 'caution';
  if (successRate >= PLAN_CONFIDENCE_THRESHOLDS.risky) return 'risky';
  return 'very_risky';
}

// 성공률이 점수를 깎는 폭. 성공률 100%면 결정론 점수 그대로, 0%면 절반이 된다.
//
// 0으로 깎지 않는 이유: 확률 목표 실패가 계획에 가치가 전혀 없다는 뜻은 아니다. 연금 활용·
// 세금 효율 등 결정론 점수가 측정하는 다른 축은 남으므로 절반을 최대 할인으로 둔다.
const MIN_CONFIDENCE_FACTOR = 0.5;

// 전체 목표 확률과 그 구성축. 화면·PDF가 함께 들고 다녀야 낮은 원인을 구분할 수 있다.
export interface PlanSuccessRates {
  // 정량 판정 가능한 사용자 목표를 같은 시행에서 모두 만족한 비율. 레거시 MC 결과에는 없다.
  goalSuccessProbability?: number;
  // 생활비 부족이 한 해도 없던 시행 비율(MonteCarloResult.spendingSuccessRate).
  spendingSuccessRate: number;
  // 기대수명까지 자산이 고갈되지 않은 시행 비율(MonteCarloResult.successRate).
  assetSuccessRate: number;
}

export interface PlanConfidence {
  // 화면·PDF의 헤드라인 숫자.
  score: number;
  // 보정 전 결정론 점수(SimulationResult.retirementScore). 근거를 밝힐 때 쓴다.
  deterministicScore: number;
  // MC가 없으면 undefined — 그때는 밴드 판정 자체가 성립하지 않는다.
  band?: PlanConfidenceBandKey;
  // 판정에 쓴 전체 목표 확률(없으면 spendingSuccessRate 폴백)과 구성축.
  rates?: PlanSuccessRates;
  // 'deterministic'이면 화면은 "시장 변동성 미반영"을 밝혀야 한다. MC 워커를 못 쓰는
  // 환경이나 추천안 토글 중(추천안의 MC는 계산하지 않는다)이 그 상태다.
  basis: 'deterministic' | 'probabilistic';
}

// **전체 목표 성공확률이 있으면 밴드는 그 값으로 정하고, 레거시 결과만 생활 유지 성공률로
// 폴백한다.**
// 전체 목표 확률은 주변확률의 최솟값이 아니라 같은 Monte Carlo 시행에서 목표를 모두 만족한
// 교집합이다. 기존 캐시·테스트 픽스처처럼 이 필드가 없는 결과만 생활 유지 확률로 폴백한다.
export function computePlanConfidence(
  retirementScore: number,
  rates?: PlanSuccessRates
): PlanConfidence {
  if (rates === undefined) {
    return { score: retirementScore, deterministicScore: retirementScore, basis: 'deterministic' };
  }

  const clampedSpending = Math.min(1, Math.max(0, rates.spendingSuccessRate));
  const clampedAsset = Math.min(1, Math.max(0, rates.assetSuccessRate));
  const clampedGoal = rates.goalSuccessProbability === undefined
    ? undefined
    : Math.min(1, Math.max(0, rates.goalSuccessProbability));
  const primarySuccessRate = clampedGoal ?? clampedSpending;
  return {
    score: Math.round(retirementScore * (MIN_CONFIDENCE_FACTOR + (1 - MIN_CONFIDENCE_FACTOR) * primarySuccessRate)),
    deterministicScore: retirementScore,
    band: getPlanConfidenceBand(primarySuccessRate),
    rates: {
      spendingSuccessRate: clampedSpending,
      assetSuccessRate: clampedAsset,
      ...(clampedGoal === undefined ? {} : { goalSuccessProbability: clampedGoal }),
    },
    basis: 'probabilistic',
  };
}
