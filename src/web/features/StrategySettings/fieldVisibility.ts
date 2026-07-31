import { StrategyMode } from '../../../core/entities/types';

// SimulationParams 안의 값을 가리키는 점 경로. diffDefaults가 같은 표기를 쓴다.
export type FieldPath = string;

export type SectionId = 'basic' | 'goal' | 'pension' | 'investment' | 'economic' | 'advanced';

// 섹션 → 그 섹션이 다루는 필드 경로. 한 경로는 정확히 한 섹션에만 속한다
// (중복되면 변경 개수 배지가 이중 계산된다 — 테스트가 이를 막는다).
export const SECTION_FIELDS: Record<SectionId, ReadonlyArray<FieldPath>> = {
  basic: [
    'userProfile.currentAge',
    'userProfile.retirementAge',
    'userProfile.expectancy',
    'spouse.enabled',
    'spouse.currentAge',
    'spouse.expectancy',
    'spouse.nationalPensionMonthlyAmount',
    'spouse.nationalPensionStartAge',
  ],
  goal: [
    'strategy.spendingChoice',
    'userProfile.targetMonthlySpending',
    'strategy.objective',
    'strategy.bequestStrategy',
    'userProfile.targetBequest',
  ],
  pension: [
    'strategy.nationalPensionStrategy',
    'strategy.privatePensionStrategy',
    'strategy.preferIsaFirst',
    'strategy.reinvestDividends',
  ],
  investment: [
    'yieldPreset',
    'strategy.riskProfile',
    'strategy.economicScenario',
  ],
  economic: [
    'inflationRate',
    'inflationMode',
    'baseExchangeRate',
    'displayCurrency',
    'healthcare.enabled',
    'healthcare.baseMonthlyCost',
    'healthcare.costGrowthRate',
    'healthcare.longTermCareEnabled',
    'healthcare.longTermCareStartAge',
    'healthcare.longTermCareMonthlyCost',
    'healthcare.shockEnabled',
    'healthcare.shockAge',
    'healthcare.shockAmount',
  ],
  advanced: [
    'taxLawVersion',
    'taxSettings.enableComprehensiveTax',
    'taxSettings.enableHealthInsurance',
    'taxSettings.usDividendTaxRate',
    'taxSettings.domesticDividendTaxRate',
    'taxSettings.comprehensiveTaxRate',
    'taxSettings.healthInsuranceRate',
    'taxSettings.enablePrivatePensionTax',
    'taxSettings.privatePensionLimit',
    'taxSettings.privatePensionExcessTaxRate',
    'taxSettings.enablePensionComprehensiveComparison',
  ],
};

// 간편 모드에서 보이는 필드. "필수 입력만, 나머지는 AI가 추천" 원칙에 따라
// 나이 3개 + 생활비 전략 + 목표 우선순위 + 연금 전략 2개로 제한한다.
const SIMPLE_FIELDS: ReadonlySet<FieldPath> = new Set([
  'userProfile.currentAge',
  'userProfile.retirementAge',
  'userProfile.expectancy',
  'spouse.enabled',
  'spouse.currentAge',
  'spouse.expectancy',
  'spouse.nationalPensionMonthlyAmount',
  'spouse.nationalPensionStartAge',
  'strategy.spendingChoice',
  'userProfile.targetMonthlySpending',
  'strategy.objective',
  'strategy.nationalPensionStrategy',
  'strategy.privatePensionStrategy',
]);

// 표준 모드는 간편 + 상속 전략 + 투자 전략 + 경제 가정 주요 항목.
// 고급 설정(advanced)만 제외된다.
const STANDARD_EXCLUDED: ReadonlySet<FieldPath> = new Set(SECTION_FIELDS.advanced);

const ALL_FIELDS: ReadonlySet<FieldPath> = new Set(
  (Object.keys(SECTION_FIELDS) as SectionId[]).flatMap((s) => SECTION_FIELDS[s])
);

// 모드별 필드 노출 여부. 각 섹션이 개별적으로 mode === 'expert' 조건문을
// 흩뿌리지 않도록 이 함수가 단일 소스다.
export function isFieldVisible(mode: StrategyMode, path: FieldPath): boolean {
  if (!ALL_FIELDS.has(path)) return false;
  if (mode === 'expert') return true;
  if (mode === 'standard') return !STANDARD_EXCLUDED.has(path);
  return SIMPLE_FIELDS.has(path);
}
