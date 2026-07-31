import { describe, test, expect } from 'vitest';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { DEFAULT_PRIVATE_PENSION_LIMIT_KRW } from '@/core/usecases/tax/taxRates';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '@/core/usecases/pension/nationalPensionRules';
import { RetirementStrategy, SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 1,
      annualGrowthRate: 7, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: false, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const withStrategy = (patch: Partial<RetirementStrategy>): SimulationParams => ({
  ...baseParams,
  strategy: { ...DEFAULT_RETIREMENT_STRATEGY, ...patch },
});

describe('compileStrategy 연금 축', () => {
  test('국민연금 "예상 수령"은 정상 개시 나이로 컴파일된다', () => {
    const r = compileStrategy(withStrategy({ nationalPensionStrategy: 'normal' }));

    expect(r.params.withdrawalPlan?.nationalPensionStartAge).toBe(NATIONAL_PENSION_NORMAL_START_AGE);
  });

  test('국민연금 "조기 수령"은 60세다', () => {
    const r = compileStrategy(withStrategy({ nationalPensionStrategy: 'early' }));

    expect(r.params.withdrawalPlan?.nationalPensionStartAge).toBe(60);
  });

  test('국민연금 "1년 연기"는 66세다', () => {
    const r = compileStrategy(withStrategy({ nationalPensionStrategy: 'defer_1y' }));

    expect(r.params.withdrawalPlan?.nationalPensionStartAge).toBe(66);
  });

  test('국민연금 "2년 연기"는 67세다', () => {
    const r = compileStrategy(withStrategy({ nationalPensionStrategy: 'defer_2y' }));

    expect(r.params.withdrawalPlan?.nationalPensionStartAge).toBe(67);
  });

  test('국민연금 "최대 연기"는 70세다', () => {
    const r = compileStrategy(withStrategy({ nationalPensionStrategy: 'defer_max' }));

    expect(r.params.withdrawalPlan?.nationalPensionStartAge).toBe(70);
  });

  test('국민연금 "AI 최적화"는 baseline(정상 개시)으로 내려간다', () => {
    const r = compileStrategy(withStrategy({ nationalPensionStrategy: 'ai_optimized' }));

    expect(r.params.withdrawalPlan?.nationalPensionStartAge).toBe(NATIONAL_PENSION_NORMAL_START_AGE);
  });

  test('알 수 없는 국민연금 전략 값이 들어와도 baseline(정상 개시)으로 폴백한다', () => {
    // 저장된 옛 시나리오에 없어진 enum 값이 남아 있어도 화면이 죽으면 안 된다.
    const params = withStrategy({});
    (params.strategy as RetirementStrategy).nationalPensionStrategy = 'nonexistent' as never;

    expect(() => compileStrategy(params)).not.toThrow();
    expect(compileStrategy(params).params.withdrawalPlan?.nationalPensionStartAge)
      .toBe(NATIONAL_PENSION_NORMAL_START_AGE);
  });

  test('사적연금 "절세 우선"은 한도 내 인출을 켜고 월 목표를 한도/12로 잡는다', () => {
    const r = compileStrategy(withStrategy({ privatePensionStrategy: 'tax_first' }));

    expect(r.params.taxSettings?.limitPrivatePensionToTaxLimit).toBe(true);
    expect(r.params.withdrawalPlan?.privatePensionMonthlyTarget)
      .toBe(DEFAULT_PRIVATE_PENSION_LIMIT_KRW / 12);
  });

  test('사적연금 "생활비 우선"은 한도 제한을 끄고 월 목표를 미지정으로 둔다', () => {
    const r = compileStrategy(withStrategy({ privatePensionStrategy: 'spending_first' }));

    expect(r.params.taxSettings?.limitPrivatePensionToTaxLimit).toBe(false);
    expect(r.params.withdrawalPlan?.privatePensionMonthlyTarget).toBeUndefined();
  });

  test('사적연금 "자산 성장 우선"은 한도의 절반만 인출한다', () => {
    const r = compileStrategy(withStrategy({ privatePensionStrategy: 'growth_first' }));

    expect(r.params.withdrawalPlan?.privatePensionMonthlyTarget)
      .toBe(DEFAULT_PRIVATE_PENSION_LIMIT_KRW / 12 * 0.5);
  });

  test('사적연금 "최소 인출"은 한도의 25%만 인출한다', () => {
    const r = compileStrategy(withStrategy({ privatePensionStrategy: 'minimum' }));

    expect(r.params.withdrawalPlan?.privatePensionMonthlyTarget)
      .toBe(DEFAULT_PRIVATE_PENSION_LIMIT_KRW / 12 * 0.25);
  });

  test('사적연금 "AI 최적화"는 고급 설정에서 켠 한도 내 인출을 덮어쓰지 않는다', () => {
    // 'ai_*'는 "미정"이지 "끄기"가 아니다. 저장해 둔 설정이 조용히 뒤집히면 안 된다.
    const params = withStrategy({ privatePensionStrategy: 'ai_optimized' });
    params.taxSettings = { ...params.taxSettings, limitPrivatePensionToTaxLimit: true } as never;

    const r = compileStrategy(params);

    expect(r.params.taxSettings?.limitPrivatePensionToTaxLimit).toBe(true);
  });

  test('사적연금 "AI 최적화"는 고급 설정에서 끈 한도 내 인출도 덮어쓰지 않는다', () => {
    // true 쪽만 테스트하면 "무조건 true로 강제"하는 버그와 구분되지 않는다.
    const params = withStrategy({ privatePensionStrategy: 'ai_optimized' });
    params.taxSettings = { ...params.taxSettings, limitPrivatePensionToTaxLimit: false } as never;

    const r = compileStrategy(params);

    expect(r.params.taxSettings?.limitPrivatePensionToTaxLimit).toBe(false);
  });

  test('알 수 없는 사적연금 전략 값이 들어와도 baseline(AI 최적화와 동일)으로 폴백한다', () => {
    // 저장된 옛 시나리오에 없어진 enum 값이 남아 있어도 화면이 죽으면 안 된다.
    const params = withStrategy({});
    (params.strategy as RetirementStrategy).privatePensionStrategy = 'nonexistent' as never;
    params.taxSettings = { ...params.taxSettings, limitPrivatePensionToTaxLimit: true } as never;

    expect(() => compileStrategy(params)).not.toThrow();
    const r = compileStrategy(params);
    // ai_optimized와 동일하게 월 목표는 미지정, 한도 내 인출은 사용자가 켠 값을 유지한다.
    expect(r.params.withdrawalPlan?.privatePensionMonthlyTarget).toBeUndefined();
    expect(r.params.taxSettings?.limitPrivatePensionToTaxLimit).toBe(true);
  });

  test('명시적 전략은 고급 설정의 한도 내 인출 값을 덮어쓴다', () => {
    const params = withStrategy({ privatePensionStrategy: 'spending_first' });
    params.taxSettings = { ...params.taxSettings, limitPrivatePensionToTaxLimit: true } as never;

    const r = compileStrategy(params);

    expect(r.params.taxSettings?.limitPrivatePensionToTaxLimit).toBe(false);
  });

  test('사용자가 지정한 privatePensionLimit이 있으면 그 값을 기준으로 계산한다', () => {
    const params = withStrategy({ privatePensionStrategy: 'tax_first' });
    params.taxSettings = { ...params.taxSettings, privatePensionLimit: 12000000 } as never;

    const r = compileStrategy(params);

    expect(r.params.withdrawalPlan?.privatePensionMonthlyTarget).toBe(1000000);
  });

  test('ISA 우선 사용을 켜면 만기 자금이 일반 자산으로 간다', () => {
    const r = compileStrategy(withStrategy({ preferIsaFirst: true }));

    expect(r.params.withdrawalPlan?.isaMaturityDestination).toBe('asset');
  });

  test('ISA 우선 사용이 꺼져 있으면 만기 자금이 연금으로 간다 (기존 동작)', () => {
    const r = compileStrategy(withStrategy({ preferIsaFirst: false }));

    expect(r.params.withdrawalPlan?.isaMaturityDestination).toBe('pension');
  });

  test('compileStrategy는 자산별 reinvestDividend를 건드리지 않는다', () => {
    // 배당 재투자 스위치는 "일괄 적용 버튼"이라 눌린 순간에만 assets를 갱신한다.
    // 컴파일 때마다 덮어쓰면 AssetFormSection의 자산별 토글이 뭉개진다.
    const params = withStrategy({});
    params.assets = [
      { ...params.assets[0], id: 'a1', reinvestDividend: true },
      { ...params.assets[0], id: 'a2', reinvestDividend: false },
    ];

    const r = compileStrategy(params);

    expect(r.params.assets.map((a) => a.reinvestDividend)).toEqual([true, false]);
  });

  test('사용자가 이미 넣어둔 withdrawalPlan 필드는 덮어쓰지 않는다', () => {
    const params = withStrategy({ nationalPensionStrategy: 'defer_max' });
    params.withdrawalPlan = { generalAssetWithdrawalStartAge: 62 };

    const r = compileStrategy(params);

    expect(r.params.withdrawalPlan?.generalAssetWithdrawalStartAge).toBe(62);
    expect(r.params.withdrawalPlan?.nationalPensionStartAge).toBe(70);
  });
});
