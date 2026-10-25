import { describe, test, expect } from 'vitest';
import { resolvePlanAssetStatus } from '@/core/usecases/dashboard/resolvePlanAssetStatus';
import { SimulationParams, SimulationResult } from '@/core/entities/types';
import { makeYearlyResult } from '@/tests/fixtures/yearlyResult';

// 기대수명 90을 기준으로 판정을 확인한다. 다른 필드는 판정에 관여하지 않으므로 최소값만 채운다.
const paramsWithExpectancy90: SimulationParams = {
  userProfile: { currentAge: 51, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

// 자산이 하나도 없는 계획에서 엔진은 첫 해에 곧바로 depletionAge를 잡는다
// (totalAssets <= 0이 고갈 조건이므로 0원으로 시작하면 첫 해가 곧 고갈이다).
// 그 상태를 "고갈"이라고 부르면 화면이 "51세에 자산이 고갈될 위험이 있습니다"라고
// 말하는데, 사용자에게는 고갈시킬 자산 자체가 없다. 두 상태를 갈라야 한다.
function makeResult(overrides: Partial<SimulationResult> = {}): SimulationResult {
  return {
    yearlyResults: [],
    fireAge: null,
    depletionAge: null,
    endingAssets: 0,
    retirementScore: 50,
    retirementGrade: '보통',
    goalAchievementRate: 50,
    retirementAssetsAtRetirement: 0,
    ...overrides,
  };
}

describe('resolvePlanAssetStatus', () => {
  test('모든 해의 자산이 0 이하면 고갈이 아니라 미보유다', () => {
    const result = makeResult({
      depletionAge: 51,
      yearlyResults: [51, 60, 90].map((age) => makeYearlyResult({ age, totalAssets: 0 })),
    });

    expect(resolvePlanAssetStatus(result, paramsWithExpectancy90)).toBe('no_investable_asset');
  });

  // 잔액 0에서 월 납입으로 자산을 쌓다가 나중에 고갈되는 적립식 계획을 "미보유"로
  // 분류하면 안 된다 — 그래서 판정 근거가 "현재 자산이 0인가"가 아니라 시뮬레이션이
  // 실제로 돈 결과 전체다.
  test('중간에 자산이 쌓였다가 고갈되면 미보유가 아니라 고갈이다', () => {
    const result = makeResult({
      depletionAge: 80,
      yearlyResults: [
        makeYearlyResult({ age: 51, totalAssets: 0 }),
        makeYearlyResult({ age: 60, totalAssets: 30000000 }),
        makeYearlyResult({ age: 80, totalAssets: 0 }),
      ],
    });

    expect(resolvePlanAssetStatus(result, paramsWithExpectancy90)).toBe('depleted');
  });

  test('고갈 없이 자산이 남으면 유지다', () => {
    const result = makeResult({
      depletionAge: null,
      endingAssets: 100000000,
      yearlyResults: [makeYearlyResult({ age: 60, totalAssets: 100000000 })],
    });

    expect(resolvePlanAssetStatus(result, paramsWithExpectancy90)).toBe('sustained');
  });

  // 기대수명에 도달해서야 잔액이 0이 된 것은 "계획대로 다 쓰고 감"이지 실패가 아니다.
  test('기대수명에 이르러 소진된 것은 고갈로 보지 않는다', () => {
    const result = makeResult({
      depletionAge: 90,
      yearlyResults: [
        makeYearlyResult({ age: 60, totalAssets: 50000000 }),
        makeYearlyResult({ age: 90, totalAssets: 0 }),
      ],
    });

    expect(resolvePlanAssetStatus(result, paramsWithExpectancy90)).toBe('sustained');
  });

  // yearlyResults가 비어 있으면(엔진의 조기 반환 경로) "모든 해가 0 이하"가 공허하게
  // 참이 되어 자산이 있는 계획까지 미보유로 뒤집힌다.
  test('연도별 결과가 비어 있으면 미보유로 단정하지 않는다', () => {
    expect(resolvePlanAssetStatus(makeResult({ yearlyResults: [] }), paramsWithExpectancy90)).toBe('sustained');
  });
});
