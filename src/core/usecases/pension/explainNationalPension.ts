import { SimulationParams } from '../../entities/types';
import { calculateNationalPensionTaxKRW } from '../tax/TaxEngine';
import { resolveTaxContext } from '../tax/taxContext';
import {
  NATIONAL_PENSION_DEFERRED_MAX_AGE, NATIONAL_PENSION_EARLY_MIN_AGE,
  NATIONAL_PENSION_NORMAL_START_AGE, getNationalPensionAdjustmentFactor,
} from './nationalPensionRules';

// 설정한 국민연금 수령액이 화면의 금액이 되기까지의 단계를 그대로 펼친다.
//
// **왜 필요한가.** 리포트에는 "예상 월 수령액 2,000,000원(60세부터 수령)"이라 적혀 있는데
// 연령별 소득표와 재원 구성에는 월 135만원이 찍혔다. 계산 자체는 정확하다 —
// 2,000,000 × 0.70(60세 조기수령, 5년 × 12개월 × 0.5% 감액) − 연금소득세·지방소득세.
// 그런데 그 두 단계가 리포트 어디에도 없어서, 사용자는 계산 오류라고 판단할 수밖에 없었다.
//
// 새로 계산하지 않는다. 엔진(SimulationEngine.ts:678-700)이 쓰는 것과 **같은 두 함수**를
// 같은 순서로 부를 뿐이다 — 여기서 산식을 다시 유도하면 설명이 자기가 설명하는 숫자와
// 어긋난다(explainUtilityComponents와 같은 원칙).
export interface NationalPensionStep {
  label: string;
  // 금액. 감액·세금처럼 빼는 단계는 음수다.
  amount: number;
  // 합계 줄(마지막 실질 수령액)인가. 화면이 강조 표시를 정하는 데 쓴다.
  isTotal?: boolean;
}

export interface NationalPensionExplanation {
  claimAge: number;
  // 설정값을 그대로 쓸 수 있는가(= 정상 개시 연령이고 세금도 0). 그러면 화면은 내역을
  // 펼칠 이유가 없다.
  isPlain: boolean;
  steps: NationalPensionStep[];
  // 실질 수령액(세후, 은퇴 첫 해 기준 월액).
  netMonthly: number;
  // 표의 금액이 오늘 화폐가치인지 미래 명목가치인지. 두 모드에서 뒤 연도의 금액이 다르다.
  inflationNote: string;
}

export function explainNationalPension(
  params: SimulationParams,
  // 엔진에 실제로 들어간 개시 나이. AI 센티널이 이 축을 채우는 경우
  // (params.withdrawalPlan에는 없는데 계산에는 반영된 경우) 화면이 그 값을 넘긴다 —
  // 넘기지 않으면 설명이 엔진과 다른 나이를 근거로 말한다.
  claimAgeOverride?: number
): NationalPensionExplanation | null {
  const expectedMonthlyAmount = params.nationalPension?.expectedMonthlyAmount ?? 0;
  if (expectedMonthlyAmount <= 0) return null;

  // 엔진과 같은 clamp를 쓴다(SimulationEngine.ts:679).
  const claimAge = Math.min(
    NATIONAL_PENSION_DEFERRED_MAX_AGE,
    Math.max(
      NATIONAL_PENSION_EARLY_MIN_AGE,
      claimAgeOverride
        ?? params.withdrawalPlan?.nationalPensionStartAge
        ?? NATIONAL_PENSION_NORMAL_START_AGE
    )
  );

  const factor = getNationalPensionAdjustmentFactor(claimAge);
  const grossMonthly = expectedMonthlyAmount * factor;

  const taxCtx = resolveTaxContext(params.taxSettings, params.taxLawVersion);
  const annualTax = calculateNationalPensionTaxKRW(grossMonthly * 12, taxCtx);
  const monthlyTax = annualTax / 12;
  const netMonthly = grossMonthly - monthlyTax;

  const steps: NationalPensionStep[] = [
    {
      label: `설정한 예상 수령액 (${NATIONAL_PENSION_NORMAL_START_AGE}세 기준)`,
      amount: expectedMonthlyAmount,
    },
  ];

  // 조기수령 감액과 연기수령 가산은 부호도 문구도 다르다. 정상 개시(계수 1)면 줄 자체를 넣지
  // 않는다 — 0원짜리 줄은 정보가 아니라 소음이다.
  if (factor < 1) {
    const percent = Math.round((1 - factor) * 1000) / 10;
    steps.push({
      label: `조기수령 감액 (${claimAge}세 개시, −${percent}%)`,
      amount: grossMonthly - expectedMonthlyAmount,
    });
  } else if (factor > 1) {
    const percent = Math.round((factor - 1) * 1000) / 10;
    steps.push({
      label: `연기수령 가산 (${claimAge}세 개시, +${percent}%)`,
      amount: grossMonthly - expectedMonthlyAmount,
    });
  }

  if (monthlyTax > 0) {
    steps.push({ label: '연금소득세 · 지방소득세', amount: -monthlyTax });
  }

  steps.push({ label: '실질 수령액', amount: netMonthly, isTotal: true });

  return {
    claimAge,
    isPlain: steps.length === 2, // 설정액 + 실질 수령액만 있는 경우
    steps,
    netMonthly,
    // 건강보험료는 여기서 빼지 않는다. 엔진이 연말에 자산에서 따로 징수하므로
    // (SimulationEngine.ts:1121-1150) 수령액에서 차감하면 이중으로 반영된다.
    inflationNote:
      params.inflationMode === 'nominal'
        ? '이후 연도에는 물가상승률이 매년 누적 반영됩니다.'
        : '오늘 화폐가치 기준이며, 이후 연도에도 같은 구매력으로 표시됩니다.',
  };
}
