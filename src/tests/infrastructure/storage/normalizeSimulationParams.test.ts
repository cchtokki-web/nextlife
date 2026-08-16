import { describe, test, expect } from 'vitest';
import { normalizeSimulationParams } from '@/infrastructure/storage/normalizeSimulationParams';
import { initialParams } from '@/infrastructure/storage/localStore';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';

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
