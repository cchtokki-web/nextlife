import { describe, test, expect } from 'vitest';
import { normalizeSimulationParams } from '@/infrastructure/storage/normalizeSimulationParams';
import { initialParams } from '@/infrastructure/storage/localStore';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { DEFAULT_TAX_SETTINGS, resolveTaxSettings } from '@/core/usecases/tax/taxRates';
import { DEFAULT_HEALTHCARE } from '@/core/usecases/healthcare/defaultHealthcare';
import { resolveStrategy } from '@/core/usecases/strategy/compileStrategy';

// 저장 데이터는 손상되거나 낡은 채로 돌아온다. localStorage는 사용자가 직접 고칠 수 있고,
// E2EE 시나리오는 복호화된 JSON이 그대로 올라오며, 예전 버전이 쓴 필드는 지금 타입과 다르다.
// 그런데 로드 경계는 `as SimulationParams` 캐스팅뿐이라, 그 값이 검사 없이 엔진까지 갔다.
//
// **시나리오를 통째로 버리지 않는 것이 이 함수의 첫 번째 원칙이다.** 필드 하나가 깨졌다고
// initialParams로 되돌리면 사용자의 저장 계획이 조용히 사라진다. 필드 단위로 기본값을 채우고,
// 배열은 원소 단위로만 정제한다.

describe('normalizeSimulationParams', () => {
  test('정상 데이터는 값을 바꾸지 않는다', () => {
    expect(normalizeSimulationParams(structuredClone(initialParams))).toEqual(initialParams);
  });

  test('객체가 아니면 기본값을 돌려준다', () => {
    for (const raw of [null, undefined, 3, 'params', [1, 2]]) {
      expect(normalizeSimulationParams(raw)).toEqual(initialParams);
    }
  });

  // 알 수 없는 키를 남기는 것은 의도된 계약이다(localStore.test.ts의 레거시 키 테스트).
  // 지우면 아직 타입에 반영되지 않은 새 필드나 남의 버전이 쓴 값을 우리가 파괴하게 된다.
  test('타입에 없는 키는 건드리지 않고 그대로 둔다', () => {
    const result = normalizeSimulationParams({ ...structuredClone(initialParams), unknownKey: { a: 1 } });

    expect((result as unknown as Record<string, unknown>).unknownKey).toEqual({ a: 1 });
  });

  describe('숫자 필드', () => {
    test('숫자가 아닌 값은 기본값으로 되돌린다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        userProfile: {
          currentAge: '50',
          retirementAge: null,
          expectancy: undefined,
          targetMonthlySpending: { amount: 100 },
        },
        inflationRate: 'NaN',
        baseExchangeRate: [],
      });

      expect(result.userProfile).toEqual(initialParams.userProfile);
      expect(result.inflationRate).toBe(initialParams.inflationRate);
      expect(result.baseExchangeRate).toBe(initialParams.baseExchangeRate);
    });

    // JSON.stringify가 NaN/Infinity를 null로 바꾸므로 저장 왕복으로는 생기지 않지만,
    // 서버 payload와 수동 편집은 이 경로를 지난다. 엔진에 들어가면 모든 후속 계산이 NaN이 된다.
    test('NaN과 Infinity는 유한한 기본값으로 바꾼다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        inflationRate: Number.NaN,
        baseExchangeRate: Number.POSITIVE_INFINITY,
      });

      expect(result.inflationRate).toBe(initialParams.inflationRate);
      expect(result.baseExchangeRate).toBe(initialParams.baseExchangeRate);
    });

    test('0과 음수는 정상 입력이므로 그대로 둔다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        inflationRate: -1,
        cashYieldRate: 0,
      });

      expect(result.inflationRate).toBe(-1);
      expect(result.cashYieldRate).toBe(0);
    });
  });

  describe('유니온 리터럴', () => {
    test('허용되지 않은 값은 기본값으로 되돌린다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        inflationMode: 'REAL',
        exchangeScenario: 'usd_moon',
        displayCurrency: 'JPY',
        yieldPreset: 'insane',
      });

      expect(result.inflationMode).toBe(initialParams.inflationMode);
      expect(result.exchangeScenario).toBe(initialParams.exchangeScenario);
      expect(result.displayCurrency).toBe(initialParams.displayCurrency);
      expect(result.yieldPreset).toBe(initialParams.yieldPreset);
    });
  });

  describe('배열', () => {
    test('배열이 아니면 빈 배열로 바꾼다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        assets: { '0': { id: 'a' } },
        privatePensions: 'none',
        otherIncomes: null,
      });

      expect(result.assets).toEqual([]);
      expect(result.privatePensions).toEqual([]);
      expect(result.otherIncomes).toEqual([]);
    });

    test('객체가 아닌 원소만 걸러내고 나머지는 살린다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        assets: [null, initialParams.assets[0], 'broken', initialParams.assets[1]],
      });

      expect(result.assets).toEqual(initialParams.assets);
    });

    // 금액을 지어내지 않는다. 깨진 숫자는 0으로 두어 없는 것과 같게 만들고, 원소 자체는
    // 남긴다 — 사용자가 화면에서 그 자산을 보고 직접 고칠 수 있어야 한다.
    test('원소의 깨진 숫자는 0으로 두고 원소는 남긴다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        assets: [{ ...initialParams.assets[0], quantity: '2000', annualGrowthRate: null }],
      });

      expect(result.assets).toHaveLength(1);
      expect(result.assets[0].quantity).toBe(0);
      expect(result.assets[0].annualGrowthRate).toBe(0);
      expect(result.assets[0].name).toBe('KODEX 200');
    });

    test('원소의 잘못된 유니온 값은 안전한 기본값으로 바꾼다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        assets: [{ ...initialParams.assets[0], type: 'crypto', currency: 'BTC' }],
        privatePensions: [{ ...initialParams.privatePensions[0], type: 'unknown' }],
        isaAccounts: [{ id: 'isa-1', type: 'vip', balance: 1000, monthlyContribution: 0, annualReturn: 4, dividendYield: 0, currency: 'KRW', maturityYears: 3 }],
      });

      expect(result.assets[0].type).toBe('etf');
      expect(result.assets[0].currency).toBe('KRW');
      expect(result.privatePensions[0].type).toBe('savings');
      expect(result.isaAccounts?.[0].type).toBe('general');
    });

    test('id가 없는 원소에는 자리 기반 id를 채운다', () => {
      const { id: _dropped, ...withoutId } = initialParams.assets[0];
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        assets: [withoutId],
      });

      expect(result.assets[0].id).toBeTypeOf('string');
      expect(result.assets[0].id.length).toBeGreaterThan(0);
    });

    test('목표는 알 수 없는 종류만 걸러낸다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        retirementGoals: [
          { type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'SOFT' },
          { type: 'WORLD_DOMINATION', priority: 2, constraintType: 'SOFT' },
          { type: 'INHERITANCE', priority: 'first', constraintType: 'MAYBE' },
        ],
      });

      expect(result.retirementGoals?.map((goal) => goal.type))
        .toEqual(['ASSET_SURVIVAL', 'INHERITANCE']);
      // priority가 깨졌으면 순서를 지어내지 않고 뒤로 보낸다.
      expect(result.retirementGoals?.[1].constraintType).toBe('SOFT');
    });
  });

  describe('필수 하위 객체', () => {
    test('빠져 있으면 기본값으로 채운다', () => {
      const result = normalizeSimulationParams({ userProfile: initialParams.userProfile, assets: [] });

      expect(result.nationalPension).toEqual(initialParams.nationalPension);
      expect(result.privatePensions).toEqual([]);
      expect(result.inflationMode).toBe(initialParams.inflationMode);
    });
  });

  // 중첩 구조는 전부 optional이라 「빠져 있음」이 정상 상태다. 그래서 깨진 값은 값을
  // 지어내는 대신 그 키를 지우는 것이 맞다 — 각 소비처가 이미 미지정 기본값을 갖고 있다.
  describe('taxSettings', () => {
    test('깨진 항목만 지우고 나머지 설정은 지킨다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        taxSettings: {
          enableComprehensiveTax: 'yes',
          enableHealthInsurance: false,
          usDividendTaxRate: '15',
          domesticDividendTaxRate: 22,
          comprehensiveTaxMode: 'guess',
        },
      });

      expect(result.taxSettings).toEqual({
        enableHealthInsurance: false,
        domesticDividendTaxRate: 22,
      });
    });

    test('resolveTaxSettings가 지워진 항목을 기본값으로 메운다', () => {
      const params = normalizeSimulationParams({
        ...structuredClone(initialParams),
        taxSettings: { usDividendTaxRate: Number.NaN, domesticDividendTaxRate: 22 },
      });
      const resolved = resolveTaxSettings(params.taxSettings);

      expect(resolved.usDividendTaxRate).toBe(DEFAULT_TAX_SETTINGS.usDividendTaxRate);
      expect(resolved.domesticDividendTaxRate).toBe(22);
    });

    test('객체가 아니면 키 자체를 지운다', () => {
      const result = normalizeSimulationParams({ ...structuredClone(initialParams), taxSettings: 'off' });

      expect(result.taxSettings).toBeUndefined();
    });
  });

  describe('withdrawalPlan', () => {
    test('깨진 항목만 지운다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        withdrawalPlan: {
          accountWithdrawalPolicy: 'RANDOM_FIRST',
          assetSellOrderStrategy: 'high_dividend_first',
          nationalPensionStartAge: '65',
          monthlySpendingMultiplier: 1.2,
        },
      });

      expect(result.withdrawalPlan).toEqual({
        assetSellOrderStrategy: 'high_dividend_first',
        monthlySpendingMultiplier: 1.2,
      });
    });

    test('사용자 지정 인출 순서는 알 수 없는 항목만 걸러낸다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        withdrawalPlan: {
          accountWithdrawalPolicy: 'CUSTOM',
          customWithdrawalOrder: ['ISA', 42, 'GENERAL', null],
        },
      });

      expect(result.withdrawalPlan?.customWithdrawalOrder).toEqual(['ISA', 'GENERAL']);
    });
  });

  describe('spendingCurve', () => {
    // 배수 길이 = 구간 길이 + 1이 무너지면 뒤쪽 나이의 배수가 undefined가 되어 그 해
    // 목표 생활비가 NaN이 된다. 길이 계약은 타입 주석이 명시한 것이지만 강제는 없었다.
    test('배수 길이가 맞지 않으면 곡선을 통째로 지운다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        spendingCurve: { breakpointAges: [70, 80], multipliers: [1.2, 1] },
      });

      expect(result.spendingCurve).toBeUndefined();
    });

    test('숫자가 아닌 값이 섞여 있으면 지운다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        spendingCurve: { breakpointAges: [70, '80'], multipliers: [1.2, 1, 0.8] },
      });

      expect(result.spendingCurve).toBeUndefined();
    });

    test('올바른 곡선은 그대로 둔다', () => {
      const curve = { breakpointAges: [70, 80], multipliers: [1.2, 1, 0.8] };
      const result = normalizeSimulationParams({ ...structuredClone(initialParams), spendingCurve: curve });

      expect(result.spendingCurve).toEqual(curve);
    });
  });

  describe('customYieldSnapshot', () => {
    test('숫자가 아닌 항목만 걸러낸다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        customYieldSnapshot: {
          assets: { 'asset-1': 7, 'asset-2': '9' },
          privatePensions: { 'pension-1': 4 },
          isaAccounts: 'none',
        },
      });

      expect(result.customYieldSnapshot).toEqual({
        assets: { 'asset-1': 7 },
        privatePensions: { 'pension-1': 4 },
        isaAccounts: {},
      });
    });
  });

  describe('healthcare', () => {
    // enabled는 `!healthcare.enabled`로만 검사돼, 문자열 'false'가 의료비를 켰다.
    // costGrowthRate가 NaN이면 그 해 의료비가 NaN이 되고 자산 전체가 NaN으로 번진다.
    test('깨진 항목을 기본값으로 되돌린다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        healthcare: {
          enabled: 'false',
          costGrowthRate: Number.NaN,
          baseMonthlyCost: 400000,
          longTermCareEnabled: true,
          longTermCareStartAge: 80,
          longTermCareMonthlyCost: 1500000,
          shockEnabled: false,
          shockAge: 75,
          shockAmount: 30000000,
        },
      });

      expect(result.healthcare?.enabled).toBe(DEFAULT_HEALTHCARE.enabled);
      expect(result.healthcare?.costGrowthRate).toBe(DEFAULT_HEALTHCARE.costGrowthRate);
      // 멀쩡한 사용자 입력은 지킨다.
      expect(result.healthcare?.baseMonthlyCost).toBe(400000);
      expect(result.healthcare?.longTermCareEnabled).toBe(true);
    });

    test('객체가 아니면 키 자체를 지운다', () => {
      const result = normalizeSimulationParams({ ...structuredClone(initialParams), healthcare: true });

      expect(result.healthcare).toBeUndefined();
    });
  });

  describe('strategy', () => {
    test('깨진 항목만 지우고 나머지 선택은 지킨다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        strategy: {
          mode: 'wizard',
          objective: 'tax_minimization',
          riskProfile: 42,
          bequestSafetyMarginRate: Number.NaN,
          minMonthlySpending: 2000000,
        },
      });

      expect(result.strategy).toEqual({
        objective: 'tax_minimization',
        minMonthlySpending: 2000000,
      });
    });

    // preferIsaFirst는 boolean이던 시절의 값이 실제로 저장돼 있고, resolveStrategy의
    // normalizeIsaFirstChoice가 그것을 3값 enum으로 옮긴다. E2EE라 서버 마이그레이션이
    // 불가능해 읽는 시점의 변환이 유일한 경로다 — 여기서 버리면 그 경로가 끊긴다.
    test('boolean으로 저장된 옛 preferIsaFirst를 버리지 않는다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        strategy: { preferIsaFirst: false },
      });

      expect(result.strategy?.preferIsaFirst).toBe(false);
      expect(resolveStrategy(result).preferIsaFirst).toBe('pension_first');
    });

    // `strategy`의 «있음»과 «없음»은 서로 다른 상태다. 없으면 "전략을 저장한 적 없음"이고,
    // strategyFieldMap과 verifiedSentinelPlan이 그것을 판정에 쓴다. 내용이 전부 깨졌다고
    // 키를 지우면 저장한 적 있는 시나리오가 저장한 적 없는 것으로 바뀐다.
    test('내용이 전부 깨져도 저장했다는 사실 자체는 지운다고 없애지 않는다', () => {
      const result = normalizeSimulationParams({
        ...structuredClone(initialParams),
        strategy: { mode: 'wizard', riskProfile: null },
      });

      expect(result.strategy).toEqual({});
    });

    test('전략을 저장한 적 없으면 키를 만들지 않는다', () => {
      const result = normalizeSimulationParams(structuredClone(initialParams));

      expect(result.strategy).toBeUndefined();
      expect('strategy' in result).toBe(false);
    });
  });

  test('taxLawVersion은 알려진 값만 남긴다', () => {
    expect(normalizeSimulationParams({ ...structuredClone(initialParams), taxLawVersion: 'current' })
      .taxLawVersion).toBe('current');
    expect(normalizeSimulationParams({ ...structuredClone(initialParams), taxLawVersion: '2019' })
      .taxLawVersion).toBeUndefined();
  });

  // 정제의 목적은 형식이 아니라 「엔진이 NaN을 먹지 않는 것」이다.
  test('깨진 저장 데이터로도 시뮬레이션이 유한한 숫자를 낸다', () => {
    const params = normalizeSimulationParams({
      ...structuredClone(initialParams),
      userProfile: { currentAge: '50', retirementAge: 60, expectancy: 85, targetMonthlySpending: null },
      inflationRate: Number.NaN,
      assets: [{ ...initialParams.assets[0], quantity: 'many' }],
    });

    const result = new SimulationEngine().run(params);

    expect(result.yearlyResults.length).toBeGreaterThan(0);
    for (const year of result.yearlyResults) {
      expect(Number.isFinite(year.totalAssets)).toBe(true);
      expect(Number.isFinite(year.totalIncome)).toBe(true);
    }
  });
});
