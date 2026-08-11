import { StrategyRecommendation, UserProfile, UtilityBreakdown } from '../../../core/entities/types';
import { getRetirementGrade, RetirementGrade } from '../../../core/entities/retirementGrade';
import { PlanAssetStatus } from '../../../core/usecases/dashboard/resolvePlanAssetStatus';
import {
  getPlanConfidenceBand,
  PLAN_CONFIDENCE_BAND_LABEL,
} from '../../../core/usecases/dashboard/computePlanConfidence';
import { formatManwon } from '../../../core/usecases/utility/utilityAnalysis';

// LLM 폴백 경로. 인자가 길어져 위치 인자로는 호출부에서 무엇이 무엇인지 읽히지 않아,
// 새로 추가되는 값부터는 이름 있는 객체로 받는다.
export interface RuleBasedAdviceContext {
  // 자산 고갈과 자산 미보유를 가른다. 없으면(옛 호출부) 기존 동작을 그대로 유지한다.
  planAssetStatus?: PlanAssetStatus;
  // 고정소득이 목표 생활비의 몇 %를 충당하는지(SimulationResult.goalAchievementRate).
  goalAchievementRate?: number;
  // 고갈 없이 유지 가능한 월 생활비(SimulationResult.calculatedTargetSpending).
  // 화면의 과소비 배너가 쓰는 값과 같아야 두 문구가 같은 근거를 말한다.
  sustainableMonthlySpending?: number;
  // 자산 보존 성공률(기대수명까지 자산이 남을 확률).
  monteCarloSuccessRate?: number;
  // 생활 유지 성공률(계획한 생활비를 한 해도 줄이지 않을 확률). 판정의 1차 근거다.
  monteCarloSpendingSuccessRate?: number;
  // 은퇴~국민연금 개시 사이의 공백. 있으면 조언 우선순위가 인출 전략보다 앞선다.
  pensionGap?: { fromAge: number; toAge: number; years: number; bridgeAmount: number };
}

export function generateRuleBasedAdvice(
  score: number,
  monthlyTarget: number,
  isPro: boolean,
  userProfile?: UserProfile,
  depletionAge?: number | null,
  retirementGrade?: RetirementGrade,
  utility?: UtilityBreakdown,
  recommendation?: StrategyRecommendation,
  context: RuleBasedAdviceContext = {}
): string {
  const targetInManwon = Math.round(monthlyTarget / 10000);
  const grade = retirementGrade ?? getRetirementGrade(score);
  const {
    planAssetStatus, goalAchievementRate, sustainableMonthlySpending,
    monteCarloSuccessRate, monteCarloSpendingSuccessRate, pensionGap,
  } = context;

  // 확률이 있으면 판정은 **확률에서 나온다.** 예전에는 결정론 등급이 판정을 정하고 확률이
  // 뒤에 부연으로 붙어, 성공률 39%인 계획이 "안정 등급"으로 시작했다. LLM 경로의 규칙 4와
  // 같은 원칙이다 — 두 경로가 다른 기준으로 판정하면 Ollama 가용 여부가 진단을 바꾼다.
  const band =
    typeof monteCarloSpendingSuccessRate === 'number'
      ? getPlanConfidenceBand(monteCarloSpendingSuccessRate)
      : undefined;

  let statusText: string;
  let isFavorable: boolean;

  // 투자자산이 하나도 없는 계획은 엔진이 첫 해에 depletionAge를 잡는다. 아래 등급 분기를
  // 그대로 타면 "51세 무렵 자산이 고갈될 위험이 있어"라고 쓰는데, 고갈시킬 자산이 없다.
  if (planAssetStatus === 'no_investable_asset') {
    statusText =
      `등록된 투자자산이 없어 은퇴 후 생활비를 국민연금 등 고정소득에만 의존하는 계획으로, ` +
      `은퇴 준비도는 **${grade}** 등급(${score}점)입니다.`;
    isFavorable = false;
  } else if (band !== undefined && typeof monteCarloSpendingSuccessRate === 'number') {
    const spendingPercent = Math.round(monteCarloSpendingSuccessRate * 100);
    const assetClause = typeof monteCarloSuccessRate === 'number'
      ? `, 자산 보존 성공률은 **${Math.round(monteCarloSuccessRate * 100)}%**`
      : '';
    statusText =
      `시장 변동을 반영하면 계획한 생활비를 한 해도 줄이지 않을 확률은 **${spendingPercent}%**${assetClause}로, ` +
      `**${PLAN_CONFIDENCE_BAND_LABEL[band]}** 수준입니다(기준 수익률만 놓고 보면 은퇴 준비도 ${score}점 · ${grade}).`;
    isFavorable = band === 'very_stable' || band === 'stable';
  } else {
    switch (grade) {
      case '매우 안정':
      case '안정':
        statusText = `은퇴 준비도가 **${grade}** 등급(${score}점)으로, 기준 시나리오에서 자산이 안정적으로 유지될 것으로 예상됩니다(시장 변동성 미반영).`;
        isFavorable = true;
        break;
      case '보통':
        statusText = `은퇴 준비도는 **보통** 등급(${score}점)으로 양호하지만 일부 보완이 필요합니다(시장 변동성 미반영).`;
        isFavorable = true;
        break;
      case '주의':
      case '위험':
        statusText = depletionAge === null
          ? `은퇴 준비도가 **${grade}** 등급(${score}점)으로 다소 낮아 구조 개선이 필요합니다.`
          : `**${depletionAge}세** 무렵 자산이 고갈될 위험이 있어 **${grade}** 등급으로 평가됩니다.`;
        isFavorable = false;
        break;
    }
  }

  // 자산이 없는 계획에는 "투자금을 늘리거나 은퇴를 늦추라"는 일반 조언보다, 이미 계산된
  // 두 숫자(충당률·유지 가능액)를 그대로 말해 주는 쪽이 훨씬 구체적이다.
  let possibilityText: string;
  if (planAssetStatus === 'no_investable_asset') {
    const coverageClause = typeof goalAchievementRate === 'number'
      ? `목표 월 **${targetInManwon}만원** 중 고정소득으로 충당 가능한 비율은 약 **${goalAchievementRate}%**입니다.`
      : `목표 월 **${targetInManwon}만원**을 고정소득만으로 충당하기는 어렵습니다.`;
    const sustainableClause = typeof sustainableMonthlySpending === 'number' && sustainableMonthlySpending > 0
      ? ` 추가 저축 없이 유지 가능한 수준은 월 **${Math.round(sustainableMonthlySpending / 10000)}만원**입니다.`
      : ' 생활비를 낮추거나 은퇴 시점을 늦추고, 추가 저축·투자로 자산을 마련해야 합니다.';
    possibilityText = coverageClause + sustainableClause;
  } else {
    possibilityText = isFavorable
      ? `목표하신 월 **${targetInManwon}만원**의 생활비 유지가 가능할 것으로 보입니다.`
      : `목표 월 **${targetInManwon}만원** 유지를 위해 투자금을 늘리거나 은퇴를 늦추는 것을 추천합니다.`;
  }

  const hasImprovement = !!recommendation?.improved;
  // 신규 연금계좌 납입 레그(Phase 4-B)가 채택된 경우, 개선분의 일부는 "인출 전략 조정"이 아니라
  // 사용자가 계획 밖에서 새로 마련해 납입하는 자금에서 나온다. 이 단서를 빼면 헤드라인 문구가
  // 기존 자산만 재배치해도 그 점수에 도달하는 것처럼 읽힌다(단서가 지금은 체크리스트 항목
  // 라벨에만 있다).
  const newPensionCaveat = recommendation?.recommendedNewPensionContribution
    ? ' 다만 이 점수에는 연금 계좌를 새로 열어 월 75만원을 추가로 납입한다는 가정이 포함되어 있어, 기존 자산 재배치만으로는 전부 달성되지 않습니다.'
    : '';
  // 재배치할 자산이 없는 계획에서는 개선분이 "인출 전략 조정"이 아니라 국민연금 수령 시점과
  // 생활비 조정에서 나온다 — 문구가 없는 선택지를 가리키지 않도록 표현을 바꾼다.
  const improvementLever = planAssetStatus === 'no_investable_asset'
    ? '국민연금 수령 시점과 목표 생활비를 조정하면'
    : '인출 전략을 조정하면';
  const utilityText = hasImprovement
    ? ` AI 분석 결과, ${improvementLever} 평생 효용 점수를 **${recommendation!.currentUtility.score}점**에서 **${recommendation!.recommendedUtility.score}점**까지 높일 수 있습니다.${newPensionCaveat}`
    : '';

  // 연금 공백은 인출 전략보다 앞선다(LLM 경로의 규칙 5와 같은 우선순위). 은퇴 직후라 잔고가
  // 가장 크고 인출률도 가장 높은 구간이므로, "매도 순서를 바꾸세요"보다 먼저 말해야 한다.
  const pensionGapText = pensionGap
    ? ` 특히 ${pensionGap.fromAge}~${pensionGap.toAge}세 ${pensionGap.years}년은 국민연금 개시 전이라 생활비를 자산 인출로 메우는 구간이므로, ` +
      // 금액 포맷은 화면·PDF와 같은 함수를 쓴다. 직접 만원으로 나누면 "13,162만원"처럼
      // 억 단위가 접히지 않은 문자열이 나와, 같은 금액이 카드에서는 "1억 3,162만원"으로
      // 보이는데 조언에서는 다르게 읽힌다.
      `이 기간용 자금 약 **${formatManwon(pensionGap.bridgeAmount)}**을 변동성이 낮은 자산으로 따로 확보해 두시기 바랍니다.`
    : '';

  return `${statusText} ${possibilityText}${pensionGapText}${utilityText}`;
}
