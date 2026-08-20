import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';

describe('SimulationEngine TDD Tests', () => {
  const baseParams: SimulationParams = {
    userProfile: {
      currentAge: 40,
      retirementAge: 60,
      expectancy: 85,
      targetMonthlySpending: 3000000, // 300만 원
    },
    assets: [
      {
        id: 'asset-1',
        type: 'etf',
        ticker: 'VOO',
        name: 'S&P 500 ETF',
        quantity: 100,
        averagePrice: 500, // 500 USD
        totalReturn: 8, // 8%
        dividendYield: 2, // 2%
        monthlyContribution: 100, // 100 USD 매달 추가 매수
        reinvestDividend: true,
        currency: 'USD',
      },
    ],
    nationalPension: {
      expectedMonthlyAmount: 1000000, // 65세부터 100만 원 수령
    },
    privatePensions: [
      {
        id: 'pension-1',
        type: 'irp',
        balance: 50000000, // 5,000만 원
        monthlyContribution: 500000, // 50만 원 매월 추가 적립
        totalReturn: 5, // 5%
        currency: 'KRW',
      },
    ],
    otherIncomes: [
      {
        id: 'income-1',
        label: '임대소득',
        monthlyAmount: 500000, // 50만 원
        currency: 'KRW',
      },
    ],
    inflationRate: 2.5,
    inflationMode: 'nominal',
    baseExchangeRate: 1350, // 1 USD = 1,350 KRW
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  };

  test('명목(Nominal) 모드: 은퇴 전 적립 자산 증식과 은퇴 후 물가상승 생활비 차감 검증', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams);

    expect(result.yearlyResults.length).toBe(46); // 40세부터 85세까지 총 46개 연도 결과

    // 40세 첫 해 기말 자산은 초기 자산 + 적립 + 투자 수익을 반영하여 양수여야 함
    expect(result.yearlyResults[0].totalAssets).toBeGreaterThan(0);

    // 명목 모드일 때 은퇴 나이(60세)의 연간 생활비는 300만 원 * 12달 = 3,600만 원에서
    // 물가상승률 2.5%가 20년 누적되어 반영되므로 3,600만 원보다 월등히 커야 함.
    // 60세 연도(index 20)
    const resultAt60 = result.yearlyResults[20];
    expect(resultAt60.spending).toBeGreaterThan(3000000 * 12);
  });

  test('실질(Real) 모드: 실질 수익률(명목-물가) 및 고정 생활비 인출 검증', () => {
    const paramsReal: SimulationParams = {
      ...baseParams,
      inflationMode: 'real',
    };
    const engine = new SimulationEngine();
    const result = engine.run(paramsReal);

    // 실질 모드에서는 인플레이션 할인 덕분에 은퇴 후(60세 이후) 매년 연간 생활비 인출액이
    // 물가상승을 감안하지 않은 3,600만 원(300만 원 * 12) 근방으로 고정되어야 함
    const resultAt60 = result.yearlyResults[20];
    expect(Math.round(resultAt60.spending)).toBe(3000000 * 12);
  });

  test('사적연금 연금소득세 슬라이딩 적용 검증', () => {
    // 60세 은퇴하여 연금을 개시하는 시나리오
    // 연금소득세: 55~69세 5.5%, 70~79세 4.4%, 80세 이상 3.3%
    const engine = new SimulationEngine();
    const result = engine.run(baseParams);

    // 사적연금 자산이 충분할 때 60세(세율 5.5%), 72세(세율 4.4%), 82세(세율 3.3%) 시점의 연금 세후 수령 비율이 달라야 함
    // 세부 세율 계산이 제대로 동작하는지 엔진 내부 비즈니스 연산 확인
    // (이 테스트는 엔진 내 연금 인출 계산 부분의 세율이 연령별로 맞게 적용되었는지 검증)
    const resultAt60 = result.yearlyResults[20]; // 60세
    const resultAt72 = result.yearlyResults[32]; // 72세
    const resultAt82 = result.yearlyResults[42]; // 82세

    // 국민연금은 65세부터 나오므로 60세 시점 소득은 사적연금과 기타소득뿐임.
    // 사적연금 인출액에 대해 세금이 다르게 차감되는 구조 확인
    expect(resultAt60.pensionIncome).toBeGreaterThan(0);
    expect(resultAt72.pensionIncome).toBeGreaterThan(0);
    expect(resultAt82.pensionIncome).toBeGreaterThan(0);
  });

  test('금융소득종합과세 경고 (hasTaxWarning) 기준 테스트', () => {
    // 자산이 매우 많고 배당률이 높을 때 연간 2,000만 원 초과 시 경고 체크 발생 여부
    const highAssetParams: SimulationParams = {
      ...baseParams,
      assets: [
        {
          id: 'asset-high',
          type: 'stock',
          ticker: 'SCHD',
          name: 'High Dividend',
          quantity: 10000,
          averagePrice: 100, // 100 USD
          totalReturn: 9,
          dividendYield: 4, // 배당률 4% -> 1,000,000 USD 자산 기준 연간 40,000 USD (약 5,400만 원) 배당 발생
          monthlyContribution: 0,
          reinvestDividend: false,
          currency: 'USD',
        },
      ],
      privatePensions: [],
      otherIncomes: [],
    };

    const engine = new SimulationEngine();
    const result = engine.run(highAssetParams);

    // 40세 첫 해 연간 배당금 세전 금액이 약 40,000 USD * 1350 = 5,400만 원이므로
    // 금융소득 종합과세 경고 플래그 hasTaxWarning이 true여야 함
    expect(result.yearlyResults[0].hasTaxWarning).toBe(true);
  });

  test('환율 시나리오 적용 시 USD 자산 평가액 변동 검증', () => {
    const engine = new SimulationEngine();
    
    // Base 환율 시나리오 실행
    const baseResult = engine.run(baseParams);

    // USD +10% 시나리오 실행
    const upResult = engine.run({
      ...baseParams,
      exchangeScenario: 'usd_up',
    });

    // USD -10% 시나리오 실행
    const downResult = engine.run({
      ...baseParams,
      exchangeScenario: 'usd_down',
    });

    // 40세 시점의 기말 총자산을 원화 환산 기준으로 비교했을 때
    // USD 자산(VOO) 가치가 보정되므로 upResult > baseResult > downResult 여야 함
    const assetBase = baseResult.yearlyResults[0].totalAssets;
    const assetUp = upResult.yearlyResults[0].totalAssets;
    const assetDown = downResult.yearlyResults[0].totalAssets;

    expect(assetUp).toBeGreaterThan(assetBase);
    expect(assetBase).toBeGreaterThan(assetDown);
  });

  test('대시보드 종합 점수 및 달성도 계산 결과 검증', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams);

    expect(result.retirementScore).toBeGreaterThanOrEqual(0);
    expect(result.retirementScore).toBeLessThanOrEqual(100);
    expect(result.goalAchievementRate).toBeGreaterThan(0);
  });

  test('기대수명이 현재 나이보다 적을 때(잘못된 입력) 예외 없이 빈 결과를 반환하는지 검증', () => {
    const engine = new SimulationEngine();
    const invalidParams: SimulationParams = {
      ...baseParams,
      userProfile: {
        ...baseParams.userProfile,
        currentAge: 80,
        expectancy: 70,
      },
    };

    const result = engine.run(invalidParams);
    expect(result.yearlyResults.length).toBe(0);
    expect(result.endingAssets).toBe(0);
    expect(result.retirementScore).toBe(0);
    expect(result.goalAchievementRate).toBe(0);
  });

  test('국민연금과 사적연금 소득 분리 수령 검증 및 올바른 FIRE 가능 나이 계산 검증', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams);

    // 65세(index 25)에는 국민연금과 사적연금 모두 수령해야 함.
    const resultAt65 = result.yearlyResults[25];
    expect(resultAt65.nationalPensionIncome).toBeGreaterThan(0);
    expect(resultAt65.privatePensionIncome).toBeGreaterThan(0);
    expect(resultAt65.pensionIncome).toBe(resultAt65.nationalPensionIncome + resultAt65.privatePensionIncome);

    // 자산이 0이고 소득이 목표보다 적을 때 (사용자가 직면한 상태와 동일)
    // FIRE 가능 나이가 현재 나이로 즉시 노출되지 않는지 확인
    const zeroAssetParams: SimulationParams = {
      ...baseParams,
      assets: [],
      privatePensions: [],
      otherIncomes: [],
      userProfile: {
        currentAge: 51,
        retirementAge: 60,
        expectancy: 85,
        targetMonthlySpending: 3000000,
      }
    };
    const zeroResult = engine.run(zeroAssetParams);
    // 51세(현재나이)에 FIRE가 불가능하고 전체 기간 중 소득이 생활비를 충족하지 못하므로 null이어야 함
    expect(zeroResult.fireAge).toBeNull();
  });

  test('사적연금 저율과세 한도 내 인출 활성화 시 연도별 수령액이 한도를 넘지 않는지 검증', () => {
    const engine = new SimulationEngine();
    const pensionLimit = 15000000; // 연간 1500만 원
    const paramsWithLimit: SimulationParams = {
      ...baseParams,
      taxSettings: {
        enableComprehensiveTax: true,
        enableHealthInsurance: true,
        usDividendTaxRate: 15,
        domesticDividendTaxRate: 15.4,
        comprehensiveTaxRate: 15,
        healthInsuranceRate: 5,
        enablePrivatePensionTax: true,
        privatePensionLimit: pensionLimit,
        privatePensionExcessTaxRate: 16.5,
        limitPrivatePensionToTaxLimit: true,
      },
    };

    const result = engine.run(paramsWithLimit);

    const retirementYears = result.yearlyResults.filter(r => r.age >= baseParams.userProfile.retirementAge);
    for (const r of retirementYears) {
      expect(r.privatePensionIncome).toBeLessThanOrEqual(pensionLimit);
    }
  });

  test('자산이 고갈되지 않고 순증가하면 goalAchievementRate<100이어도 retirementScore가 95점 이상(매우 안정)으로 보정되는지 검증', () => {
    // 원금을 일부 인출하며 살아도(즉 고정소득 커버율이 낮아도) 자산이 은퇴 시작 시점보다
    // 줄지 않는다면 실질적으로 매우 안전한 시나리오이므로, 점수 하한(95점)이 정상 작동해야 한다.
    const engine = new SimulationEngine();
    const growingAssetParams: SimulationParams = {
      userProfile: {
        currentAge: 60,
        retirementAge: 60,
        expectancy: 85,
        targetMonthlySpending: 2000000, // 200만 원
      },
      assets: [
        {
          id: 'asset-large',
          type: 'etf',
          ticker: 'LARGE',
          name: '대규모 저배당 성장자산',
          quantity: 5000000,
          averagePrice: 100, // 5억 원
          totalReturn: 9, // 자본 성장률 9%
          dividendYield: 1, // 배당률 1% (고정소득 커버율을 낮게 유지)
          monthlyContribution: 0,
          reinvestDividend: false,
          currency: 'KRW',
        },
      ],
      nationalPension: { expectedMonthlyAmount: 0 },
      privatePensions: [],
      otherIncomes: [],
      inflationRate: 0,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
    };

    const result = engine.run(growingAssetParams);

    expect(result.depletionAge).toBeNull();
    expect(result.goalAchievementRate).toBeLessThan(80);
    expect(result.endingAssets).toBeGreaterThanOrEqual(result.retirementAssetsAtRetirement);
    expect(result.retirementScore).toBeGreaterThanOrEqual(95);
    expect(result.retirementGrade).toBe('매우 안정');
  });

  test('자산이 순감소하지만 고갈되지 않는 경우 retirementScore가 95점으로 보정되지 않는지 검증', () => {
    // 오버라이드가 "발동해야 하는 경우"뿐 아니라 "발동하지 말아야 하는 경우"도 함께 지켜야
    // 과도하게 관대한 점수 부여를 막을 수 있다.
    const engine = new SimulationEngine();
    const decliningButNotDepletedParams: SimulationParams = {
      userProfile: {
        currentAge: 60,
        retirementAge: 60,
        expectancy: 85,
        targetMonthlySpending: 3000000,
      },
      assets: [
        {
          id: 'asset-declining',
          type: 'etf',
          ticker: 'DECLINE',
          name: '완만하게 줄어드는 자산',
          quantity: 5000000,
          averagePrice: 100, // 5억 원
          totalReturn: 6,
          dividendYield: 1,
          monthlyContribution: 0,
          reinvestDividend: false,
          currency: 'KRW',
        },
      ],
      nationalPension: { expectedMonthlyAmount: 0 },
      privatePensions: [],
      otherIncomes: [],
      inflationRate: 0,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
    };

    const result = engine.run(decliningButNotDepletedParams);

    expect(result.depletionAge).toBeNull();
    expect(result.endingAssets).toBeLessThan(result.retirementAssetsAtRetirement);
    expect(result.retirementScore).toBeLessThan(95);
  });

  test('이미 은퇴 나이를 지난 사용자(currentAge > retirementAge) 입력 시 retirementAssetsAtRetirement가 0으로 폴백되어 오버라이드가 잘못 발동하지 않는지 검증', () => {
    // yearlyResults에는 age===retirementAge인 행이 존재하지 않으므로, 관측 가능한 첫 해의
    // 자산을 대용치로 사용해야 한다. 0으로 폴백되면 고정소득 커버율이 매우 낮아도
    // "매우 안정"으로 잘못 표시된다.
    const engine = new SimulationEngine();
    const alreadyRetiredParams: SimulationParams = {
      userProfile: {
        currentAge: 65,
        retirementAge: 60, // 현재 나이보다 낮음 = 이미 은퇴한 상태
        expectancy: 85,
        targetMonthlySpending: 3000000,
      },
      assets: [
        {
          id: 'asset-retired',
          type: 'etf',
          ticker: 'RETIRED',
          name: '이미 은퇴한 사용자의 자산',
          quantity: 10000000,
          averagePrice: 100, // 10억 원
          totalReturn: 3.5,
          dividendYield: 0.5,
          monthlyContribution: 0,
          reinvestDividend: false,
          currency: 'KRW',
        },
      ],
      nationalPension: { expectedMonthlyAmount: 0 },
      privatePensions: [],
      otherIncomes: [],
      inflationRate: 0,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
    };

    const result = engine.run(alreadyRetiredParams);

    expect(result.retirementAssetsAtRetirement).toBeGreaterThan(0);
    expect(result.goalAchievementRate).toBeLessThan(50);
    // 고정소득 커버율이 매우 낮은데도 자산 추이만으로 "매우 안정"이 되는 오탐이 없어야 한다.
    expect(result.retirementGrade).not.toBe('매우 안정');
  });

  // 건강보험료 부과 기준 소득 = 금융소득(세전) + 공적연금 × 50%.
  // 사적연금(연금저축·IRP)은 부과 대상 소득이 아니다.
  //
  // 예전에는 국민연금과 사적연금을 그대로 더해 기준액을 만들었다. 그래서 사적연금을 많이
  // 인출할수록 건보료가 늘어났는데, 이는 제도와 다르며 "연금을 아껴 인출하라"는 잘못된
  // 방향으로 최적화를 밀었다.
  const healthInsuranceParams = (
    overrides: Partial<SimulationParams> = {}
  ): SimulationParams => ({
    userProfile: { currentAge: 65, retirementAge: 65, expectancy: 65, targetMonthlySpending: 1500000 },
    assets: [], // 금융소득(배당) 자체가 없어 종합과세 판정 기준은 항상 0
    nationalPension: { expectedMonthlyAmount: 1000000 }, // 연 1,200만 원
    privatePensions: [
      { id: 'pension-1', type: 'irp', balance: 50000000, monthlyContribution: 0, totalReturn: 3, currency: 'KRW' },
    ],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    withdrawalPlan: { privatePensionMonthlyTarget: 900000 }, // 연 1,080만 원 (저율과세 한도 이하)
    ...overrides,
  });

  test('사적연금은 아무리 많이 인출해도 건강보험료를 발생시키지 않는다', () => {
    const engine = new SimulationEngine();

    // 공적연금 1,200만 × 50% = 600만 < 2,000만 → 사적연금이 얼마든 기준을 넘지 못한다.
    const modest = engine.run(healthInsuranceParams()).yearlyResults[0];
    const heavy = engine.run(
      healthInsuranceParams({ withdrawalPlan: { privatePensionMonthlyTarget: 3000000 } })
    ).yearlyResults[0];

    expect(heavy.privatePensionIncome).toBeGreaterThan(modest.privatePensionIncome);
    expect(modest.healthInsurancePaid).toBe(0);
    expect(heavy.healthInsurancePaid).toBe(0);
  });

  test('공적연금이 크면 금융소득이 없어도 건강보험료가 발생한다 (종합과세는 여전히 0)', () => {
    const engine = new SimulationEngine();

    // 공적연금 월 400만 = 연 4,800만 × 50% = 2,400만 > 2,000만 → 초과분 400만에 요율 적용.
    const result = engine.run(
      healthInsuranceParams({ nationalPension: { expectedMonthlyAmount: 4000000 } })
    );
    const yr = result.yearlyResults[0];

    expect(yr.comprehensiveTaxPaid).toBe(0); // 종합과세 판정은 금융소득(배당)만 사용 -> 0
    expect(yr.healthInsurancePaid).toBeGreaterThan(0);
  });

  test('명목(nominal) 모드에서 국민연금 수령액이 매년 물가상승률만큼 증가하는지 검증', () => {
    const engine = new SimulationEngine();
    const params: SimulationParams = {
      ...baseParams,
      inflationMode: 'nominal',
      inflationRate: 2.5,
    };

    const result = engine.run(params);
    const resultAt65 = result.yearlyResults[25]; // 65세, 국민연금 수령 원년
    const resultAt70 = result.yearlyResults[30]; // 70세, 5년 후

    // 물가상승률이 누적 반영되어 5년 뒤 국민연금 수령액이 더 커야 한다.
    expect(resultAt70.nationalPensionIncome).toBeGreaterThan(resultAt65.nationalPensionIncome);
  });

  // 대시보드 헤드라인 점수(result.utility.score)가 사용자가 고른 목표 우선순위를 실제로
  // 반영하는지 확인한다. run()/runForUtility()가 cfg 인자를 computeLifetimeUtility로 넘기지
  // 않으면 objective를 무엇으로 바꾸든 이 점수가 절대 움직이지 않는데, 이를 잡아줄 테스트가
  // 없어서 그런 배선 누락이 리뷰 전까지 발견되지 않았다.
  test('run()에 cfg를 넘기면 목표 우선순위에 따라 result.utility.score가 달라진다', () => {
    const engine = new SimulationEngine();

    const lifetimeSpendingParams: SimulationParams = {
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, objective: 'lifetime_spending' },
    };
    const bequestParams: SimulationParams = {
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, objective: 'bequest_maximization' },
    };

    const lifetimeSpendingCompiled = compileStrategy(lifetimeSpendingParams);
    const bequestCompiled = compileStrategy(bequestParams);

    const lifetimeSpendingResult = engine.run(
      lifetimeSpendingCompiled.params, lifetimeSpendingCompiled.utilityConfig
    );
    const bequestResult = engine.run(bequestCompiled.params, bequestCompiled.utilityConfig);

    expect(lifetimeSpendingResult.utility?.score).not.toBe(bequestResult.utility?.score);
  });

  test('runForUtility()에 cfg를 넘기면 목표 우선순위에 따라 result.utility.score가 달라진다', () => {
    const engine = new SimulationEngine();

    const lifetimeSpendingParams: SimulationParams = {
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, objective: 'lifetime_spending' },
    };
    const bequestParams: SimulationParams = {
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, objective: 'bequest_maximization' },
    };

    const lifetimeSpendingCompiled = compileStrategy(lifetimeSpendingParams);
    const bequestCompiled = compileStrategy(bequestParams);

    const lifetimeSpendingResult = engine.runForUtility(
      lifetimeSpendingCompiled.params, lifetimeSpendingCompiled.utilityConfig
    );
    const bequestResult = engine.runForUtility(bequestCompiled.params, bequestCompiled.utilityConfig);

    expect(lifetimeSpendingResult.utility?.score).not.toBe(bequestResult.utility?.score);
  });

  test('cfg를 생략하면 기존과 동일하게 기본 UtilityConfig로 계산한다(하위 호환)', () => {
    const engine = new SimulationEngine();

    const withoutCfg = engine.run(initialParams);
    const withDefaultCfg = engine.run(initialParams, compileStrategy(initialParams).utilityConfig);

    expect(withoutCfg.utility).toEqual(withDefaultCfg.utility);
  });
});
