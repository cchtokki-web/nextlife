import type {
  AccountInvestmentType,
  AccountWithdrawalPolicy,
  AssetCurrency,
  AssetMarket,
  AssetSellOrderStrategy,
  BequestStrategy,
  ComprehensiveTaxMode,
  EconomicScenario,
  CustomYieldSnapshot,
  HealthcareAssumptions,
  InvestmentAsset,
  IsaAccount,
  IsaAccountType,
  IsaFirstChoice,
  IsaMaturityDestination,
  NationalPensionStrategy,
  ObjectivePriority,
  OtherIncome,
  PrivatePension,
  PrivatePensionStrategy,
  PrivatePensionType,
  RetirementStrategy,
  RiskProfile,
  SimulationParams,
  SpendingCurve,
  SpendingShapePreset,
  SpendingStrategy,
  SpendingStrategyChoice,
  StrategyMode,
  TaxLawVersion,
  TaxSettings,
  UserProfile,
  WithdrawalPlan,
} from '../../core/entities/types';
import type { RetirementGoal, RetirementGoalType } from '../../core/entities/retirementGoal';
import { RETIREMENT_GOAL_TYPES } from '../../core/entities/retirementGoal';
import { DEFAULT_HEALTHCARE } from '../../core/usecases/healthcare/defaultHealthcare';
import { initialParams } from './defaultParams';

/**
 * 저장 데이터를 계산에 넣어도 되는 모양으로 정제한다.
 *
 * 로드 경계는 예전에 `as SimulationParams` 캐스팅뿐이었다. 캐스팅은 아무것도 검사하지 않으므로
 * 문자열 수량("2000")이나 NaN 이율이 그대로 엔진에 들어가, 오류 없이 전 구간이 NaN이 되거나
 * 화면이 undefined를 읽고 터졌다. 저장 데이터가 신뢰할 수 없는 이유는 셋이다 — localStorage는
 * 사용자가 직접 고칠 수 있고, E2EE 시나리오는 복호화된 JSON이 서버에서 올라오며, 예전 버전이
 * 쓴 필드는 지금 타입과 다르다.
 *
 * **원칙 1: 시나리오를 통째로 버리지 않는다.** 필드 하나가 깨졌다고 initialParams로 되돌리면
 * 사용자의 저장 계획이 조용히 사라진다. 필드 단위로 기본값을 채우고, 배열은 원소 단위로만
 * 정제한다. 원소 자체는 되도록 남긴다 — 화면에 보여야 사용자가 직접 고칠 수 있다.
 *
 * **원칙 2: 금액을 지어내지 않는다.** 깨진 숫자는 그 필드의 «없음»에 해당하는 값(대부분 0)으로
 * 두지, 그럴듯한 값을 채우지 않는다. 최상위 설정값(물가·환율처럼 0이 무의미한 것)만 예외로
 * initialParams의 값을 쓴다.
 *
 * **원칙 3: 모르는 키는 건드리지 않는다.** 타입에 없는 키를 지우면 아직 반영되지 않은 새 필드나
 * 다른 버전이 쓴 값을 우리가 파괴한다. 그래서 raw를 펼친 위에 검증한 필드만 덮어쓴다.
 *
 * 검증 범위는 «계산에 닿는 필드»다. taxSettings·withdrawalPlan·customYieldSnapshot 같은 중첩
 * 구조는 아직 캐스팅 그대로이며, 이 함수를 넓힐 때 다음 후보다.
 */
export function normalizeSimulationParams(raw: unknown): SimulationParams {
  if (!isRecord(raw)) return initialParams;

  return {
    // 원칙 3. 검증한 필드는 아래에서 전부 덮어쓴다.
    ...(raw as unknown as SimulationParams),
    userProfile: normalizeUserProfile(raw.userProfile),
    retirementGoals: normalizeGoals(raw.retirementGoals),
    assets: normalizeList(raw.assets, normalizeAsset),
    nationalPension: {
      expectedMonthlyAmount: finite(
        isRecord(raw.nationalPension) ? raw.nationalPension.expectedMonthlyAmount : undefined,
        initialParams.nationalPension.expectedMonthlyAmount,
      ),
    },
    privatePensions: normalizeList(raw.privatePensions, normalizePrivatePension),
    isaAccounts: raw.isaAccounts === undefined
      ? undefined
      : normalizeList(raw.isaAccounts, normalizeIsaAccount),
    otherIncomes: normalizeList(raw.otherIncomes, normalizeOtherIncome),
    inflationRate: finite(raw.inflationRate, initialParams.inflationRate),
    inflationMode: oneOf(raw.inflationMode, ['nominal', 'real'], initialParams.inflationMode),
    baseExchangeRate: finite(raw.baseExchangeRate, initialParams.baseExchangeRate),
    exchangeScenario: oneOf(
      raw.exchangeScenario,
      ['base', 'usd_up', 'usd_down'],
      initialParams.exchangeScenario,
    ),
    displayCurrency: currency(raw.displayCurrency, initialParams.displayCurrency),
    yieldPreset: optionalOneOf(raw.yieldPreset, YIELD_PRESETS, initialParams.yieldPreset),
    spendingStrategy: optionalOneOf(raw.spendingStrategy, SPENDING_STRATEGIES, undefined),
    // 0이 「없음」과 같은 뜻인 값들. 깨졌으면 없는 것으로 둔다 — 두 필드 모두 미지정이
    // 기존 동작이며, 임의의 값을 채우면 저장된 시나리오의 숫자가 조용히 달라진다.
    assetFloor: optionalFinite(raw.assetFloor),
    cashYieldRate: optionalFinite(raw.cashYieldRate),
    taxSettings: normalizeTaxSettings(raw.taxSettings),
    withdrawalPlan: normalizeWithdrawalPlan(raw.withdrawalPlan),
    spendingCurve: normalizeSpendingCurve(raw.spendingCurve),
    customYieldSnapshot: normalizeYieldSnapshot(raw.customYieldSnapshot),
    healthcare: normalizeHealthcare(raw.healthcare),
    taxLawVersion: optionalOneOf(raw.taxLawVersion, TAX_LAW_VERSIONS, undefined),
    // `strategy`는 «있음»과 «없음»이 서로 다른 상태다(아래 주석 참조). 그래서 키가 없으면
    // 만들지 않고, 있으면 내용이 전부 깨져도 빈 객체로 남긴다.
    ...('strategy' in raw ? { strategy: normalizeStrategy(raw.strategy) } : {}),
  };
}

const CURRENCIES: readonly AssetCurrency[] = ['KRW', 'USD'];
const ASSET_MARKETS: readonly AssetMarket[] = ['US_ETF', 'KR_ETF', 'IRP', 'PENSION', 'OTHER'];
const INVESTMENT_TYPES: readonly AccountInvestmentType[] = ['custom', 'deposit', 'etf'];
const PRIVATE_PENSION_TYPES: readonly PrivatePensionType[] = ['irp', 'savings', 'retirement'];
const ISA_TYPES: readonly IsaAccountType[] = ['general', 'low_income'];
const YIELD_PRESETS = ['conservative', 'base', 'aggressive', 'custom'] as const;
const SPENDING_STRATEGIES: readonly SpendingStrategy[] = ['target', 'dividend_only', 'max_sustainable'];
const COMPREHENSIVE_TAX_MODES: readonly ComprehensiveTaxMode[] = ['progressive_credit', 'flat'];
const WITHDRAWAL_POLICIES: readonly AccountWithdrawalPolicy[] = [
  'GENERAL_FIRST', 'ISA_FIRST', 'PENSION_FIRST', 'TAX_OPTIMIZED', 'PROPORTIONAL', 'CUSTOM',
];
const SELL_ORDER_STRATEGIES: readonly AssetSellOrderStrategy[] = [
  'input_order', 'low_dividend_first', 'high_dividend_first',
];
const ISA_MATURITY_DESTINATIONS: readonly IsaMaturityDestination[] = ['pension', 'asset'];
const TAX_LAW_VERSIONS: readonly TaxLawVersion[] = ['current'];
const STRATEGY_MODES: readonly StrategyMode[] = ['simple', 'standard', 'expert'];
const OBJECTIVE_PRIORITIES: readonly ObjectivePriority[] = [
  'lifetime_spending', 'tax_minimization', 'wealth_maximization',
  'bequest_maximization', 'ai_recommended',
];
const SPENDING_CHOICES: readonly SpendingStrategyChoice[] = [...SPENDING_STRATEGIES, 'ai'];
const BEQUEST_STRATEGIES: readonly BequestStrategy[] = [
  'spend_all', 'leave_some', 'maximize', 'target_amount',
];
const NATIONAL_PENSION_STRATEGIES: readonly NationalPensionStrategy[] = [
  'early', 'normal', 'defer_1y', 'defer_2y', 'defer_max', 'ai_optimized',
];
const PRIVATE_PENSION_STRATEGIES: readonly PrivatePensionStrategy[] = [
  'tax_first', 'spending_first', 'growth_first', 'minimum', 'ai_optimized',
];
const ISA_FIRST_CHOICES: readonly IsaFirstChoice[] = ['isa_first', 'pension_first', 'ai_optimized'];
const RISK_PROFILES: readonly RiskProfile[] = [
  'conservative', 'neutral', 'aggressive', 'custom', 'ai_recommended',
];
const ECONOMIC_SCENARIOS: readonly EconomicScenario[] = [
  'long_term_average', 'recession', 'high_inflation', 'low_growth', 'ai_recommended',
];
const SPENDING_SHAPES: readonly SpendingShapePreset[] = ['flat', 'front_loaded', 'care_heavy'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 유한한 숫자만 통과시킨다. 문자열 "2000"을 받아 주지 않는 것은 의도적이다 — 숫자로 읽히는
 *  문자열만 조용히 살리면 그렇지 않은 값과 처리가 갈려, 데이터가 왜 사라졌는지 설명할 수 없다. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalFinite(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : fallback;
}

function optionalOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T | undefined,
): T | undefined {
  if (value === undefined) return fallback;
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : fallback;
}

function currency(value: unknown, fallback: AssetCurrency): AssetCurrency {
  return oneOf(value, CURRENCIES, fallback);
}

/**
 * 배열이 아니면 빈 배열, 객체가 아닌 원소는 버린다.
 *
 * 원소를 버리는 유일한 조건이 「객체가 아니다」인 것이 중요하다. 필드가 깨졌다고 원소를
 * 버리면 사용자는 자산이 사라진 것을 보게 되고, 무엇이 사라졌는지 알 방법이 없다.
 */
function normalizeList<T>(
  value: unknown,
  normalize: (item: Record<string, unknown>, index: number) => T,
): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map(normalize);
}

function normalizeUserProfile(value: unknown): UserProfile {
  const raw = isRecord(value) ? value : {};
  const base = initialParams.userProfile;
  return {
    currentAge: finite(raw.currentAge, base.currentAge),
    retirementAge: finite(raw.retirementAge, base.retirementAge),
    expectancy: finite(raw.expectancy, base.expectancy),
    targetMonthlySpending: finite(raw.targetMonthlySpending, base.targetMonthlySpending),
    // 0은 「상속하지 않고 다 쓴다」는 명시적 목표라 미지정과 다르다. 그 구분을 지키려면
    // 깨진 값을 0으로 채워서는 안 되고 미지정으로 두어야 한다.
    targetBequest: optionalFinite(raw.targetBequest),
  };
}

function normalizeAsset(raw: Record<string, unknown>, index: number): InvestmentAsset {
  return {
    id: text(raw.id, `asset-${index}`),
    // 'stock'이 아니면 'etf'로 둔다. 두 값의 차이는 과세 체계이고, etf가 이 앱의 기본이다.
    type: oneOf(raw.type, ['stock', 'etf'], 'etf'),
    ticker: text(raw.ticker, ''),
    name: text(raw.name, ''),
    quantity: finite(raw.quantity, 0),
    averagePrice: finite(raw.averagePrice, 0),
    annualGrowthRate: finite(raw.annualGrowthRate, 0),
    dividendYield: finite(raw.dividendYield, 0),
    contributionPeriod: optionalOneOf(raw.contributionPeriod, ['daily', 'weekly', 'monthly'] as const, undefined),
    contributionAmount: optionalFinite(raw.contributionAmount),
    monthlyContribution: finite(raw.monthlyContribution, 0),
    reinvestDividend: bool(raw.reinvestDividend, false),
    currency: currency(raw.currency, 'KRW'),
    assetMarket: optionalOneOf(raw.assetMarket, ASSET_MARKETS, undefined),
    // 미지정이면 엔진이 평가액을 취득원가로 본다. 깨진 값을 0으로 채우면 평가액 전체가
    // 양도차익이 되어 세금이 폭증하므로, 반드시 미지정으로 되돌린다.
    acquisitionCostBasis: optionalFinite(raw.acquisitionCostBasis),
  };
}

function normalizePrivatePension(raw: Record<string, unknown>, index: number): PrivatePension {
  return {
    id: text(raw.id, `pension-${index}`),
    // 세 종류 중 'savings'(연금저축)를 기본으로 둔다. IRP·퇴직연금은 인출 제약이 더 강해,
    // 알 수 없는 값을 그쪽으로 읽으면 있지도 않은 제약을 사용자에게 씌우게 된다.
    type: oneOf(raw.type, PRIVATE_PENSION_TYPES, 'savings'),
    investmentType: optionalOneOf(raw.investmentType, INVESTMENT_TYPES, undefined),
    ticker: optionalText(raw.ticker),
    name: optionalText(raw.name),
    balance: finite(raw.balance, 0),
    monthlyContribution: finite(raw.monthlyContribution, 0),
    annualReturn: finite(raw.annualReturn, 0),
    dividendYield: optionalFinite(raw.dividendYield),
    currency: currency(raw.currency, 'KRW'),
    earlyChannelingEnabled: typeof raw.earlyChannelingEnabled === 'boolean'
      ? raw.earlyChannelingEnabled
      : undefined,
  };
}

function normalizeIsaAccount(raw: Record<string, unknown>, index: number): IsaAccount {
  return {
    id: text(raw.id, `isa-${index}`),
    type: oneOf(raw.type, ISA_TYPES, 'general'),
    investmentType: optionalOneOf(raw.investmentType, INVESTMENT_TYPES, undefined),
    ticker: optionalText(raw.ticker),
    name: optionalText(raw.name),
    balance: finite(raw.balance, 0),
    monthlyContribution: finite(raw.monthlyContribution, 0),
    annualReturn: finite(raw.annualReturn, 0),
    dividendYield: finite(raw.dividendYield, 0),
    currency: currency(raw.currency, 'KRW'),
    // 0년 만기는 만기 처리가 매년 발동하는 뜻이 된다. 타입 주석이 밝힌 기본값 3년을 쓴다.
    maturityYears: finite(raw.maturityYears, 3),
  };
}

function normalizeOtherIncome(raw: Record<string, unknown>, index: number): OtherIncome {
  return {
    id: text(raw.id, `income-${index}`),
    label: text(raw.label, ''),
    monthlyAmount: finite(raw.monthlyAmount, 0),
    currency: currency(raw.currency, 'KRW'),
  };
}

/**
 * 선택 항목만 담긴 부분 설정을 정제한다. 깨진 항목은 **값을 채우지 않고 키를 지운다.**
 *
 * 이 구조들은 전부 optional이고 소비처가 이미 미지정 기본값을 갖고 있다(resolveTaxSettings
 * 등). 그래서 키를 지우면 저장 전과 같은 「지정한 적 없음」 상태가 되어 기본값이 그대로 산다.
 * 반대로 여기서 기본값을 박아 넣으면, 나중에 기본값이 바뀌어도 이 시나리오만 옛 값에 고정된다.
 */
function pickValid(
  value: unknown,
  validators: Record<string, (raw: unknown) => unknown>,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, validate] of Object.entries(validators)) {
    if (!(key in value)) continue;
    const normalized = validate(value[key]);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

const asBool = (raw: unknown): boolean | undefined =>
  typeof raw === 'boolean' ? raw : undefined;
const asNumber = (raw: unknown): number | undefined => optionalFinite(raw);
const asOneOf = <T extends string>(allowed: readonly T[]) => (raw: unknown): T | undefined =>
  typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? raw as T : undefined;

function normalizeTaxSettings(value: unknown): TaxSettings | undefined {
  return pickValid(value, {
    enableComprehensiveTax: asBool,
    enableHealthInsurance: asBool,
    usDividendTaxRate: asNumber,
    domesticDividendTaxRate: asNumber,
    comprehensiveTaxMode: asOneOf(COMPREHENSIVE_TAX_MODES),
    comprehensiveTaxRate: asNumber,
    healthInsuranceRate: asNumber,
    enableCapitalGainsTax: asBool,
    capitalGainsTaxRate: asNumber,
    enablePrivatePensionTax: asBool,
    privatePensionLimit: asNumber,
    privatePensionExcessTaxRate: asNumber,
    limitPrivatePensionToTaxLimit: asBool,
    enablePensionComprehensiveComparison: asBool,
  }) as TaxSettings | undefined;
}

function normalizeWithdrawalPlan(value: unknown): WithdrawalPlan | undefined {
  return pickValid(value, {
    accountWithdrawalPolicy: asOneOf(WITHDRAWAL_POLICIES),
    // 알 수 없는 항목만 걸러낸다. 계좌 유형이 아니라 구체 계좌 id도 올 수 있으므로
    // 문자열이면 남긴다 — 없는 id는 엔진이 조용히 건너뛴다.
    customWithdrawalOrder: (raw) => Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === 'string')
      : undefined,
    privatePensionMonthlyTarget: asNumber,
    nationalPensionStartAge: asNumber,
    assetSellOrderStrategy: asOneOf(SELL_ORDER_STRATEGIES),
    isaMaturityDestination: asOneOf(ISA_MATURITY_DESTINATIONS),
    generalAssetWithdrawalStartAge: asNumber,
    monthlySpendingMultiplier: asNumber,
  }) as WithdrawalPlan | undefined;
}

/**
 * 곡선은 항목별 복구가 불가능하다 — 「배수 길이 = 구간 길이 + 1」이 무너지면 뒤쪽 나이의
 * 배수가 undefined가 되어 그 해 목표 생활비가 NaN이 되는데, 어느 쪽 배열이 맞는지 알 수 없다.
 * 통째로 지우면 전 구간 1.0(= 곡선을 쓰지 않는 기존 동작)으로 안전하게 돌아간다.
 */
function normalizeSpendingCurve(value: unknown): SpendingCurve | undefined {
  if (!isRecord(value)) return undefined;
  const { breakpointAges, multipliers } = value;
  if (!Array.isArray(breakpointAges) || !Array.isArray(multipliers)) return undefined;
  if (multipliers.length !== breakpointAges.length + 1) return undefined;
  const allFinite = [...breakpointAges, ...multipliers]
    .every((item) => typeof item === 'number' && Number.isFinite(item));
  if (!allFinite) return undefined;
  return { breakpointAges: breakpointAges as number[], multipliers: multipliers as number[] };
}

/** id → 수익률 맵. 값이 숫자가 아니면 그 항목만 버린다 — 복원할 값이 없다는 뜻이다. */
function numberMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, rate]) => typeof rate === 'number' && Number.isFinite(rate)),
  ) as Record<string, number>;
}

function normalizeYieldSnapshot(value: unknown): CustomYieldSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  return {
    assets: numberMap(value.assets),
    privatePensions: numberMap(value.privatePensions),
    isaAccounts: numberMap(value.isaAccounts),
  };
}

/**
 * 은퇴 전략 설정. resolveStrategy가 저장값을 기본값 «위에» 펼치므로, 깨진 값 하나가
 * DEFAULT_RETIREMENT_STRATEGY의 해당 항목을 덮는다 — taxSettings와 같은 구조의 위험이다.
 *
 * **`strategy` 키의 존재 자체가 데이터다.** 없으면 「전략을 저장한 적 없음」이고,
 * strategyFieldMap(고정 축 판정)과 verifiedSentinelPlan(센티널 판정)이 그 상태를 읽는다.
 * 그래서 내용이 전부 깨져도 키를 지우지 않고 빈 객체로 남긴다.
 *
 * **`preferIsaFirst`의 boolean은 버리지 않는다.** 이 필드가 boolean이던 시절의 값이 실제로
 * 저장돼 있고, E2EE라 서버 마이그레이션이 불가능해 resolveStrategy의 읽기 시점 변환
 * (normalizeIsaFirstChoice)이 유일한 경로다. 여기서 「유니온에 없다」고 버리면 그 경로가
 * 끊겨, 저장된 선택이 조용히 기본값으로 바뀐다.
 */
function normalizeStrategy(value: unknown): RetirementStrategy {
  return (pickValid(value, {
    mode: asOneOf(STRATEGY_MODES),
    objective: asOneOf(OBJECTIVE_PRIORITIES),
    spendingChoice: asOneOf(SPENDING_CHOICES),
    bequestStrategy: asOneOf(BEQUEST_STRATEGIES),
    nationalPensionStrategy: asOneOf(NATIONAL_PENSION_STRATEGIES),
    privatePensionStrategy: asOneOf(PRIVATE_PENSION_STRATEGIES),
    preferIsaFirst: (raw) =>
      typeof raw === 'boolean' ? raw : asOneOf(ISA_FIRST_CHOICES)(raw),
    riskProfile: asOneOf(RISK_PROFILES),
    economicScenario: asOneOf(ECONOMIC_SCENARIOS),
    spendingShape: asOneOf(SPENDING_SHAPES),
    bequestSafetyMarginRate: asNumber,
    minMonthlySpending: asNumber,
    // 저장된 strategy는 «언제나» 부분 객체다. 타입은 전체를 요구하지만, 필드가 추가되기 전에
    // 저장된 시나리오에는 그 필드가 없고 resolveStrategy가 기본값 위에 펼쳐 메운다
    // (RetirementStrategy의 optional 세 필드 주석 참조). 여기서 빠진 필드를 채우면 그 시나리오만
    // 옛 기본값에 고정되므로, 타입이 아니라 이 계약을 지킨다.
  }) ?? {}) as unknown as RetirementStrategy;
}

/**
 * 의료비 설정만 항목별 «기본값 되돌리기»를 한다. 다른 부분 설정과 달리 모든 필드가 필수라
 * 키를 지울 수 없기 때문이다.
 *
 * 특히 `enabled`가 중요하다. 엔진은 `!healthcare.enabled`로만 검사하므로 문자열 'false'가
 * 의료비를 켰고, 그 상태에서 `costGrowthRate`가 NaN이면 자산 전체가 NaN으로 번졌다.
 */
function normalizeHealthcare(value: unknown): HealthcareAssumptions | undefined {
  if (!isRecord(value)) return undefined;
  return {
    enabled: bool(value.enabled, DEFAULT_HEALTHCARE.enabled),
    costGrowthRate: finite(value.costGrowthRate, DEFAULT_HEALTHCARE.costGrowthRate),
    baseMonthlyCost: finite(value.baseMonthlyCost, DEFAULT_HEALTHCARE.baseMonthlyCost),
    longTermCareEnabled: bool(value.longTermCareEnabled, DEFAULT_HEALTHCARE.longTermCareEnabled),
    longTermCareStartAge: finite(value.longTermCareStartAge, DEFAULT_HEALTHCARE.longTermCareStartAge),
    longTermCareMonthlyCost: finite(
      value.longTermCareMonthlyCost,
      DEFAULT_HEALTHCARE.longTermCareMonthlyCost,
    ),
    shockEnabled: bool(value.shockEnabled, DEFAULT_HEALTHCARE.shockEnabled),
    shockAge: finite(value.shockAge, DEFAULT_HEALTHCARE.shockAge),
    shockAmount: finite(value.shockAmount, DEFAULT_HEALTHCARE.shockAmount),
  };
}

/**
 * 목표는 «종류»가 유일한 식별자다. 알 수 없는 종류는 무엇을 뜻하는지 알 수 없어 버리지만,
 * priority나 constraintType이 깨진 것만으로는 버리지 않는다 — 사용자가 고른 목표 자체는
 * 유효한 정보이고, 그것을 지우면 추천 결과가 통째로 달라진다.
 *
 * 순서를 지어내지 않으려고 깨진 priority는 뒤로 보낸다. 목표의 실제 정렬·중복 제거는
 * normalizeRetirementGoals가 맡으므로 여기서는 값의 모양만 맞춘다.
 */
function normalizeGoals(value: unknown): RetirementGoal[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter((raw): boolean =>
      typeof raw.type === 'string'
      && (RETIREMENT_GOAL_TYPES as readonly string[]).includes(raw.type))
    .map((raw, index) => ({
      type: raw.type as RetirementGoalType,
      priority: finite(raw.priority, index + 1),
      targetValue: optionalFinite(raw.targetValue),
      constraintType: oneOf(raw.constraintType, ['HARD', 'SOFT'], 'SOFT'),
    }));
}
