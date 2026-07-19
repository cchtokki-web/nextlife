import { UtilityBreakdown, UtilityConfig } from '../../entities/types';
import { DEFAULT_UTILITY_CONFIG } from './utilityWeights';

export interface CurrentStrategyAnalysis {
  strengths: string[];
  weaknesses: string[];
}

const COMPONENT_LABELS: Record<keyof UtilityBreakdown['components'], string> = {
  consumption: '소비 만족도',
  depletionSafety: '자산 고갈 방지',
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
