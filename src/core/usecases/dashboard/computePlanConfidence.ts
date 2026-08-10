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
export const PLAN_CONFIDENCE_THRESHOLDS = {
  stable: 0.9, // 안정
  good: 0.8, // 양호
  caution: 0.7, // 주의
  risky: 0.5, // 위험
  // 그 미만: 매우 위험
} as const;

export type PlanConfidenceBand = '안정' | '양호' | '주의' | '위험' | '매우 위험';

export function getPlanConfidenceBand(successRate: number): PlanConfidenceBand {
  if (successRate >= PLAN_CONFIDENCE_THRESHOLDS.stable) return '안정';
  if (successRate >= PLAN_CONFIDENCE_THRESHOLDS.good) return '양호';
  if (successRate >= PLAN_CONFIDENCE_THRESHOLDS.caution) return '주의';
  if (successRate >= PLAN_CONFIDENCE_THRESHOLDS.risky) return '위험';
  return '매우 위험';
}

// 성공률이 점수를 깎는 폭. 성공률 100%면 결정론 점수 그대로, 0%면 절반이 된다.
//
// 0으로 깎지 않는 이유: MC 실패는 "기대수명 전에 자산이 바닥난다"는 뜻이지 계획에 아무
// 가치가 없다는 뜻이 아니다. 자산 충분성·연금 커버율·인플레 방어력은 여전히 그 계획이
// 가진 것이고, 그 넷이 결정론 점수의 75점을 이룬다. 절반이 방어 가능한 최대 할인이다.
const MIN_CONFIDENCE_FACTOR = 0.5;

export interface PlanConfidence {
  // 화면·PDF의 헤드라인 숫자.
  score: number;
  // 보정 전 결정론 점수(SimulationResult.retirementScore). 근거를 밝힐 때 쓴다.
  deterministicScore: number;
  // MC가 없으면 undefined — 그때는 밴드 판정 자체가 성립하지 않는다.
  band?: PlanConfidenceBand;
  successRate?: number;
  // 'deterministic'이면 화면은 "시장 변동성 미반영"을 밝혀야 한다. MC 워커를 못 쓰는
  // 환경이나 추천안 토글 중(추천안의 MC는 계산하지 않는다)이 그 상태다.
  basis: 'deterministic' | 'probabilistic';
}

export function computePlanConfidence(
  retirementScore: number,
  successRate?: number
): PlanConfidence {
  if (successRate === undefined) {
    return { score: retirementScore, deterministicScore: retirementScore, basis: 'deterministic' };
  }

  const clamped = Math.min(1, Math.max(0, successRate));
  return {
    score: Math.round(retirementScore * (MIN_CONFIDENCE_FACTOR + (1 - MIN_CONFIDENCE_FACTOR) * clamped)),
    deterministicScore: retirementScore,
    band: getPlanConfidenceBand(clamped),
    successRate: clamped,
    basis: 'probabilistic',
  };
}
