import { SimulationParams, SimulationResult, UtilityBreakdown, UtilityConfig } from '../../entities/types';
import { DEFAULT_UTILITY_CONFIG } from './utilityWeights';

export interface CurrentStrategyAnalysis {
  strengths: string[];
  weaknesses: string[];
}

export function formatManwon(amountKRW: number): string {
  return `${Math.round(amountKRW / 10000).toLocaleString('ko-KR')}만원`;
}

const COMPONENT_LABELS: Record<keyof UtilityBreakdown['components'], string> = {
  consumption: '소비 만족도',
  depletionSafety: '자산 고갈 방지',
  // 국민연금 수급 여부 + 사적연금 실인출 활용도 + 저율과세 한도 준수도의 가중합 (UtilityEngine.computePensionUtilizationRaw 참조)
  pensionUtilization: '연금 활용도',
  taxEfficiency: '세금 효율',
  taxationRisk: '과세 위험 관리',
  bequestAdequacy: '상속 자산 적정성',
};

const STRENGTH_THRESHOLD = 0.8;
const WEAKNESS_THRESHOLD = 0.5;

// 현재(baseline) 전략의 Utility 구성요소 점수를 근거로 강점/약점을 텍스트로 요약한다.
// AI 추천 전략(RecommendationEngine)과 달리 baseline 자체의 특성을 설명하는 용도다.
export function analyzeCurrentStrategy(
  utility: UtilityBreakdown,
  cfg: UtilityConfig = DEFAULT_UTILITY_CONFIG
): CurrentStrategyAnalysis {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  (Object.keys(utility.components) as (keyof UtilityBreakdown['components'])[]).forEach((key) => {
    const score = utility.components[key];
    const max = cfg.weights[key];
    const ratio = max > 0 ? score / max : 0;
    const label = COMPONENT_LABELS[key];

    if (ratio >= STRENGTH_THRESHOLD) {
      strengths.push(`${label}이(가) ${score}/${max}점으로 우수합니다.`);
    } else if (ratio <= WEAKNESS_THRESHOLD) {
      weaknesses.push(`${label}이(가) ${score}/${max}점으로 개선 여지가 있습니다.`);
    }
  });

  if (strengths.length === 0) {
    strengths.push('두드러진 강점 항목은 없으나 전반적으로 균형 잡힌 전략입니다.');
  }
  if (weaknesses.length === 0) {
    weaknesses.push('뚜렷한 약점 항목은 발견되지 않았습니다.');
  }

  return { strengths, weaknesses };
}

// bequestAdequacy(상속 자산 적정성) 점수가 왜 그렇게 나왔는지 사용자가 이해할 수 있도록
// UtilityEngine.computeBequestAdequacyRaw와 동일한 산식(적정 잔여자산 = 월 목표생활비 *
// appropriateBequestMonths)을 근거로 구체적인 금액을 곁들여 설명한다.
export function explainBequestAdequacy(
  params: SimulationParams,
  result: SimulationResult,
  cfg: UtilityConfig = DEFAULT_UTILITY_CONFIG
): string {
  const appropriateBalance = params.userProfile.targetMonthlySpending * cfg.appropriateBequestMonths;
  if (appropriateBalance <= 0) {
    return '목표 월 생활비가 설정되지 않아 적정 상속 자산 기준을 계산할 수 없습니다.';
  }

  const ratio = result.endingAssets / appropriateBalance;
  if (ratio > 1) {
    return (
      `적정 상속 자산 기준(목표 월생활비 ${cfg.appropriateBequestMonths}개월치 = 약 ${formatManwon(appropriateBalance)})보다 ` +
      `예상 잔여자산(약 ${formatManwon(result.endingAssets)})이 약 ${ratio.toFixed(1)}배 많아 감점되었습니다. ` +
      `자산을 다 쓰지 못하고 남기는 것도 Lifetime Utility 관점에서는 비효율로 간주됩니다.`
    );
  }
  return (
    `예상 잔여자산(약 ${formatManwon(result.endingAssets)})이 적정 상속 자산 기준(약 ${formatManwon(appropriateBalance)}) 대비 부족합니다.`
  );
}
