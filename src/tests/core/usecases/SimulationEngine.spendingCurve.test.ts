import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';
import { resolveSpendingCurve } from '@/core/usecases/spending/spendingCurve';
import { computeLifetimeUtility } from '@/core/usecases/utility/UtilityEngine';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { computeMonthlySpendingComposition } from '@/core/usecases/MonthlySpendingComposition';

// 연령대별 생활비 곡선은 네 곳이 **같은 함수**를 써야 성립한다: 엔진의 목표 산출,
// meetsSustainabilityGoal의 충당 검증, UtilityEngine의 채점 분모, MonthlySpendingComposition의
// 차트 목표선. 이 파일은 그 네 곳이 실제로 같은 곡선을 보는지 고정한다.

const engine = new SimulationEngine();

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
    assets: [
      {
        id: 'a1', type: 'etf', ticker: 'A', name: '자산', quantity: 10000, averagePrice: 100000,
        annualGrowthRate: 3, dividendYield: 1, monthlyContribution: 0,
        reinvestDividend: false, currency: 'KRW',
      },
    ],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [],
    // 물가 0 / 실질 모드: 곡선 배수 외에 목표를 흔드는 요인을 없앤다.
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

const FRONT_LOADED = resolveSpendingCurve('front_loaded')!; // 경계 [70,80], 배수 [1,0.86,0.76]

const spendingAt = (result: { yearlyResults: { age: number; spending: number }[] }, age: number) =>
  result.yearlyResults.find((y) => y.age === age)!.spending;

describe('SimulationEngine - 연령대별 생활비 곡선', () => {
  test('곡선을 지정하지 않으면 결과가 비트 단위로 같다', () => {
    // 'flat'이 undefined로 해소되는지까지 함께 검증한다 — 배수 1.0이 곱해지는 경로조차
    // 타지 않아야 저장된 시나리오의 숫자가 보존된다.
    const withoutCurve = engine.run(params());
    const withFlat = engine.run(params({ spendingCurve: resolveSpendingCurve('flat') }));

    expect(withFlat.yearlyResults).toEqual(withoutCurve.yearlyResults);
    expect(withFlat.endingAssets).toBe(withoutCurve.endingAssets);
    expect(withFlat.utility?.score).toBe(withoutCurve.utility?.score);
  });

  test('활동기 집중형은 구간별 지출이 배수비만큼 갈린다', () => {
    const result = engine.run(params({ spendingCurve: FRONT_LOADED }));

    // 자산이 충분해 목표를 전 구간 충족하는 시나리오여야 배수비가 그대로 드러난다.
    expect(result.depletionAge).toBeNull();

    const at65 = spendingAt(result, 65); // 배수 1
    const at75 = spendingAt(result, 75); // 배수 0.86
    const at85 = spendingAt(result, 85); // 배수 0.76

    expect(at75 / at65).toBeCloseTo(0.86, 5);
    expect(at85 / at65).toBeCloseTo(0.76, 5);
  });

  test('경계 나이는 다음 구간의 첫 해다', () => {
    const result = engine.run(params({ spendingCurve: FRONT_LOADED }));

    expect(spendingAt(result, 70) / spendingAt(result, 69)).toBeCloseTo(0.86, 5);
    expect(spendingAt(result, 80) / spendingAt(result, 79)).toBeCloseTo(0.76 / 0.86, 5);
  });

  test('곡선은 은퇴 후에만 적용된다', () => {
    // 은퇴 전에는 목표 생활비 자체가 지출로 잡히지 않으므로 곡선이 개입할 여지가 없다.
    const beforeRetirement = params({
      userProfile: { currentAge: 60, retirementAge: 70, expectancy: 90, targetMonthlySpending: 3_000_000 },
      spendingCurve: FRONT_LOADED,
    });
    const result = engine.run(beforeRetirement);

    expect(spendingAt(result, 65)).toBe(0);
  });
});

describe('max_sustainable 역산과 곡선의 공존', () => {
  // **이 테스트가 이 기능의 핵심 회귀 가드다.**
  //
  // meetsSustainabilityGoal은 목표 생활비를 직접 재구성해 충당 여부를 검증한다. 거기에
  // 곡선을 곱하지 않으면 배수가 1 미만인 구간(활동기 집중형의 80세 이후)에서 실제 지출이
  // 재구성된 목표에 언제나 못 미쳐 모든 시행이 실패하고, 이진탐색이 0으로 붕괴한다.
  // 실측(곡선을 뺀 채 실행): 기준액 438만원 → **0.37원**.
  //
  // `> 0`으로 단언하면 안 된다 — 붕괴한 값 0.37도 그 조건을 통과한다. 균등형 대비
  // 합리적인 범위에 있는지를 봐야 실제로 무너진 것을 잡는다.
  test('곡선이 있어도 이진탐색이 0으로 붕괴하지 않는다', () => {
    const flat = engine.run(params({ spendingStrategy: 'max_sustainable' }));
    const curved = engine.run(params({
      spendingStrategy: 'max_sustainable',
      spendingCurve: FRONT_LOADED,
    }));

    // 곡선은 배분을 바꿀 뿐이므로 기준액이 균등형과 같은 자릿수여야 한다.
    expect(curved.calculatedTargetSpending!).toBeGreaterThan(flat.calculatedTargetSpending! * 0.5);
  });

  test('목표 잔여자산을 남기면서 역산하고, 그 하한선이 실제로 지켜진다', () => {
    const floor = 100_000_000;
    const result = engine.run(params({
      spendingStrategy: 'max_sustainable',
      spendingCurve: FRONT_LOADED,
      assetFloor: floor,
    }));

    // `> 0`으로는 아무것도 잡지 못한다 — 이진탐색이 붕괴하면 값이 **0.37원**이라 통과한다.
    // 하한선 단언도 마찬가지다: 붕괴하면 거의 안 쓰므로 기말자산이 29억이 되어 1억 하한을
    // 압도적으로 넘긴다. 그래서 "충분히 크다"와 "하한선 근처에서 멈춘다"를 함께 본다.
    const flat = engine.run(params({ spendingStrategy: 'max_sustainable', assetFloor: floor }));
    expect(result.calculatedTargetSpending!).toBeGreaterThan(flat.calculatedTargetSpending! * 0.5);
    // 월별 부동소수 누적 오차를 감안해 1% 여유를 둔다(assetFloor.test.ts와 같은 규약).
    expect(result.endingAssets).toBeGreaterThanOrEqual(floor * 0.99);
    // 하한선을 "지키는" 것과 "안 써서 한참 남기는" 것은 다르다. 이진탐색은 하한선에
    // 최대한 붙어야 한다.
    expect(result.endingAssets).toBeLessThan(floor * 1.5);
  });

  test('하한선이 높을수록 역산된 생활비가 낮아진다', () => {
    const low = engine.run(params({
      spendingStrategy: 'max_sustainable', spendingCurve: FRONT_LOADED, assetFloor: 50_000_000,
    }));
    const high = engine.run(params({
      spendingStrategy: 'max_sustainable', spendingCurve: FRONT_LOADED, assetFloor: 300_000_000,
    }));

    expect(high.calculatedTargetSpending!).toBeLessThan(low.calculatedTargetSpending!);
  });

  test('뒤로 갈수록 덜 쓰는 곡선은 균등형보다 기준액이 높게 역산된다', () => {
    // 곡선이 "공짜로 더 쓰는 수단"이 아니라 배분의 재조정임을 고정한다. 통계 곡선은
    // 70대 0.86·80대 0.76이라 총 지출이 균등형보다 적고, 그만큼 은퇴 «직후» 기준액을
    // 더 잡을 수 있다. 방향이 뒤집힌 것은 배수가 통계 기반으로 바뀌었기 때문이다
    // (예전 [1.2,1.0,0.8]은 앞을 더 써서 기준액이 낮아졌다).
    const flat = engine.run(params({ spendingStrategy: 'max_sustainable' }));
    const front = engine.run(params({ spendingStrategy: 'max_sustainable', spendingCurve: FRONT_LOADED }));

    expect(front.calculatedTargetSpending!).toBeGreaterThan(flat.calculatedTargetSpending!);
  });
});

describe('채점 분모와 차트 목표선이 같은 곡선을 본다', () => {
  test('곡선 구간을 모두 충족한 계획은 소비 효용이 만점이다', () => {
    // UtilityEngine의 targetAnnualSpendingForYear에 곡선을 곱하지 않으면, 배수 0.76 구간이
    // "목표 초과 소비"로 읽혀 만점이 나오지 않거나(clamp 전) 결손이 감춰진다.
    const withCurve = params({ spendingCurve: FRONT_LOADED });
    const result = engine.run(withCurve);

    expect(result.depletionAge).toBeNull();
    expect(computeLifetimeUtility(result, withCurve).components.consumption)
      .toBe(DEFAULT_UTILITY_CONFIG.weights.consumption);
  });

  test('차트의 연도별 목표가 엔진의 실제 지출과 일치한다', () => {
    const withCurve = params({ spendingCurve: FRONT_LOADED });
    const result = engine.run(withCurve);
    const composition = computeMonthlySpendingComposition(result.yearlyResults, withCurve, result);

    // 목표를 전부 충족하는 시나리오이므로 목표 = 실제 지출이어야 한다.
    for (const row of composition) {
      expect(row.targetMonthly).toBeCloseTo(spendingAt(result, row.age) / 12, 0);
      expect(row.shortfall).toBe(0);
    }
  });
});
