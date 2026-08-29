// 대량 시나리오 생성기 — 「일반 사람들이 실제로 넣을 법한」 입력 1,000건.
//
// **personas.ts와 목적이 다르다.** 그쪽은 축을 교차해 «의도적으로 설계한» 54명이고, 엣지
// 케이스(연금 전무·100세 장수·고배당 편중·의료비 충격)를 일부러 넣어 엔진의 경계를 친다.
// 이쪽은 반대로 «흔한 것이 흔하게 나오도록» 뽑는다 — 분포의 가운데에서 제품이 어떻게
// 동작하는지는 손으로 고른 54명으로는 알 수 없기 때문이다. 둘 다 필요하고, 서로를 대체하지
// 않는다.
//
// **무작위이되 결정론이다.** mulberry32를 고정 시드로 돌리므로 같은 코드는 언제나 같은
// 1,000건을 만든다. 그래야 엔진을 고친 전후의 출력을 그대로 diff할 수 있다.
//
// **모든 입력은 화면에서 만들 수 있는 것만 쓴다**(AGENTS.md 「도달 가능성 5단계」).
//   1단계 개인정보 — 현재 나이, 기대수명
//   2단계 자산정보 — 투자자산, 국민연금 예상액, 사적연금, ISA, 기타소득
//   3단계 은퇴 목표 — 목표 1~5개, 우선순위, HARD/SOFT, 목표값 확정 여부
// 은퇴 나이·목표 생활비·목표 상속자산은 «직접 넣지 않는다». 목표에서 파생시킨다
// (applyRetirementGoals → normalizeGoalDrivenParams). 그것이 오늘 제품의 유일한 경로다.
//
// 분포의 근거는 아래 각 상수 옆에 적었다. 없는 숫자를 지어내지 않으려 했으나, 공개 통계가
// 그대로 들어맞지 않는 축(자산 구성 비율 등)은 «그럴듯한 범위»를 택한 것이며 그 사실을
// 밝힌다. 이 하니스의 결론은 절대 수준이 아니라 «분포 안에서 제품이 어떻게 갈리는가»다.
import {
  SimulationParams, InvestmentAsset, PrivatePension, IsaAccount, HealthcareAssumptions,
} from '@/core/entities/types';
import type { RetirementGoal, RetirementGoalType } from '@/core/entities/retirementGoal';
import { applyRetirementGoals } from '@/core/usecases/goals/retirementGoalAdapter';
import { applyYieldPreset } from '@/core/usecases/scenario/applyYieldPreset';
import { isQuantitativelyJudgedGoal } from '@/core/usecases/goals/goalSuccessConditions';
import { resolveTaxSettings } from '@/core/usecases/tax/taxRates';

const 만 = 10_000;
const 억 = 100_000_000;

// 시나리오 간 비교 가능성을 위해 고정한다. 환율·물가는 이 하니스가 재려는 축이 아니다.
const FX = 1400;
const INFLATION = 2.5;

export type Cohort = '30대' | '40대' | '50대' | '60대';
export type YieldPreset = 'conservative' | 'base' | 'aggressive';

export interface MassScenarioMeta {
  cohort: Cohort;
  currentAge: number;
  expectancy: number;
  /** 사용자가 마음에 둔 은퇴 나이. 「빠른 은퇴」를 고르지 않으면 계획에 닿지 못한다. */
  desiredRetirementAge: number;
  /** 목표 카드에 씨앗으로 깔리는 월 생활비. 확정하지 않으면 계획의 축이 되지 못한다. */
  desiredMonthlySpending: number;
  initialAssets: number;
  npMonthly: number;
  hasPrivatePension: boolean;
  hasIsa: boolean;
  otherIncomeMonthly: number;
  healthcareEnabled: boolean;
  yieldPreset: YieldPreset;
  usdShare: number;
  monthlyContribution: number;
  goalTypes: RetirementGoalType[];
  hardGoalTypes: RetirementGoalType[];
  confirmedGoalTypes: RetirementGoalType[];
}

export interface MassScenario {
  no: number;
  meta: MassScenarioMeta;
  /** 목표 반영·정규화까지 끝난 params. 화면이 저장하는 것과 같은 모양이다. */
  params: SimulationParams;
}

// ── 결정론 난수 ────────────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  constructor(private readonly next: () => number) {}
  unit(): number { return this.next(); }
  /** [min, max] 정수 균등. */
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  range(min: number, max: number): number { return min + this.next() * (max - min); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(items: readonly T[]): T { return items[Math.floor(this.next() * items.length)]; }
  /** 가중 추출. weights의 합은 임의여도 된다. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((s, w) => s + w, 0);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i += 1) {
      roll -= weights[i];
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }
  /** 표준정규(Box–Muller). 로그정규 자산 분포에 쓴다. */
  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** 중앙값 median, 로그표준편차 sigma의 로그정규. [min, max]로 자른다. */
  logNormal(median: number, sigma: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, median * Math.exp(sigma * this.normal())));
  }
}

// ── 분포 ──────────────────────────────────────────────────────────────────────

// 은퇴 설계 서비스를 실제로 열어 보는 연령대의 분포를 가정한다. 30대는 관심은 있으나 수가
// 적고, 은퇴가 눈앞인 50대가 가장 두껍다는 통상적 관찰을 따랐다(측정된 자사 수치가 아니다).
const COHORTS: readonly Cohort[] = ['30대', '40대', '50대', '60대'];
const COHORT_WEIGHTS = [20, 28, 32, 20];

const COHORT_AGE: Record<Cohort, [number, number]> = {
  '30대': [31, 39], '40대': [40, 49], '50대': [50, 59], '60대': [60, 66],
};

// 금융자산 중앙값(원). 가계금융복지조사의 «순자산»이 아니라 이 서비스가 입력받는 «금융·연금
// 자산»이라 그보다 작다. 부동산은 이 제품의 입력 계약이 아니다.
const COHORT_ASSET_MEDIAN: Record<Cohort, number> = {
  '30대': 0.6 * 억, '40대': 1.6 * 억, '50대': 3.0 * 억, '60대': 4.0 * 억,
};
const COHORT_ASSET_SIGMA: Record<Cohort, number> = {
  '30대': 0.95, '40대': 0.95, '50대': 0.90, '60대': 0.85,
};

// 국민연금 예상 월 수령액(원). 노령연금 평균은 월 60만원대, 20년 이상 가입자는 100만원대다.
// 사용자가 「예상연금액 조회」에서 옮겨 적는 값이라 그 언저리에 몰린다.
const NP_MEDIAN = 95 * 만;

// 사적연금(연금저축·IRP·퇴직연금) 보유율. 연령이 높을수록 퇴직연금 적립분이 붙는다.
const PENSION_HOLD_RATE: Record<Cohort, number> = {
  '30대': 0.55, '40대': 0.68, '50대': 0.74, '60대': 0.62,
};
const ISA_HOLD_RATE: Record<Cohort, number> = {
  '30대': 0.40, '40대': 0.38, '50대': 0.30, '60대': 0.18,
};

// 목표 선택 빈도. 「생활비 안정」이 압도적이고 나머지가 그 뒤를 따른다고 본다.
const GOAL_WEIGHTS: ReadonlyArray<readonly [RetirementGoalType, number]> = [
  ['LIVING_EXPENSE_STABILITY', 90],
  ['ASSET_SURVIVAL', 60],
  ['EARLY_RETIREMENT', 42],
  ['COMFORTABLE_SPENDING', 32],
  ['PENSION_OPTIMIZATION', 26],
  ['RISK_REDUCTION', 22],
  ['TAX_OPTIMIZATION', 18],
  ['INHERITANCE', 15],
  ['HOUSING_STABILITY', 12],
  ['ASSET_GROWTH', 10],
];

// 카탈로그의 기본 강도(goalCatalog.ts). 화면이 그대로 깔아 주는 값이다.
const DEFAULT_CONSTRAINT: Record<RetirementGoalType, 'HARD' | 'SOFT'> = {
  LIVING_EXPENSE_STABILITY: 'SOFT',
  EARLY_RETIREMENT: 'HARD',
  ASSET_SURVIVAL: 'HARD',
  COMFORTABLE_SPENDING: 'SOFT',
  HOUSING_STABILITY: 'SOFT',
  PENSION_OPTIMIZATION: 'SOFT',
  TAX_OPTIMIZATION: 'SOFT',
  RISK_REDUCTION: 'SOFT',
  INHERITANCE: 'HARD',
  ASSET_GROWTH: 'SOFT',
};

// ── 계좌 생성 ─────────────────────────────────────────────────────────────────
function krEtf(no: number, valueKRW: number, monthly: number, ret: number, div: number): InvestmentAsset {
  return {
    id: `s${no}-kr`, type: 'etf', ticker: 'KODEX200', name: '국내 ETF',
    quantity: 1, averagePrice: valueKRW,
    totalReturn: ret, dividendYield: div,
    monthlyContribution: monthly, reinvestDividend: true,
    currency: 'KRW', assetMarket: 'KR_ETF',
  };
}

function usEtf(no: number, valueKRW: number, monthlyKRW: number, ret: number, div: number): InvestmentAsset {
  return {
    id: `s${no}-us`, type: 'etf', ticker: 'VOO', name: '미국 ETF',
    quantity: 1, averagePrice: valueKRW / FX,
    totalReturn: ret, dividendYield: div,
    monthlyContribution: Math.round(monthlyKRW / FX), reinvestDividend: true,
    currency: 'USD', assetMarket: 'US_ETF',
  };
}

function pension(no: number, type: PrivatePension['type'], balance: number, monthly: number): PrivatePension {
  return {
    id: `s${no}-${type}`, type, investmentType: 'etf',
    name: type === 'irp' ? 'IRP' : type === 'savings' ? '연금저축' : '퇴직연금',
    balance: Math.round(balance), monthlyContribution: Math.round(monthly),
    totalReturn: 4, currency: 'KRW',
  };
}

function isaAccount(no: number, balance: number, monthly: number): IsaAccount {
  return {
    id: `s${no}-isa`, type: 'general', investmentType: 'etf', name: 'ISA',
    balance: Math.round(balance), monthlyContribution: Math.round(monthly),
    totalReturn: 6, dividendYield: 2, currency: 'KRW', maturityYears: 3,
  };
}

// 의료비 가정. 화면의 기본값을 그대로 쓰되 충격 나이·금액만 흔든다.
function healthcare(rng: Rng): HealthcareAssumptions {
  return {
    enabled: true,
    costGrowthRate: 5,
    baseMonthlyCost: rng.weighted([20 * 만, 30 * 만, 40 * 만], [3, 5, 2]),
    longTermCareEnabled: rng.chance(0.6),
    longTermCareStartAge: rng.pick([78, 80, 82]),
    longTermCareMonthlyCost: rng.weighted([100 * 만, 150 * 만, 200 * 만], [3, 5, 2]),
    shockEnabled: rng.chance(0.5),
    shockAge: rng.pick([70, 75, 80]),
    shockAmount: rng.weighted([2000 * 만, 3000 * 만, 5000 * 만], [4, 4, 2]),
  };
}

// ── 목표 선택 ─────────────────────────────────────────────────────────────────
//
// 화면의 동작을 그대로 흉내낸다: 카드를 누르면 씨앗이 깔리고(defaultTarget), 강도는 카탈로그
// 기본값이며, 정량 판정 밖 목표는 HARD를 «고를 수 없다»(RetirementGoalSelector).
// 그래서 여기서도 HARD로 올리는 것은 isQuantitativelyJudgedGoal이 참인 목표뿐이다.
function chooseGoals(
  rng: Rng,
  desiredRetirementAge: number,
  desiredMonthlySpending: number,
): { goals: RetirementGoal[]; hard: RetirementGoalType[]; confirmed: RetirementGoalType[] } {
  // 고르는 개수. 1개만 고르는 사용자가 가장 흔하고 5개를 다 채우는 사람은 드물다고 본다.
  const count = rng.weighted([1, 2, 3, 4, 5], [18, 30, 27, 15, 10]);

  const pool = GOAL_WEIGHTS.map(([type, weight]) => ({ type, weight }));
  const picked: RetirementGoalType[] = [];
  while (picked.length < count && pool.length > 0) {
    const idx = (() => {
      const total = pool.reduce((s, p) => s + p.weight, 0);
      let roll = rng.unit() * total;
      for (let i = 0; i < pool.length; i += 1) {
        roll -= pool[i].weight;
        if (roll <= 0) return i;
      }
      return pool.length - 1;
    })();
    picked.push(pool[idx].type);
    pool.splice(idx, 1);
  }

  const hard: RetirementGoalType[] = [];
  const confirmed: RetirementGoalType[] = [];
  const goals: RetirementGoal[] = picked.map((type, index) => {
    // 강도: 기본값에서 출발해 사용자가 만질 수 있는 범위 안에서만 흔든다.
    let constraintType = DEFAULT_CONSTRAINT[type];
    if (isQuantitativelyJudgedGoal(type)) {
      if (constraintType === 'SOFT' && rng.chance(0.22)) constraintType = 'HARD';
      else if (constraintType === 'HARD' && rng.chance(0.30)) constraintType = 'SOFT';
    }
    if (constraintType === 'HARD') hard.push(type);

    // 씨앗(화면의 defaultTarget과 같은 규칙).
    const seed = type === 'EARLY_RETIREMENT' ? desiredRetirementAge
      : type === 'LIVING_EXPENSE_STABILITY' ? desiredMonthlySpending
        : type === 'COMFORTABLE_SPENDING' ? Math.round(desiredMonthlySpending * 1.25 / 만) * 만
          : type === 'INHERITANCE' ? Math.round(desiredMonthlySpending * 24 / 만) * 만
            : type === 'ASSET_GROWTH' ? undefined
              : undefined;

    const goal: RetirementGoal = { type, priority: index + 1, constraintType, targetValue: seed };

    // 금액 확정. 「빠른 은퇴」의 나이 목표는 씨앗 자체가 사용자 입력이라 확정 표시가 필요
    // 없다(confirmedTargetValue가 그대로 통과시킨다). 금액 목표만 확정 행위를 흉내낸다.
    const isMoneyGoal = type === 'LIVING_EXPENSE_STABILITY' || type === 'COMFORTABLE_SPENDING'
      || type === 'INHERITANCE' || type === 'ASSET_GROWTH';
    if (isMoneyGoal && seed !== undefined && rng.chance(0.55)) {
      // 확정하는 사용자의 3할은 금액을 직접 고쳐 넣는다.
      if (rng.chance(0.30)) goal.targetValue = Math.round(seed * rng.range(0.8, 1.25) / 만) * 만;
      goal.targetValueSource = 'user';
      confirmed.push(type);
    }
    return goal;
  });

  return { goals, hard, confirmed };
}

// ── 한 건 생성 ────────────────────────────────────────────────────────────────
function buildOne(no: number, rng: Rng): MassScenario {
  const cohort = rng.weighted(COHORTS, COHORT_WEIGHTS);
  const [ageMin, ageMax] = COHORT_AGE[cohort];
  const currentAge = rng.int(ageMin, ageMax);

  // 기대수명. 사람들은 통계 기대수명(약 84세)보다 길게 잡는 편이라 88~95에 몰아 둔다.
  const expectancy = rng.weighted([85, 88, 90, 92, 95, 100], [12, 24, 26, 18, 14, 6]);

  // 마음에 둔 은퇴 나이. 현재 나이보다 이르게는 두지 않는다(화면도 그렇게 막는다).
  const desiredRetirementAge = Math.min(
    expectancy - 5,
    Math.max(currentAge + 1, rng.weighted([55, 58, 60, 62, 65, 67, 70], [8, 12, 22, 18, 24, 10, 6])),
  );

  // 목표 월 생활비. 「노후 적정 생활비」 조사가 부부 300만원대, 최소 200만원대를 말한다.
  const desiredMonthlySpending = Math.round(
    rng.logNormal(300 * 만, 0.32, 150 * 만, 900 * 만) / (10 * 만),
  ) * 10 * 만;

  const initialAssets = rng.logNormal(
    COHORT_ASSET_MEDIAN[cohort], COHORT_ASSET_SIGMA[cohort], 1000 * 만, 20 * 억,
  );

  // 자산 배분: 국내만·미국만·섞기. 「미국 ETF 비중」은 최근 개인투자자 쏠림을 반영해 넓게 둔다.
  const usdShare = rng.weighted([0, 0.2, 0.4, 0.6, 0.8, 1.0], [18, 16, 20, 20, 16, 10]);

  // 은퇴 전 월 적립액. 은퇴가 가까울수록 적립 기간이 짧아 절대액이 커지는 경향만 반영한다.
  const monthlyContribution = currentAge >= desiredRetirementAge
    ? 0
    : Math.round(rng.logNormal(60 * 만, 0.85, 0, 400 * 만) / (10 * 만)) * 10 * 만;

  const yieldPreset = rng.weighted<YieldPreset>(
    ['conservative', 'base', 'aggressive'], [28, 50, 22],
  );

  // 사적연금·ISA로 흘러가는 몫. 나머지가 일반 투자계좌로 간다.
  const hasPrivatePension = rng.chance(PENSION_HOLD_RATE[cohort]);
  const hasIsa = rng.chance(ISA_HOLD_RATE[cohort]);
  const pensionShare = hasPrivatePension ? rng.range(0.15, 0.45) : 0;
  const isaShare = hasIsa ? rng.range(0.05, 0.20) : 0;
  const generalShare = Math.max(0.15, 1 - pensionShare - isaShare);

  const generalValue = initialAssets * generalShare;
  const usValue = generalValue * usdShare;
  const krValue = generalValue - usValue;

  const assets: InvestmentAsset[] = [];
  // 배당률은 프리셋이 건드리지 않는 축이라 여기서 정한다(applyYieldPreset은 총수익률만 옮긴다).
  if (krValue > 100 * 만) {
    assets.push(krEtf(no, krValue, monthlyContribution * (1 - usdShare) * generalShare, 6, rng.weighted([1.5, 2.5, 4.0], [4, 4, 2])));
  }
  if (usValue > 100 * 만) {
    assets.push(usEtf(no, usValue, monthlyContribution * usdShare * generalShare, 8, rng.weighted([1.0, 1.3, 2.5], [5, 4, 1])));
  }
  // 자산이 전부 연금·ISA로 흘러 일반계좌가 비는 경우가 있다. 실제로 있을 수 있는 상태다.

  const privatePensions: PrivatePension[] = [];
  if (hasPrivatePension) {
    const balance = initialAssets * pensionShare;
    const monthly = monthlyContribution * pensionShare;
    // 퇴직연금은 50대 이상에서 흔하고 적립액이 크다.
    if (cohort === '50대' || cohort === '60대' ? rng.chance(0.55) : rng.chance(0.25)) {
      privatePensions.push(pension(no, 'retirement', balance * 0.6, 0));
      privatePensions.push(pension(no, 'irp', balance * 0.4, monthly));
    } else if (rng.chance(0.5)) {
      privatePensions.push(pension(no, 'irp', balance, monthly));
    } else {
      privatePensions.push(pension(no, 'savings', balance, monthly));
    }
  }

  const isaAccounts: IsaAccount[] = hasIsa
    ? [isaAccount(no, initialAssets * isaShare, monthlyContribution * isaShare)]
    : [];

  // 국민연금. 자산 규모와 약하게만 상관시킨다 — 가입 이력은 소득의 함수이지 자산의 함수가
  // 아니다. 자영업·경력단절로 크게 낮은 사람도 실제로 있다.
  const npBase = rng.logNormal(NP_MEDIAN, 0.42, 20 * 만, 260 * 만);
  const npMonthly = Math.round(
    (rng.chance(0.12) ? npBase * 0.45 : npBase) / (5 * 만),
  ) * 5 * 만;

  const otherIncomeMonthly = rng.chance(0.22)
    ? Math.round(rng.logNormal(70 * 만, 0.7, 10 * 만, 500 * 만) / (10 * 만)) * 10 * 만
    : 0;

  const healthcareEnabled = rng.chance(0.40);

  const base: SimulationParams = {
    userProfile: {
      currentAge,
      // 목표가 정하기 «전»의 값. 「빠른 은퇴」를 고르지 않으면 정규화가 65세로 덮는다.
      retirementAge: desiredRetirementAge,
      expectancy,
      targetMonthlySpending: desiredMonthlySpending,
    },
    assets,
    nationalPension: { expectedMonthlyAmount: npMonthly },
    privatePensions,
    isaAccounts,
    otherIncomes: otherIncomeMonthly > 0
      ? [{ id: `s${no}-oi`, label: '임대/부업 소득', monthlyAmount: otherIncomeMonthly, currency: 'KRW' }]
      : [],
    inflationRate: INFLATION,
    inflationMode: 'real',
    baseExchangeRate: FX,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    useLatestExchangeRate: false,
    spendingStrategy: 'target',
    taxSettings: resolveTaxSettings(),
    ...(healthcareEnabled ? { healthcare: healthcare(rng) } : {}),
  };

  // 「수익률 일괄 채우기」를 누른 상태. 화면이 하는 것과 같은 함수를 지난다.
  const withYield = applyYieldPreset(base, yieldPreset);

  const { goals, hard, confirmed } = chooseGoals(rng, desiredRetirementAge, desiredMonthlySpending);
  const params = applyRetirementGoals(withYield, goals);

  return {
    no,
    meta: {
      cohort, currentAge, expectancy, desiredRetirementAge, desiredMonthlySpending,
      initialAssets: Math.round(initialAssets), npMonthly,
      hasPrivatePension, hasIsa, otherIncomeMonthly, healthcareEnabled, yieldPreset,
      usdShare, monthlyContribution,
      goalTypes: goals.map((g) => g.type), hardGoalTypes: hard, confirmedGoalTypes: confirmed,
    },
    params,
  };
}

/**
 * 시드 고정 1,000건. 시드를 바꾸면 전혀 다른 표본이 되므로, 전후 비교를 하려면 같은 시드를
 * 쓸 것. 각 건마다 «자기 시드»의 난수열을 쓰는 이유: 건수를 바꿔도 앞쪽 시나리오가 그대로
 * 남아, 100건으로 시험한 결과가 1,000건 결과의 부분집합이 된다.
 */
export const MASS_SCENARIO_SEED = 20260829;

export function buildMassScenarios(count = 1000): MassScenario[] {
  const scenarios: MassScenario[] = [];
  for (let i = 1; i <= count; i += 1) {
    scenarios.push(buildOne(i, new Rng(mulberry32(MASS_SCENARIO_SEED + i * 7919))));
  }
  return scenarios;
}
