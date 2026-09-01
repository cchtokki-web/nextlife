import { isConfirmedHardGoal, isPlanEmbeddedGoal } from '../goals/goalSuccessConditions';
import { normalizeRetirementGoals } from '../../entities/retirementGoal';
import type { RetirementGoalType } from '../../entities/retirementGoal';
import type { MonteCarloResult } from '../../entities/montecarlo';
import type { SimulationParams } from '../../entities/types';

/**
 * Monte Carlo 판정의 단일 출처.
 *
 * **폴백을 만들지 않는 것이 이 파일의 존재 이유다.** 예전에는 PDF가 네 단계 폴백을 탔고
 * (simulationSuccessRate ?? goalSuccessProbability ?? confidence.rates?.goalSuccessProbability
 * ?? confidence.rates?.spendingSuccessRate ?? 0), 그 중 하나는 「고갈 여부를 묻지 않는」
 * 다른 지표였다(DashboardSection.tsx가 명시). 화면은 같은 체인을 짧게 다시 썼다. 두 곳이
 * 다른 숫자를 보일 수 있었고, 체인의 끝은 `?? 0`이라 "판정 못 함"과 "전멸"이 같은 0%로
 * 찍혔다.
 *
 * describeSuccessRates와 같은 자리에, 같은 이유로 둔다 — 판정 규칙은 전부 core의 것이고
 * 화면과 PDF는 같은 답을 인쇄해야 한다.
 */
export interface SimulationVerdict {
  available: boolean;
  trials: number;
  seed: number;
  goalSuccess: { rate: number; succeeded: number; failed: number };
  spendingFulfillment: { fullRate: number; averageRate: number | null };
  assetSurvival: { rate: number; throughAge: number };
  hardGoalSuccess: {
    rate: number;
    succeeded: number;
    failed: number;
    judged: RetirementGoalType[];
    unjudged: RetirementGoalType[];
    /**
     * 확정 HARD이지만 계획에 이미 반영되어 «조건으로 세지 않는» 목표(EARLY_RETIREMENT).
     * unjudged와 다른 말이다 — unjudged는 「이 비율이 반영하지 못했다」이고, planEmbedded는
     * 「반영할 필요 자체가 없다, 모든 시행이 이미 지킨다」다. 같은 자리에 넣으면 지켜진
     * 목표를 안 지켜진 것처럼 보고하게 된다.
     */
    planEmbedded: RetirementGoalType[];
  } | null;
}

const counts = (rate: number, trials: number) => ({
  rate,
  succeeded: Math.round(rate * trials),
  failed: trials - Math.round(rate * trials),
});

export function resolveSimulationVerdict(input: {
  monteCarlo?: MonteCarloResult;
  params: SimulationParams;
}): SimulationVerdict {
  const { monteCarlo, params } = input;

  if (!monteCarlo) {
    // 0을 내지 않는다. 0은 「전멸」이라는 다른 사실이다.
    const none = { rate: Number.NaN, succeeded: 0, failed: 0 };
    return {
      available: false, trials: 0, seed: 0,
      goalSuccess: none,
      spendingFulfillment: { fullRate: Number.NaN, averageRate: null },
      assetSurvival: { rate: Number.NaN, throughAge: 0 },
      hardGoalSuccess: null,
    };
  }

  const { trials } = monteCarlo;
  const hard = monteCarlo.goalConditions.hardRequirements;
  const anyHardRequirement = hard.spendingTarget || hard.assetSurvival || hard.terminalAsset;

  // 사용자가 확정 HARD로 고른 목표를 세 갈래로 가른다. 「확정」의 술어는
  // isConfirmedHardGoal 하나뿐이다(goalSuccessConditions.ts) — 여기서 다시 쓰면 두 파일이
  // 같은 뜻을 각자 들고 있게 된다.
  const confirmedHardGoals = Array.isArray(params.retirementGoals)
    ? normalizeRetirementGoals(params.retirementGoals).filter(isConfirmedHardGoal)
    : [];

  // **judged는 유형 멤버십이 아니라 「실제로 축을 켰는가」로 가른다.** goalConditions가
  // 이미 그 판단을 끝내 두었다 — hardRequirementGoals에 실제로 조건에 기여한 목표만 있다.
  // isQuantitativelyJudgedGoal(유형)로 가르면 목표액 UI가 없는 ASSET_GROWTH가 아무 축도
  // 켜지 못했는데도 「판정됨」으로 나온다(goalSuccessConditions.ts의 hardRequirementGoals
  // 주석 참조).
  const { hardRequirementGoals } = monteCarlo.goalConditions;
  const judgedTypes = new Set<RetirementGoalType>([
    ...hardRequirementGoals.spendingTarget,
    ...hardRequirementGoals.assetSurvival,
    ...hardRequirementGoals.terminalAsset,
  ]);

  const judged = confirmedHardGoals
    .filter((goal) => judgedTypes.has(goal.type)).map((goal) => goal.type);
  // EARLY_RETIREMENT는 조건으로 세지 않지만 계획에 이미 반영되어 있다 — unjudged(「반영되지
  // 않았다」)에 넣으면 지켜진 목표를 안 지켜진 것처럼 말하게 된다(goalSuccessConditions.ts의
  // isPlanEmbeddedGoal 주석 참조).
  const planEmbedded = confirmedHardGoals
    .filter((goal) => !judgedTypes.has(goal.type) && isPlanEmbeddedGoal(goal.type))
    .map((goal) => goal.type);
  const unjudged = confirmedHardGoals
    .filter((goal) => !judgedTypes.has(goal.type) && !isPlanEmbeddedGoal(goal.type))
    .map((goal) => goal.type);

  return {
    available: true,
    trials,
    seed: monteCarlo.seed,
    goalSuccess: counts(monteCarlo.goalSuccessProbability, trials),
    spendingFulfillment: {
      fullRate: monteCarlo.spendingSuccessRate,
      averageRate: monteCarlo.averageSpendingFulfillmentRate ?? null,
    },
    assetSurvival: { rate: monteCarlo.successRate, throughAge: monteCarlo.successAge },
    // 요구하는 HARD 조건이 하나도 없으면 모든 시행이 통과해 1이 된다. 그 숫자는 참이지만
    // 「HARD 목표를 다 지켰다」로 읽혀 오해를 부른다. 숫자가 아니라 부재로 표현한다.
    hardGoalSuccess: anyHardRequirement && monteCarlo.hardGoalSuccessProbability !== undefined
      ? { ...counts(monteCarlo.hardGoalSuccessProbability, trials), judged, unjudged, planEmbedded }
      : null,
  };
}
