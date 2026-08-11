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
// 0으로 깎지 않는 이유: MC 실패는 "계획한 생활비를 한 해라도 채우지 못한다"는 뜻이지 계획에
// 아무 가치가 없다는 뜻이 아니다. 자산 충분성·연금 커버율·인플레 방어력은 여전히 그 계획이
// 가진 것이고, 그 넷이 결정론 점수의 75점을 이룬다. 절반이 방어 가능한 최대 할인이다.
//
// **자산 보존 성공률을 여기에 곱하지 않는 이유**: calculateRetirementScore가 이미
// depletionAge를 입력으로 받아 자산 고갈 위험을 결정론 점수 안에 반영한다(longevityScore).
// 자산 축을 혼합에 또 넣으면 같은 사실로 두 번 깎는다. 생활 유지 축은 결정론 점수 어디에도
// 없는 정보라, 곱해야 할 것은 이쪽이다.
const MIN_CONFIDENCE_FACTOR = 0.5;

// 두 성공률. 화면·PDF·AI 조언이 전부 이 쌍을 함께 들고 다녀야 한다 — 이유는 아래 주석.
export interface PlanSuccessRates {
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
  // 판정에 쓴 확률(= spendingSuccessRate)과 함께 보여야 할 보조 확률.
  rates?: PlanSuccessRates;
  // 'deterministic'이면 화면은 "시장 변동성 미반영"을 밝혀야 한다. MC 워커를 못 쓰는
  // 환경이나 추천안 토글 중(추천안의 MC는 계산하지 않는다)이 그 상태다.
  basis: 'deterministic' | 'probabilistic';
}

// **밴드는 생활 유지 성공률로 정한다.**
//
// 사용자가 은퇴 계획에서 실제로 두려워하는 것은 "죽을 때 잔액이 0원인가"가 아니라 "살아
// 있는 동안 쓸 돈이 모자라는가"다. 국민연금 같은 종신소득이 있으면 투자자산이 바닥나도
// 생활은 유지될 수 있고, 그 경로를 실패로 부르면 계획을 잘못 판정하게 된다.
//
// **54인 페르소나 실측(`npm run harness:personas`)에서 이 전환이 바꾸는 것.** 밴드 분포는
// 거의 그대로이고(54명 중 1명만 이동), 실질적으로 달라지는 것은 상속 목표가 인출을 막는
// 계획이다. 「60대 중 상속 우선」은 자산 보존 100% / 생활 유지 32.8%로, 옛 기준에서는
// '매우 안정'이었지만 실제로는 세 번 중 두 번 계획한 생활비를 못 쓴다. 새 기준에서 그 계획은
// '위험'이 된다.
//
// ⚠️ 이 선택이 만드는 반대편 왜곡: 생활비를 아주 낮게 잡아 국민연금만으로 덮이는 계획은
// 자산이 전부 사라져도 생활 유지 성공률이 100%가 되어 '매우 안정'을 받는다(실측 54명에서는
// 그런 페르소나가 없었지만 구조적으로 가능하다). 그래서
//   (1) 화면은 두 확률을 **항상 함께** 보여주고(CoreKpiGrid·MonteCarloSection),
//   (2) 투자자산 소진 시점이 있으면 헤드라인이 반드시 그 사실을 말한다(heroHeadline).
// 이 두 장치가 빠지면 밴드 전환이 예전 왜곡을 다른 방향으로 되살린다.
export function computePlanConfidence(
  retirementScore: number,
  rates?: PlanSuccessRates
): PlanConfidence {
  if (rates === undefined) {
    return { score: retirementScore, deterministicScore: retirementScore, basis: 'deterministic' };
  }

  const clampedSpending = Math.min(1, Math.max(0, rates.spendingSuccessRate));
  const clampedAsset = Math.min(1, Math.max(0, rates.assetSuccessRate));
  return {
    score: Math.round(retirementScore * (MIN_CONFIDENCE_FACTOR + (1 - MIN_CONFIDENCE_FACTOR) * clampedSpending)),
    deterministicScore: retirementScore,
    band: getPlanConfidenceBand(clampedSpending),
    rates: { spendingSuccessRate: clampedSpending, assetSuccessRate: clampedAsset },
    basis: 'probabilistic',
  };
}
