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
    // 자산 배열 내부 값을 가리키는 가상 경로. diffDefaults가 "자산 중 하나라도
    // 기본값과 다른가"로 해석한다 (배열 인덱스별 경로를 만들지 않기 위한 장치).
    'assets.reinvestDividend',
  ],
  investment: [
    // 'yieldPreset'은 여기에 없다. 이 섹션에 그 필드를 렌더하는 입력이 없기 때문이다
    // (수익률 직접 입력은 "내 자산" 폼에 있고, 그쪽이 값을 바꿀 때 yieldPreset을 'custom'으로
    //  적는다). 등록해 두면 자산 폼에서 수익률을 한 번만 고쳐도 이 섹션에 "1개 변경" 배지가
    // 붙는데, 섹션을 열어도 전문가 모드로 올려도 되돌릴 입력이 없어 지울 방법이 없다.
    // sectionFieldCoverage.test.tsx가 "모든 경로는 어딘가에서 렌더된다"를 강제한다.
    'strategy.riskProfile',
    'strategy.economicScenario',
  ],
  economic: [
    'inflationRate',
    'inflationMode',
    'baseExchangeRate',
    'useLatestExchangeRate',
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
    'taxSettings.limitPrivatePensionToTaxLimit',
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
  // 배당 재투자는 "필수 입력"은 아니지만 여기 있어야 한다. AI 추천이 이 값을 자주 권하고
  // (Phase 3가 자산별로 독립 평가한다) 대시보드 체크리스트가 간편 모드에서도 그 항목을
  // 제시하는데, 숨기면 지시를 실행할 컨트롤이 화면에 하나도 없게 된다.
  'assets.reinvestDividend',
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

// 이 모드에서 섹션을 화면에 낼지. 손댈 수 있는 필드가 하나도 없으면 열어봐야 빈
// 껍데기라 고장으로 읽히므로 아예 렌더하지 않는다.
//
// 노출 목록을 따로 두지 않고 isFieldVisible에서 파생시킨다. 두 규칙을 각각 관리하면
// SIMPLE_FIELDS에 필드를 하나 추가했을 때 "필드는 보이는데 섹션은 숨은" 상태가 된다.
export function isSectionVisible(mode: StrategyMode, section: SectionId): boolean {
  return SECTION_FIELDS[section].some((path) => isFieldVisible(mode, path));
}
