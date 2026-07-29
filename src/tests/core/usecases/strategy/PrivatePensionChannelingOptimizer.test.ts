import { describe, test, expect, vi, afterEach } from 'vitest';
import {
  isChannelingTransferPensionId,
  NEW_PENSION_ID,
  optimizePrivatePensionChanneling,
} from '@/core/usecases/strategy/PrivatePensionChannelingOptimizer';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { DomainError } from '@/core/entities/errors';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { PrivatePension, SimulationParams, SimulationResult, UtilityBreakdown } from '@/core/entities/types';

vi.mock('@/core/usecases/utility/UtilityEngine', () => ({
  computeLifetimeUtility: vi.fn((result: SimulationResult) => ({
    score: result.retirementScore,
    components: { consumption: 0, depletionSafety: 0, pensionUtilization: 0, taxEfficiency: 0, taxationRisk: 0, bequestAdequacy: 0 },
  })),
}));

const zeroComponents = { consumption: 0, depletionSafety: 0, pensionUtilization: 0, taxEfficiency: 0, taxationRisk: 0, bequestAdequacy: 0 };

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  isaAccounts: [],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

function makePension(overrides: Partial<SimulationParams['privatePensions'][number]> = {}) {
  return {
    id: 'p1',
    type: 'irp' as const,
    investmentType: 'deposit' as const,
    balance: 100000000,
    monthlyContribution: 0,
    annualReturn: 4,
    dividendYield: 0,
    currency: 'KRW' as const,
    ...overrides,
  };
}

function makeIsa(overrides: Partial<NonNullable<SimulationParams['isaAccounts']>[number]> = {}) {
  return {
    id: 'isa1',
    type: 'general' as const,
    balance: 0,
    monthlyContribution: 0,
    annualReturn: 5,
    dividendYield: 2,
    currency: 'KRW' as const,
    maturityYears: 3,
    ...overrides,
  };
}

function makeResult(retirementScore: number): SimulationResult {
  return {
    yearlyResults: [],
    fireAge: null,
    depletionAge: null,
    endingAssets: 0,
    retirementScore,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };
}

const bestUtility: UtilityBreakdown = { score: 70, components: zeroComponents };
const bestResult = makeResult(70);

// 후보 params를 보고 어떤 레그인지 식별한다. 호출 순서에 의존하지 않고 레그별 점수를 주기 위한 헬퍼.
type Leg = 'channeling' | 'newPension' | 'combined';

// 금액(750,000원)이 아니라 id로 식별한다 — 기존 계좌 납입 합계가 우연히 750,000원이면 이전용
// 계좌를 신규 계좌로 오인해 채널링 후보가 'combined'로 잘못 분류된다.
function isNewAccount(p: PrivatePension): boolean {
  return p.id === NEW_PENSION_ID;
}

function transferAccounts(params: SimulationParams): PrivatePension[] {
  return params.privatePensions.filter((p) => isChannelingTransferPensionId(p.id));
}

// 납입 중인 계좌들의 "운용 프로필" 멀티셋. 채널링 후보는 이 멀티셋을 baseline과 동일하게 유지해야
// 한다 — 금액만 보존하고 수익률·투자종류를 바꾸면 측정하려는 채널링 효과보다 큰 편향이 섞인다.
function contributionProfile(params: SimulationParams): string[] {
  return params.privatePensions
    .filter((p) => p.monthlyContribution > 0)
    .map((p) => `${p.annualReturn}|${p.investmentType}|${p.dividendYield}|${p.monthlyContribution}|${p.currency}`)
    .sort();
}

function legOf(params: SimulationParams): Leg {
  const hasChanneling = params.privatePensions.some((p) => p.earlyChannelingEnabled);
  const hasNewAccount = params.privatePensions.some(isNewAccount);
  if (hasChanneling && hasNewAccount) return 'combined';
  if (hasChanneling) return 'channeling';
  return 'newPension';
}

// 레그별 점수를 지정해 mock 엔진을 만든다(지정하지 않은 레그는 baseline과 동점 = 비개선).
function makeEngineByLeg(scores: Partial<Record<Leg, number>>) {
  const runForUtility = vi.fn((params: SimulationParams) => makeResult(scores[legOf(params)] ?? 70));
  return { engine: { runForUtility } as unknown as SimulationEngine, runForUtility };
}

function paramsWithBothLegs(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return { ...baseParams, privatePensions: [makePension()], isaAccounts: [makeIsa()], ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('optimizePrivatePensionChanneling - 전제 조건', () => {
  test('사적연금이 없으면 두 레그 모두 평가하지 않는다', () => {
    const { engine, runForUtility } = makeEngineByLeg({});
    const params = { ...baseParams, privatePensions: [], isaAccounts: [makeIsa()] };

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(result.recommendedNewPensionContribution).toBeNull();
    expect(result.itemizedContributions).toEqual([]);
    expect(result.finalResult).toBe(bestResult);
    expect(result.finalUtility).toBe(bestUtility);
    expect(result.attemptedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(runForUtility).not.toHaveBeenCalled();
  });

  test('ISA가 없으면 채널링 레그는 평가하지 않지만 신규계좌 레그는 평가한다', () => {
    const { engine, runForUtility } = makeEngineByLeg({ newPension: 80 });
    const params = { ...baseParams, privatePensions: [makePension()], isaAccounts: [] };

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(runForUtility).toHaveBeenCalledTimes(1);
    expect(result.attemptedCount).toBe(1);
    expect(legOf(runForUtility.mock.calls[0][0])).toBe('newPension');
    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(result.recommendedNewPensionContribution).toBe(true);
  });

  test('retirementAge가 55 이하면 채널링 레그는 평가하지 않는다(브릿지 구간 없음)', () => {
    const { engine, runForUtility } = makeEngineByLeg({ newPension: 80 });
    const params = paramsWithBothLegs({
      userProfile: { ...baseParams.userProfile, retirementAge: 55 },
    });

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(runForUtility).toHaveBeenCalledTimes(1);
    expect(legOf(runForUtility.mock.calls[0][0])).toBe('newPension');
    expect(result.recommendedPrivatePensionChanneling).toBeNull();
  });

  test('currentAge가 retirementAge 이상이면 신규계좌 레그도 평가하지 않는다(납입 기간 없음)', () => {
    const { engine, runForUtility } = makeEngineByLeg({ channeling: 80, newPension: 80 });
    const params = paramsWithBothLegs({
      userProfile: { ...baseParams.userProfile, currentAge: 60, retirementAge: 60 },
    });

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(runForUtility).not.toHaveBeenCalled();
    expect(result.attemptedCount).toBe(0);
    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(result.recommendedNewPensionContribution).toBeNull();
  });
});

describe('optimizePrivatePensionChanneling - 채널링 레그 params', () => {
  test('채널링 후보에는 기존 계좌 전부가 켜지고 신규 계좌는 추가되지 않는다', () => {
    const { engine, runForUtility } = makeEngineByLeg({ channeling: 80 });
    const params = paramsWithBothLegs({
      privatePensions: [makePension({ id: 'existing-1' }), makePension({ id: 'existing-2' })],
      withdrawalPlan: { nationalPensionStartAge: 63, isaMaturityDestination: 'pension' },
    });

    optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    const channelingParams = runForUtility.mock.calls.map((c) => c[0]).find((p) => legOf(p) === 'channeling')!;
    expect(channelingParams.privatePensions).toHaveLength(2);
    expect(channelingParams.privatePensions.every((p) => p.earlyChannelingEnabled === true)).toBe(true);
    expect(channelingParams.privatePensions.some(isNewAccount)).toBe(false);
    expect(channelingParams.withdrawalPlan?.isaMaturityDestination).toBe('asset');
    // withdrawalPlan의 다른 필드는 보존한다(객체 전체를 갈아치우지 않는다).
    expect(channelingParams.withdrawalPlan?.nationalPensionStartAge).toBe(63);
  });

  test('채널링 후보는 기존 계좌 납입을 신규 계좌로 이전해 순유입을 보존한다', () => {
    const { engine, runForUtility } = makeEngineByLeg({ channeling: 80 });
    const params = paramsWithBothLegs({
      privatePensions: [makePension({ id: 'existing-1', monthlyContribution: 500000 })],
    });

    optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    const channelingParams = runForUtility.mock.calls.map((c) => c[0]).find((p) => legOf(p) === 'channeling')!;
    const existing = channelingParams.privatePensions.find((p) => p.id === 'existing-1')!;
    expect(existing.monthlyContribution).toBe(0);

    const transfer = transferAccounts(channelingParams);
    expect(transfer).toHaveLength(1);
    expect(transfer[0].monthlyContribution).toBe(500000);
    expect(transfer[0].balance).toBe(0);
    // 순유입 보존: 후보의 납입 합계 === baseline의 납입 합계
    const sum = (ps: PrivatePension[]) => ps.reduce((s, p) => s + p.monthlyContribution, 0);
    expect(sum(channelingParams.privatePensions)).toBe(sum(params.privatePensions));
  });

  test('이전용 계좌는 원본 계좌마다 하나씩 만들어 운용 프로필(수익률/투자종류/배당률/통화)까지 보존한다', () => {
    // 퇴직연금(2%, 예금) + 연금저축(8%, ETF)은 흔한 구성이다. 이전용 계좌를 하나로 합치면
    // 8%로 굴러야 할 납입이 2%로 굴러(또는 그 반대로) 채널링 효과보다 훨씬 큰 편향이 생긴다.
    const { engine, runForUtility } = makeEngineByLeg({ channeling: 80 });
    const params = paramsWithBothLegs({
      privatePensions: [
        makePension({ id: 'p-low', monthlyContribution: 500000, annualReturn: 2, investmentType: 'deposit', dividendYield: 0 }),
        makePension({ id: 'p-high', monthlyContribution: 500000, annualReturn: 8, investmentType: 'etf', dividendYield: 3 }),
      ],
    });

    optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    const channelingParams = runForUtility.mock.calls.map((c) => c[0]).find((p) => legOf(p) === 'channeling')!;
    expect(transferAccounts(channelingParams)).toHaveLength(2);
    // 핵심 불변식: 납입 중인 계좌들의 (수익률, 투자종류, 배당률, 납입액, 통화) 멀티셋이 baseline과 동일하다.
    expect(contributionProfile(channelingParams)).toEqual(contributionProfile(params));
    // 배열 순서를 뒤집어도 결과가 같아야 한다(합산 방식은 privatePensions[0]에 의존해 부호가 뒤집혔다).
    const reversed = { ...params, privatePensions: [...params.privatePensions].reverse() };
    const { engine: engine2, runForUtility: run2 } = makeEngineByLeg({ channeling: 80 });
    optimizePrivatePensionChanneling(reversed, bestResult, bestUtility, engine2, DEFAULT_UTILITY_CONFIG);
    const reversedChanneling = run2.mock.calls.map((c) => c[0]).find((p) => legOf(p) === 'channeling')!;
    expect(contributionProfile(reversedChanneling)).toEqual(contributionProfile(channelingParams));
  });

  test('이전용 계좌는 채널링 대상이 아니다(브릿지 구간에 곧바로 인출되면 순유입 보존이 무의미해진다)', () => {
    const { engine, runForUtility } = makeEngineByLeg({ channeling: 80 });
    const params = paramsWithBothLegs({
      privatePensions: [
        makePension({ id: 'existing-1', monthlyContribution: 500000 }),
        makePension({ id: 'existing-2', monthlyContribution: 300000 }),
      ],
    });

    optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    const channelingParams = runForUtility.mock.calls.map((c) => c[0]).find((p) => legOf(p) === 'channeling')!;
    const transfer = transferAccounts(channelingParams);
    expect(transfer).toHaveLength(2);
    expect(transfer.every((p) => !p.earlyChannelingEnabled)).toBe(true);
  });

  test('기존 계좌 납입이 0이면 이전용 계좌를 만들지 않는다', () => {
    const { engine, runForUtility } = makeEngineByLeg({ channeling: 80 });
    const params = paramsWithBothLegs({
      privatePensions: [makePension({ id: 'existing-1', monthlyContribution: 0 })],
    });

    optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    const channelingParams = runForUtility.mock.calls.map((c) => c[0]).find((p) => legOf(p) === 'channeling')!;
    expect(channelingParams.privatePensions).toHaveLength(1);
    expect(channelingParams.privatePensions[0].id).toBe('existing-1');
  });

  test('통화가 섞여 있어도 각 이전용 계좌가 원본 통화·금액을 그대로 쓰므로 환율 환산이 필요 없다', () => {
    // 예전 구현은 합계를 KRW로 환산해 하나의 계좌로 묶느라 엔진의 private getExchangeRate를
    // 복제해야 했다(환율이 어긋나면 순유입 보존이 깨지는 취약한 결합). 계좌별 이전으로 바뀌면서
    // 환산 자체가 사라졌으므로, 환율 시나리오를 바꿔도 후보 params는 달라지지 않아야 한다.
    const build = (exchangeScenario: SimulationParams['exchangeScenario']) => {
      const { engine, runForUtility } = makeEngineByLeg({ channeling: 80 });
      const params = paramsWithBothLegs({
        privatePensions: [
          makePension({ id: 'krw-1', monthlyContribution: 100000, currency: 'KRW' }),
          makePension({ id: 'usd-1', monthlyContribution: 100, currency: 'USD' }),
        ],
        baseExchangeRate: 1000,
        exchangeScenario,
      });
      optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);
      return runForUtility.mock.calls.map((c) => c[0]).find((p) => legOf(p) === 'channeling')!;
    };

    const base = build('base');
    const transfers = transferAccounts(base);
    expect(transfers).toHaveLength(2);
    expect(transfers.find((p) => p.currency === 'USD')!.monthlyContribution).toBe(100);
    expect(transfers.find((p) => p.currency === 'KRW')!.monthlyContribution).toBe(100000);
    expect(contributionProfile(build('usd_up'))).toEqual(contributionProfile(base));
  });
});

describe('optimizePrivatePensionChanneling - 신규계좌 레그 params', () => {
  test('신규계좌 후보는 채널링을 켜지 않고 월 75만원 계좌만 추가한다', () => {
    const { engine, runForUtility } = makeEngineByLeg({ newPension: 80 });
    const params = paramsWithBothLegs({
      privatePensions: [makePension({ id: 'existing-1', monthlyContribution: 300000, annualReturn: 3, investmentType: 'etf', dividendYield: 1 })],
      withdrawalPlan: { nationalPensionStartAge: 63, isaMaturityDestination: 'pension' },
    });

    optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    const newParams = runForUtility.mock.calls.map((c) => c[0]).find((p) => legOf(p) === 'newPension')!;
    expect(newParams.privatePensions).toHaveLength(2);
    const existing = newParams.privatePensions.find((p) => p.id === 'existing-1')!;
    expect(existing.earlyChannelingEnabled).toBeFalsy();
    expect(existing.monthlyContribution).toBe(300000); // 기존 납입은 그대로 유지
    const added = newParams.privatePensions.find((p) => p.id !== 'existing-1')!;
    expect(added.monthlyContribution).toBe(750000);
    expect(added.balance).toBe(0);
    // 신규 계좌는 템플릿 계좌의 운용 조건을 복사한다
    expect(added.annualReturn).toBe(3);
    expect(added.investmentType).toBe('etf');
    expect(added.dividendYield).toBe(1);
    // withdrawalPlan은 건드리지 않는다
    expect(newParams.withdrawalPlan?.isaMaturityDestination).toBe('pension');
  });

  test('신규 계좌의 통화는 템플릿과 무관하게 항상 KRW다', () => {
    const { engine, runForUtility } = makeEngineByLeg({ newPension: 80, channeling: 80, combined: 90 });
    const params = paramsWithBothLegs({
      privatePensions: [makePension({ id: 'usd-1', currency: 'USD', monthlyContribution: 100 })],
    });

    optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    // 750000은 원화 법정 한도이므로 USD로 해석되면 안 된다.
    const newAccounts = runForUtility.mock.calls.flatMap((c) => c[0].privatePensions.filter(isNewAccount));
    expect(newAccounts.length).toBeGreaterThan(0);
    expect(newAccounts.every((p) => p.currency === 'KRW')).toBe(true);
    // 반면 이전용 계좌는 원본 통화(USD)를 그대로 유지한다 — 금액을 환산하지 않기 때문이다.
    const transfers = runForUtility.mock.calls.flatMap((c) => transferAccounts(c[0]));
    expect(transfers.length).toBeGreaterThan(0);
    expect(transfers.every((p) => p.currency === 'USD' && p.monthlyContribution === 100)).toBe(true);
  });
});

describe('optimizePrivatePensionChanneling - 채택 판정', () => {
  test('채널링만 유리하면 채널링만 채택한다', () => {
    const { engine, runForUtility } = makeEngineByLeg({ channeling: 80, newPension: 65 });
    const params = paramsWithBothLegs();

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBe(true);
    expect(result.recommendedNewPensionContribution).toBeNull();
    expect(result.itemizedContributions).toHaveLength(1);
    expect(result.itemizedContributions[0].label).toContain('사적연금을 55세부터');
    expect(result.itemizedContributions[0].utilityDelta).toBe(10);
    expect(result.finalUtility.score).toBe(80);
    expect(runForUtility).toHaveBeenCalledTimes(2);
    expect(result.attemptedCount).toBe(2);
  });

  test('신규계좌만 유리하면 신규계좌만 채택한다', () => {
    const { engine } = makeEngineByLeg({ channeling: 60, newPension: 85 });
    const params = paramsWithBothLegs();

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(result.recommendedNewPensionContribution).toBe(true);
    expect(result.itemizedContributions).toHaveLength(1);
    expect(result.itemizedContributions[0].label).toContain('월 75만원');
    expect(result.itemizedContributions[0].utilityDelta).toBe(15);
    expect(result.finalUtility.score).toBe(85);
  });

  test('두 레그가 모두 유리하면 둘 다 채택하고 항목도 2개다', () => {
    const { engine, runForUtility } = makeEngineByLeg({ channeling: 75, newPension: 80, combined: 90 });
    const params = paramsWithBothLegs();

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBe(true);
    expect(result.recommendedNewPensionContribution).toBe(true);
    expect(result.itemizedContributions).toHaveLength(2);
    // 순서: 채널링 → 신규계좌
    expect(result.itemizedContributions[0].label).toContain('사적연금을 55세부터');
    expect(result.itemizedContributions[1].label).toContain('월 75만원');
    expect(result.itemizedContributions[0].utilityDelta).toBe(5);
    expect(result.itemizedContributions[1].utilityDelta).toBe(10);
    // finalResult는 두 레그를 함께 적용한 통합 시뮬레이션 결과다
    expect(result.finalUtility.score).toBe(90);
    expect(runForUtility).toHaveBeenCalledTimes(3);
    expect(result.attemptedCount).toBe(3);
    expect(legOf(runForUtility.mock.calls[2][0])).toBe('combined');
  });

  test('통합 결과가 baseline보다는 낫지만 단일 레그보다 나쁘면 그 단일 레그를 채택한다', () => {
    // 레그 간 상호작용이 sub-additive인 경우다: 통합(85)이 baseline(70)보다는 개선이지만 이미
    // 검증해 둔 채널링 단독(90)보다 나쁘다. 세 후보 모두 계산이 끝나 있으므로 최고점을 골라야 한다.
    const { engine, runForUtility } = makeEngineByLeg({ channeling: 90, newPension: 80, combined: 85 });
    const params = paramsWithBothLegs();

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBe(true);
    expect(result.recommendedNewPensionContribution).toBeNull();
    expect(result.itemizedContributions).toHaveLength(1);
    expect(result.itemizedContributions[0].label).toContain('사적연금을 55세부터');
    expect(result.itemizedContributions[0].utilityDelta).toBe(20);
    expect(result.finalUtility.score).toBe(90);
    expect(result.finalResult.retirementScore).toBe(90);
    expect(runForUtility).toHaveBeenCalledTimes(3);
    expect(result.attemptedCount).toBe(3);
  });

  test('통합이 단일 레그와 동점이면 더 적은 행동을 요구하는 단일 레그를 채택한다', () => {
    const { engine } = makeEngineByLeg({ channeling: 75, newPension: 90, combined: 90 });
    const params = paramsWithBothLegs();

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(result.recommendedNewPensionContribution).toBe(true);
    expect(result.itemizedContributions).toHaveLength(1);
    expect(result.finalUtility.score).toBe(90);
  });

  test('통합 결과가 baseline보다 나쁘면 더 나은 단일 레그만 채택한다', () => {
    const { engine } = makeEngineByLeg({ channeling: 75, newPension: 80, combined: 60 });
    const params = paramsWithBothLegs();

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(result.recommendedNewPensionContribution).toBe(true);
    expect(result.itemizedContributions).toHaveLength(1);
    expect(result.finalUtility.score).toBe(80);
    expect(result.attemptedCount).toBe(3);
  });

  test('두 레그 모두 불리하면 no-op이고 finalResult/finalUtility는 입력 그대로다', () => {
    const { engine } = makeEngineByLeg({ channeling: 60, newPension: 65 });
    const params = paramsWithBothLegs();

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(result.recommendedNewPensionContribution).toBeNull();
    expect(result.itemizedContributions).toEqual([]);
    expect(result.finalResult).toBe(bestResult);
    expect(result.finalUtility).toBe(bestUtility);
    expect(result.attemptedCount).toBe(2);
    expect(result.failedCount).toBe(0);
  });

  test('baseline과 동점이면 채택하지 않는다', () => {
    const { engine } = makeEngineByLeg({ channeling: 70, newPension: 70 });
    const params = paramsWithBothLegs();

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(result.recommendedNewPensionContribution).toBeNull();
  });
});

describe('optimizePrivatePensionChanneling - 실패 처리', () => {
  test('한 레그가 DomainError로 실패해도 다른 레그는 계속 평가하고 failedCount를 센다', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runForUtility = vi.fn((params: SimulationParams) => {
      if (legOf(params) === 'channeling') throw new DomainError('평가 실패');
      return makeResult(85);
    });
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = paramsWithBothLegs();

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.failedCount).toBe(1);
    expect(result.attemptedCount).toBe(2);
    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(result.recommendedNewPensionContribution).toBe(true);
    expect(result.finalUtility.score).toBe(85);
  });

  test('통합 검증이 DomainError로 실패하면 더 나은 단일 레그로 폴백하고 failedCount를 센다', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runForUtility = vi.fn((params: SimulationParams) => {
      const leg = legOf(params);
      if (leg === 'combined') throw new DomainError('통합 평가 실패');
      return makeResult(leg === 'channeling' ? 90 : 80);
    });
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = paramsWithBothLegs();

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.failedCount).toBe(1);
    expect(result.attemptedCount).toBe(3);
    expect(result.recommendedPrivatePensionChanneling).toBe(true);
    expect(result.recommendedNewPensionContribution).toBeNull();
    expect(result.finalUtility.score).toBe(90);
  });

  test('두 레그 모두 DomainError면 no-op이고 failedCount는 2다', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runForUtility = vi.fn((_params: SimulationParams) => {
      throw new DomainError('평가 실패');
    });
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = paramsWithBothLegs();

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.attemptedCount).toBe(2);
    expect(result.failedCount).toBe(2);
    expect(result.finalResult).toBe(bestResult);
    expect(result.finalUtility).toBe(bestUtility);
  });

  test('DomainError가 아닌 예외는 그대로 다시 던진다', () => {
    const runForUtility = vi.fn((_params: SimulationParams) => {
      throw new Error('예상치 못한 버그');
    });
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = paramsWithBothLegs();

    expect(() =>
      optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG)
    ).toThrow('예상치 못한 버그');
  });
});

describe('optimizePrivatePensionChanneling - SimulationEngine 회귀', () => {
  test('Fix 1 회귀: maturityYears=3(실제 기본값)이고 비-연금 자산이 있을 때, 채널링된 연금 잔액이 브릿지 구간(55~59세) 동안 단조 감소한다(ISA 만기로 인한 잔액 증가 없음)', () => {
    const realEngine = new SimulationEngine();
    // optimizer가 만드는 채널링 후보와 동일한 형태(earlyChannelingEnabled: true,
    // monthlyContribution: 0, isaMaturityDestination: 'asset')로 엔진 동작 자체를 검증한다.
    const params: SimulationParams = {
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
      assets: [
        {
          id: 'asset-1',
          type: 'etf',
          ticker: 'TEST',
          name: '일반자산',
          quantity: 1,
          averagePrice: 100000000,
          annualGrowthRate: 5,
          dividendYield: 0,
          monthlyContribution: 0,
          reinvestDividend: false,
          currency: 'KRW',
        },
      ],
      nationalPension: { expectedMonthlyAmount: 1000000 },
      privatePensions: [makePension({ id: 'existing-1', balance: 200000000, monthlyContribution: 0, earlyChannelingEnabled: true })],
      isaAccounts: [makeIsa({ maturityYears: 3 })],
      otherIncomes: [],
      inflationRate: 2,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
      withdrawalPlan: { isaMaturityDestination: 'asset' },
    };

    const candidateResult = realEngine.run(params);

    const bridgeYearBalances = candidateResult.yearlyResults
      .filter((r) => r.age >= 55 && r.age < 60)
      .map((r) => r.pensionAssets);

    expect(bridgeYearBalances.length).toBeGreaterThan(0);
    for (let i = 1; i < bridgeYearBalances.length; i++) {
      expect(bridgeYearBalances[i]).toBeLessThanOrEqual(bridgeYearBalances[i - 1]);
    }
  });
});
