import { SimulationParams, SimulationResult, UtilityBreakdown, UtilityConfig } from '../../entities/types';
import { DEFAULT_UTILITY_CONFIG } from './utilityWeights';
import { isMaximizeBequestStrategy } from '../strategy/compileStrategy';

export interface CurrentStrategyAnalysis {
  strengths: string[];
  weaknesses: string[];
}

// 1억원(=10,000만원) 이상이면 "N억 M,MMM만원"으로 나눠 표기해 큰 금액도 한눈에 읽히게 한다.
// AI 노후 설계사 문구(예: "179,169만원")처럼 자릿수가 많은 순수 만원 표기가 되지 않도록 하는 목적.
export function formatManwon(amountKRW: number): string {
  const manwon = Math.round(amountKRW / 10000);
  const sign = manwon < 0 ? '-' : '';
  const absManwon = Math.abs(manwon);
  const eok = Math.floor(absManwon / 10000);
  const rest = absManwon % 10000;

  if (eok === 0) return `${sign}${absManwon.toLocaleString('ko-KR')}만원`;
  if (rest === 0) return `${sign}${eok.toLocaleString('ko-KR')}억원`;
  return `${sign}${eok.toLocaleString('ko-KR')}억 ${rest.toLocaleString('ko-KR')}만원`;
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
  const { targetBequest } = params.userProfile;

  // "최대 상속"은 단조증가로 채점되므로(UtilityEngine.monotonicAdequacyRaw) "많이 남아서
  // 감점되었다"는 아래 문구를 쓰면 화면과 점수가 정반대를 말하게 된다. 판정은 채점과 같은
  // 함수(isMaximizeBequestStrategy)를 쓴다.
  if (isMaximizeBequestStrategy(params)) {
    if (result.endingAssets <= 0) {
      return '최대 상속을 목표로 하셨지만 예상 잔여자산이 남지 않아 상속 자산 적정성 점수를 받지 못했습니다.';
    }
    const appropriateBalance = params.userProfile.targetMonthlySpending * cfg.appropriateBequestMonths;
    if (appropriateBalance <= 0) {
      return `최대 상속을 목표로 하셨고, 예상 잔여자산은 약 ${formatManwon(result.endingAssets)}입니다. 많이 남길수록 점수가 올라갑니다.`;
    }
    return (
      `최대 상속을 목표로 하셨습니다. 예상 잔여자산(약 ${formatManwon(result.endingAssets)})은 적정 상속 자산 기준` +
      `(목표 월생활비 ${cfg.appropriateBequestMonths}개월치 = 약 ${formatManwon(appropriateBalance)})의 ` +
      `약 ${(result.endingAssets / appropriateBalance).toFixed(1)}배이며, 많이 남길수록 점수가 올라갑니다.`
    );
  }

  // 사용자가 목표 상속자산을 직접 지정한 경우: UtilityEngine.computeBequestAdequacyRaw와
  // 동일한 산식(0원은 "다 쓰고 가기"라 분모 0으로 처리)을 근거로 설명 문구를 만든다.
  if (targetBequest !== undefined) {
    if (targetBequest <= 0) {
      if (result.endingAssets <= 0) {
        return '목표 상속자산을 0원(다 쓰고 가기)으로 설정하셨고, 예상대로 자산을 모두 소진할 것으로 예상됩니다.';
      }
      return (
        `목표 상속자산을 0원(다 쓰고 가기)으로 설정하셨지만, 예상 잔여자산이 약 ${formatManwon(result.endingAssets)} 남아 감점되었습니다. ` +
        `자산을 다 쓰지 못하고 남기는 것도 평생 효용 관점에서는 비효율로 간주됩니다.`
      );
    }

    const ratio = result.endingAssets / targetBequest;
    if (ratio > 1) {
      return (
        `목표 상속자산(약 ${formatManwon(targetBequest)})보다 예상 잔여자산(약 ${formatManwon(result.endingAssets)})이 ` +
        `약 ${ratio.toFixed(1)}배 많아 감점되었습니다. 자산을 다 쓰지 못하고 남기는 것도 평생 효용 관점에서는 비효율로 간주됩니다.`
      );
    }
    return `예상 잔여자산(약 ${formatManwon(result.endingAssets)})이 목표 상속자산(약 ${formatManwon(targetBequest)}) 대비 부족합니다.`;
  }

  const appropriateBalance = params.userProfile.targetMonthlySpending * cfg.appropriateBequestMonths;
  if (appropriateBalance <= 0) {
    return '목표 월 생활비가 설정되지 않아 적정 상속 자산 기준을 계산할 수 없습니다.';
  }

  const ratio = result.endingAssets / appropriateBalance;
  if (ratio > 1) {
    return (
      `적정 상속 자산 기준(목표 월생활비 ${cfg.appropriateBequestMonths}개월치 = 약 ${formatManwon(appropriateBalance)})보다 ` +
      `예상 잔여자산(약 ${formatManwon(result.endingAssets)})이 약 ${ratio.toFixed(1)}배 많아 감점되었습니다. ` +
      `자산을 다 쓰지 못하고 남기는 것도 평생 효용 관점에서는 비효율로 간주됩니다.`
    );
  }
  return (
    `예상 잔여자산(약 ${formatManwon(result.endingAssets)})이 적정 상속 자산 기준(약 ${formatManwon(appropriateBalance)}) 대비 부족합니다.`
  );
}
