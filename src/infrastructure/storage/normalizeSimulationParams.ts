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
import {
  collectNormalizationIssues,
  describeIssue,
  financialIssues,
  type NormalizationIssue,
} from './normalizationIssues';

/**
 * 정제하면서 «무엇을 바꿨는지»도 함께 돌려준다.
 *
 * 정제 자체는 조용해야 한다 — 필드 하나가 깨졌다고 계산을 멈추면 사용자는 아무것도 볼 수
 * 없다. 하지만 조용한 것과 «흔적이 없는» 것은 다르다. 통화를 읽지 못해 USD 자산이 KRW로
 * 읽히면 평가액이 1/1350이 되는데, 계좌는 화면에 그대로 남아 아무도 그것을 알아채지 못한다.
 *
 * 그래서 값을 바꾸는 일과 그것을 알리는 일을 분리한다. 이 함수는 둘 다 하고,
 * normalizeSimulationParams는 앞의 것만 한다(호출부 40여 곳을 그대로 두기 위해서다).
 */
export function normalizeSimulationParamsWithIssues(raw: unknown): {
  params: SimulationParams;
  issues: NormalizationIssue[];
} {
  const params = normalizeSimulationParams(raw);
  return { params, issues: collectNormalizationIssues(raw, params) };
}

/**
 * 정제가 바꾼 것을 진단 가능한 형태로 남긴다.
 *
 * 사용자 화면에 띄우지 않는 것은 의도다. 이 정보로 사용자가 지금 할 수 있는 일이 없고
 * (「assets[1].currency를 읽지 못했습니다」는 조치로 이어지지 않는다), 계획을 볼 때마다
 * 경고가 뜨면 정작 중요한 경고를 무시하게 된다. 화면에 무엇을 어떻게 띄울지는 별도 결정이며,
 * 그때 필요한 데이터는 normalizeSimulationParamsWithIssues가 이미 돌려주고 있다.
 *
 * 지금 필요한 것은 «문의가 들어왔을 때 재현 없이 원인을 짚을 수 있는 기록»이다.
 */
export function reportNormalizationIssues(source: string, issues: readonly NormalizationIssue[]): void {
  if (issues.length === 0) return;
  const financial = financialIssues(issues);
  if (financial.length > 0) {
    console.error(
      `[정제] ${source}: 계산에 쓰이는 값 ${financial.length}건을 대체했습니다`,
      financial.map(describeIssue),
    );
  }
  const cosmetic = issues.length - financial.length;
  if (cosmetic > 0) {
    console.warn(`[정제] ${source}: 표시용 값 ${cosmetic}건을 대체했습니다`);
  }
}

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
 * **원칙 4: 없던 키를 만들지 않는다.** 선택 필드는 «값»뿐 아니라 «키의 존재»가 데이터다.
 * RetirementModelAdapter가 `hasOwn`으로 「사용자가 이 항목을 설정한 적이 있는가」를 판정하기
 * 때문이다. 객체 리터럴은 `{ k: undefined }`도 키를 만들므로, 값이 없을 때는 반드시
 * `...('k' in raw ? { k: … } : {})` 꼴로 키 자체를 빼야 한다.
 *
 * 검증 범위는 «계산에 닿는 필드»다. 중첩 구조(taxSettings·withdrawalPlan·customYieldSnapshot·
 * healthcare·strategy)도 pickValid로 항목 단위 정제를 거친다. 남은 것은 raw를 펼칠 때 그대로
 * 실려 오는 «타입에 없는 키»뿐이며, 그것은 원칙 3에 따라 의도적으로 건드리지 않는다.
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
      // 원칙 2. 읽지 못한 값을 initialParams의 월 120만원으로 채우면 «종신 연금»을 지어내는
      // 셈이라, 다른 어떤 필드보다 계획을 크게 낙관 쪽으로 흔든다. 0은 국민연금이 없는
      // 정상 상태이기도 하고, 이 키가 아예 없던 옛 시나리오에서 엔진이 쓰던 값
      // (SimulationEngine의 구조분해 기본값 `{ expectedMonthlyAmount: 0 }`)과도 같다.
      expectedMonthlyAmount: finite(
        isRecord(raw.nationalPension) ? raw.nationalPension.expectedMonthlyAmount : undefined,
        0,
      ),
    },
    privatePensions: normalizeList(raw.privatePensions, normalizePrivatePension),
    otherIncomes: normalizeList(raw.otherIncomes, normalizeOtherIncome),
    inflationRate: finite(raw.inflationRate, initialParams.inflationRate),
    inflationMode: oneOf(raw.inflationMode, ['nominal', 'real'], initialParams.inflationMode),
    // 환율은 금액이 아니라 «나눗셈의 분모»다(SimulationEngine.convertValue). 0이면 USD 자산
    // 평가액이 전부 Infinity가 되어 오류 없이 전 구간이 망가지므로 0을 통과시키지 않는다.
    baseExchangeRate: positive(raw.baseExchangeRate, initialParams.baseExchangeRate),
    exchangeScenario: oneOf(
      raw.exchangeScenario,
      ['base', 'usd_up', 'usd_down'],
      initialParams.exchangeScenario,
    ),
    displayCurrency: currency(raw.displayCurrency, initialParams.displayCurrency),
    yieldPreset: optionalOneOf(raw.yieldPreset, YIELD_PRESETS, initialParams.yieldPreset),
    // 아래는 전부 원칙 4를 따른다 — 키가 없었으면 만들지 않는다.
    ...onlyIfPresent(raw, 'isaAccounts', (v) => normalizeList(v, normalizeIsaAccount)),
    ...onlyIfPresent(raw, 'spendingStrategy', (v) => optionalOneOf(v, SPENDING_STRATEGIES, undefined)),
    // 0이 「없음」과 같은 뜻인 값들. 깨졌으면 없는 것으로 둔다 — 두 필드 모두 미지정이
    // 기존 동작이며, 임의의 값을 채우면 저장된 시나리오의 숫자가 조용히 달라진다.
    ...onlyIfPresent(raw, 'assetFloor', optionalFinite),
    ...onlyIfPresent(raw, 'cashYieldRate', optionalFinite),
    ...onlyIfPresent(raw, 'taxSettings', normalizeTaxSettings),
    ...onlyIfPresent(raw, 'withdrawalPlan', normalizeWithdrawalPlan),
    ...onlyIfPresent(raw, 'spendingCurve', normalizeSpendingCurve),
    ...onlyIfPresent(raw, 'customYieldSnapshot', normalizeYieldSnapshot),
    ...onlyIfPresent(raw, 'healthcare', normalizeHealthcare),
    ...onlyIfPresent(raw, 'taxLawVersion', (v) => optionalOneOf(v, TAX_LAW_VERSIONS, undefined)),
    // `strategy`는 «있음»과 «없음»이 서로 다른 상태다(아래 주석 참조). 그래서 키가 없으면
    // 만들지 않고, 있으면 내용이 전부 깨져도 빈 객체로 남긴다.
    ...('strategy' in raw ? { strategy: normalizeStrategy(raw.strategy) } : {}),
  };
}

/**
 * 원칙 4의 도구. 키가 raw에 있을 때만 정제해 실어 보내고, 없으면 «키 자체를» 만들지 않는다.
 *
 * 삼항 연산자로 `undefined`를 대입하는 방식(`k: raw.k === undefined ? undefined : f(raw.k)`)은
 * 이 일을 하지 못한다 — 객체 리터럴은 값이 undefined여도 키를 만들기 때문이다. 그래서
 * 스프레드로 «항목이 없는 객체»를 합치는 이 꼴이어야 한다.
 */
function onlyIfPresent<K extends string, V>(
  raw: Record<string, unknown>,
  key: K,
  normalize: (value: unknown) => V,
): { [P in K]?: V } {
  if (!(key in raw)) return {} as { [P in K]?: V };
  return { [key]: normalize(raw[key]) } as { [P in K]?: V };
}

/**
 * 유니온을 «빠짐없이» 옮겨 적었는지 컴파일러가 확인하게 한다.
 *
 * `const X: readonly T[] = [...]`는 부분집합도 통과시킨다. 그래서 AssetCurrency에 'JPY'를
 * 추가하고 아래 목록에 넣는 것을 잊으면, 타입은 멀쩡한 채로 «모든 사용자의 JPY 계좌가
 * 로드할 때마다 KRW가 된다» — 이 파일이 막으려던 바로 그 종류의 조용한 손실이다.
 *
 * 반환 타입이 아니라 인자 쪽에서 걸러 낸다. 목록이 유니온을 다 덮지 못하면 인자 타입이
 * never가 되어 그 자리에서 컴파일이 멈춘다.
 */
function coversUnion<T extends string>() {
  return <L extends readonly T[]>(
    list: L & (Exclude<T, L[number]> extends never ? unknown : never),
  ): readonly T[] => list;
}

const CURRENCIES = coversUnion<AssetCurrency>()(['KRW', 'USD']);
const ASSET_MARKETS = coversUnion<AssetMarket>()(['US_ETF', 'KR_ETF', 'IRP', 'PENSION', 'OTHER']);
const INVESTMENT_TYPES = coversUnion<AccountInvestmentType>()(['custom', 'deposit', 'etf']);
const PRIVATE_PENSION_TYPES = coversUnion<PrivatePensionType>()(['irp', 'savings', 'retirement']);
const ISA_TYPES = coversUnion<IsaAccountType>()(['general', 'low_income']);
const YIELD_PRESETS = ['conservative', 'base', 'aggressive', 'custom'] as const;
const SPENDING_STRATEGIES = coversUnion<SpendingStrategy>()(['target', 'dividend_only', 'max_sustainable']);
const COMPREHENSIVE_TAX_MODES = coversUnion<ComprehensiveTaxMode>()(['progressive_credit', 'flat']);
const WITHDRAWAL_POLICIES = coversUnion<AccountWithdrawalPolicy>()([
  'GENERAL_FIRST', 'ISA_FIRST', 'PENSION_FIRST', 'TAX_OPTIMIZED', 'PROPORTIONAL', 'CUSTOM',
]);
const SELL_ORDER_STRATEGIES = coversUnion<AssetSellOrderStrategy>()([
  'input_order', 'low_dividend_first', 'high_dividend_first',
]);
const ISA_MATURITY_DESTINATIONS = coversUnion<IsaMaturityDestination>()(['pension', 'asset']);
const TAX_LAW_VERSIONS = coversUnion<TaxLawVersion>()(['current']);
const STRATEGY_MODES = coversUnion<StrategyMode>()(['simple', 'standard', 'expert']);
const OBJECTIVE_PRIORITIES = coversUnion<ObjectivePriority>()([
  'lifetime_spending', 'tax_minimization', 'wealth_maximization',
  'bequest_maximization', 'ai_recommended',
]);
const SPENDING_CHOICES = coversUnion<SpendingStrategyChoice>()([...SPENDING_STRATEGIES, 'ai']);
const BEQUEST_STRATEGIES = coversUnion<BequestStrategy>()([
  'spend_all', 'leave_some', 'maximize', 'target_amount',
]);
const NATIONAL_PENSION_STRATEGIES = coversUnion<NationalPensionStrategy>()([
  'early', 'normal', 'defer_1y', 'defer_2y', 'defer_max', 'ai_optimized',
]);
const PRIVATE_PENSION_STRATEGIES = coversUnion<PrivatePensionStrategy>()([
  'tax_first', 'spending_first', 'growth_first', 'minimum', 'ai_optimized',
]);
const ISA_FIRST_CHOICES = coversUnion<IsaFirstChoice>()(['isa_first', 'pension_first', 'ai_optimized']);
const RISK_PROFILES = coversUnion<RiskProfile>()([
  'conservative', 'neutral', 'aggressive', 'custom', 'ai_recommended',
]);
const ECONOMIC_SCENARIOS = coversUnion<EconomicScenario>()([
  'long_term_average', 'recession', 'high_inflation', 'low_growth', 'ai_recommended',
]);
const SPENDING_SHAPES = coversUnion<SpendingShapePreset>()(['flat', 'front_loaded', 'care_heavy']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 유한한 숫자만 통과시킨다. 문자열 "2000"을 받아 주지 않는 것은 의도적이다 — 숫자로 읽히는
 *  문자열만 조용히 살리면 그렇지 않은 값과 처리가 갈려, 데이터가 왜 사라졌는지 설명할 수 없다. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 0보다 큰 유한수만 통과시킨다. «금액»이 아니라 나눗셈의 분모나 주기처럼 0이 성립하지 않는
 * 값에 쓴다 — 금액은 0이 「없음」이라는 정상 상태이므로 finite를 그대로 쓴다(원칙 2).
 */
function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 사람의 나이로 성립하는 값만 통과시킨다. 벗어나면 «보정»이 아니라 기본값으로 되돌린다 —
 *  120으로 깎아 두면 사용자가 넣은 적 없는 기대수명이 계획에 남는다.
 *
 *  하한이 1인 이유. 예전에는 0을 통과시켰는데, 그러면 이 함수가 스스로 내건 「성립하는
 *  값만」이라는 규칙과 어긋난다 — 0세 은퇴도 0세 기대수명도 뜻하는 바가 없다. 게다가
 *  currentAge 0은 엔진의 totalYears 가드(<= 0)를 통과해 0세부터 시작하는 86년짜리 계획이
 *  조용히 돌아간다. 입력 경계(ageInput.parseAge)와 목표 경계
 *  (retirementGoal.normalizeTargetValue)가 이미 1을 쓰고 있었고, 세 곳이 서로 다른 답을
 *  갖고 있을 이유가 없다. 화면으로는 0을 만들 수 없으므로 이 하한에 걸리는 것은 손으로
 *  고친 JSON과 손상된 저장 데이터뿐이며, 그때 기본값으로 되돌리는 것이 이 함수의 본래
 *  동작이다. */
const MIN_HUMAN_AGE = 1;
const MAX_HUMAN_AGE = 120;
function humanAge(value: unknown, fallback: number): number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= MIN_HUMAN_AGE
    && value <= MAX_HUMAN_AGE
    ? value
    : fallback;
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
    // 나이는 금액과 달리 «루프의 경계»다. SimulationEngine의 투영은
    // `expectancy - currentAge + 1`번 도는데 NaN과 0 이하만 막으므로, expectancy가 1e9면
    // 오류 없이 10억 번을 돌아 탭이 멈춘다(저장값이 사람이 고칠 수 있는 localStorage에서
    // 온다는 것을 생각하면 가정이 아니다). 사람의 나이로 성립하지 않는 값은 통과시키지
    // 않는다 — retirementGoal의 normalizeTargetValue가 쓰는 것과 같은 상한이다.
    currentAge: humanAge(raw.currentAge, base.currentAge),
    retirementAge: humanAge(raw.retirementAge, base.retirementAge),
    expectancy: humanAge(raw.expectancy, base.expectancy),
    targetMonthlySpending: finite(raw.targetMonthlySpending, base.targetMonthlySpending),
    // 0은 「상속하지 않고 다 쓴다」는 명시적 목표라 미지정과 다르다. 그 구분을 지키려면
    // 깨진 값을 0으로 채워서는 안 되고 미지정으로 두어야 하며(원칙 2), 애초에 없던 키를
    // 만들어서도 안 된다(원칙 4) — compileStrategy가 'maximize'에서 이 키를 «지워» 두고,
    // computeBequestAdequacyRaw는 키의 유무로 채점 곡선을 고른다.
    ...onlyIfPresent(raw, 'targetBequest', optionalFinite),
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
    monthlyContribution: finite(raw.monthlyContribution, 0),
    reinvestDividend: bool(raw.reinvestDividend, false),
    currency: currency(raw.currency, 'KRW'),
    ...onlyIfPresent(raw, 'contributionPeriod', (v) =>
      optionalOneOf(v, ['daily', 'weekly', 'monthly'] as const, undefined)),
    ...onlyIfPresent(raw, 'contributionAmount', optionalFinite),
    ...onlyIfPresent(raw, 'assetMarket', (v) => optionalOneOf(v, ASSET_MARKETS, undefined)),
    // 미지정이면 엔진이 평가액을 취득원가로 본다. 깨진 값을 0으로 채우면 평가액 전체가
    // 양도차익이 되어 세금이 폭증하므로, 반드시 미지정으로 되돌린다.
    ...onlyIfPresent(raw, 'acquisitionCostBasis', optionalFinite),
  };
}

function normalizePrivatePension(raw: Record<string, unknown>, index: number): PrivatePension {
  return {
    id: text(raw.id, `pension-${index}`),
    // 세 종류 중 'savings'(연금저축)를 기본으로 둔다. IRP·퇴직연금은 인출 제약이 더 강해,
    // 알 수 없는 값을 그쪽으로 읽으면 있지도 않은 제약을 사용자에게 씌우게 된다.
    type: oneOf(raw.type, PRIVATE_PENSION_TYPES, 'savings'),
    balance: finite(raw.balance, 0),
    monthlyContribution: finite(raw.monthlyContribution, 0),
    annualReturn: finite(raw.annualReturn, 0),
    currency: currency(raw.currency, 'KRW'),
    ...onlyIfPresent(raw, 'investmentType', (v) => optionalOneOf(v, INVESTMENT_TYPES, undefined)),
    ...onlyIfPresent(raw, 'ticker', optionalText),
    ...onlyIfPresent(raw, 'name', optionalText),
    ...onlyIfPresent(raw, 'dividendYield', optionalFinite),
    ...onlyIfPresent(raw, 'earlyChannelingEnabled', (v) =>
      typeof v === 'boolean' ? v : undefined),
  };
}

function normalizeIsaAccount(raw: Record<string, unknown>, index: number): IsaAccount {
  return {
    id: text(raw.id, `isa-${index}`),
    type: oneOf(raw.type, ISA_TYPES, 'general'),
    balance: finite(raw.balance, 0),
    monthlyContribution: finite(raw.monthlyContribution, 0),
    annualReturn: finite(raw.annualReturn, 0),
    dividendYield: finite(raw.dividendYield, 0),
    currency: currency(raw.currency, 'KRW'),
    ...onlyIfPresent(raw, 'investmentType', (v) => optionalOneOf(v, INVESTMENT_TYPES, undefined)),
    ...onlyIfPresent(raw, 'ticker', optionalText),
    ...onlyIfPresent(raw, 'name', optionalText),
    // 0년 이하 만기는 만기 처리가 매년(혹은 매 시점) 발동하는 뜻이 된다. 금액이 아니라
    // «주기»라서 0을 「없음」으로 읽을 수 없으므로, 타입 주석이 밝힌 기본값 3년을 쓴다.
    // `finite`만 쓰면 0이 유한수라 그대로 통과해 이 주석이 거짓말이 된다.
    maturityYears: positive(raw.maturityYears, 3),
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
 *
 * **지우는 것은 «깨진» 항목뿐이고, «모르는» 항목은 그대로 실어 보낸다(원칙 3).** validators를
 * 순회하며 결과를 새 객체에 담기만 하면 검증기가 없는 키는 전부 사라진다. 그러면 TaxSettings에
 * 필드를 추가하고 검증기 등록을 잊는 순간, 모든 사용자의 그 필드가 로드할 때마다 조용히
 * 삭제된다 — E2EE라 서버에서 되살릴 방법이 없어 영구 손실이다. 최상위(:69)가 raw를 펼친 위에
 * 덮어쓰는 것과 같은 이유로, 여기서도 원본을 펼친 위에 검증한 값을 덮어쓴다.
 */
function pickValid(
  value: unknown,
  validators: Record<string, (raw: unknown) => unknown>,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, unknown> = { ...value };
  for (const [key, validate] of Object.entries(validators)) {
    if (!(key in value)) continue;
    const normalized = validate(value[key]);
    // 깨진 항목은 값을 채우지 않고 키를 지운다 — 소비처의 미지정 기본값이 살아난다.
    if (normalized === undefined) delete result[key];
    else result[key] = normalized;
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

/**
 * `enabled`는 두 상태가 아니라 셋이다: 켬, 끔, 그리고 «읽지 못함».
 *
 * boolean이 아닌 값을 전부 기본값(false)으로 보내면, 읽지 못한 설정이 「끔」과 구별되지 않는다.
 * 그 방향이 위험한 이유는 의료비가 «비용»이기 때문이다 — 조용히 꺼지면 월 30만원 의료비와
 * 80세 이후 월 150만원 장기요양, 3,000만원 충격이 20년 계획에서 통째로 빠지고, 계획은 실제보다
 * 안전해 «보인다». 반대 방향(잘못 켜짐)은 계획을 비관적으로 만들 뿐이라 훨씬 낫다.
 *
 * 그래서 키가 «없을 때»와 «읽지 못했을 때»를 가른다. 없으면 지정한 적 없는 것이므로 제품
 * 기본값(false)이 맞다. 있는데 boolean이 아니면 사용자가 이 패널을 건드린 흔적이므로, 나머지
 * 필드가 살아 있는 쪽(= 켜 둔 상태로 저장됐을 가능성)을 택한다. 어느 쪽이든 이 대체는
 * collectNormalizationIssues가 보고하므로 흔적 없이 지나가지 않는다.
 */
function healthcareEnabled(value: Record<string, unknown>): boolean {
  if (typeof value.enabled === 'boolean') return value.enabled;
  if (!('enabled' in value)) return DEFAULT_HEALTHCARE.enabled;
  return true;
}
function normalizeHealthcare(value: unknown): HealthcareAssumptions | undefined {
  if (!isRecord(value)) return undefined;
  return {
    enabled: healthcareEnabled(value),
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
 * 순서를 지어내지 않으려고 깨진 priority는 뒤로 보낸다. `index + 1`을 쓰면 안 된다 —
 * normalizeRetirementGoals가 priority 오름차순으로 정렬하므로 첫 원소의 깨진 priority가 1이
 * 되어 «가장 높은 우선순위»가 되고, 유효한 priority를 가진 다른 목표를 전부 제친다. 게다가
 * 목표는 5개로 잘리므로(MAX_RETIREMENT_GOALS) 그 사이 사용자가 실제로 고른 목표가 밀려날 수
 * 있다. 값을 읽지 못한 목표에 최상위 순위를 주는 것은 순서를 지어내는 일이다.
 *
 * 같은 값을 쓰므로 깨진 것끼리는 저장 순서를 지킨다 — Array.prototype.sort가 안정 정렬이다.
 */
function normalizeGoals(value: unknown): RetirementGoal[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter((raw): boolean =>
      typeof raw.type === 'string'
      && (RETIREMENT_GOAL_TYPES as readonly string[]).includes(raw.type))
    .map((raw) => ({
      type: raw.type as RetirementGoalType,
      priority: finite(raw.priority, Number.MAX_SAFE_INTEGER),
      targetValue: optionalFinite(raw.targetValue),
      constraintType: oneOf(raw.constraintType, ['HARD', 'SOFT'], 'SOFT'),
    }));
}
