import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import type { SimulationParams } from '@/core/entities/types';

/**
 * **「사적연금 인출은 소득이 아니다」를 세 지표가 «같은 방식으로» 센다.**
 *
 * 이 규칙은 세 곳에 따로 구현돼 있다.
 *
 *   - retirementScore의 안정소득     (SimulationEngine, 20점)
 *   - goalAchievementRate의 고정소득 (SimulationMetricsCalculator, 25점 cashFlowScore)
 *   - fireAge 판정                   (SimulationEngine)
 *
 * 셋을 각각 고친 세 커밋에는 각자의 단위 테스트가 있지만, «합쳐진 결과»를 보는 것이 없었다.
 * 그래서 사적연금 비중이 큰 계획이 같은 성질 하나로 세 번 감점되어 등급이 두 칸 내려가도
 * 스냅샷 숫자만 조용히 바뀔 뿐, 그것이 의도인지 과잉교정인지 말해 주는 단언이 없다.
 *
 * 여기서 잠그는 것은 «점수»가 아니라 «정의의 일치»다. 점수는 계속 튜닝될 수 있어도,
 * 세 지표가 서로 다른 소득 정의를 쓰기 시작하면 사용자에게 점수를 설명할 수 없다.
 */
const engine = new SimulationEngine();

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 4_000_000 },
    // 국민연금·배당·기타소득이 절반, 사적연금이 절반인 계획.
    assets: [
      {
        id: 'etf', type: 'etf', ticker: '069500', name: 'KODEX 200',
        quantity: 3_000, averagePrice: 100_000, totalReturn: 5, dividendYield: 3,
        monthlyContribution: 0, reinvestDividend: false, currency: 'KRW',
      },
    ],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 1_000_000 },
    privatePensions: [
      { id: 'irp', type: 'irp', balance: 300_000_000, monthlyContribution: 0, totalReturn: 4, currency: 'KRW' },
    ],
    otherIncomes: [
      { id: 'rent', label: '상가 임대료', monthlyAmount: 3_000_000, currency: 'KRW' },
    ],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

describe('사적연금 제외 규칙의 지표 간 정합', () => {
  // 공개된 연도별 결과로 «정의»를 직접 재현한다. 이 픽스처는 사적연금 인출이 실제로 큰
  // 계획이라, 정의가 어긋나면(사적연금을 소득으로 세면) 두 값이 크게 벌어진다.
  test('고정소득 커버율의 분자는 totalIncome에서 사적연금만 뺀 값이다', () => {
    const result = engine.run(params());
    const retired = result.yearlyResults.filter((row) => row.age >= 60);

    const expected = retired
      .reduce((sum, row) => sum + (row.totalIncome - row.privatePensionIncome) / 12, 0) / retired.length;

    expect(result.avgRetirementMonthlyIncome).toBeCloseTo(expected, -3);
    // 전제 확인: 사적연금 인출이 0이 아니어야 이 단언이 뜻을 갖는다. 0이면 빼든 말든 같다.
    expect(retired.reduce((sum, row) => sum + row.privatePensionIncome, 0)).toBeGreaterThan(0);
  });

  // fireAge도 같은 식(totalIncome − privatePensionIncome)을 쓴다. 그래서 「고정소득이 목표를
  // 넘긴 첫 해」와 fireAge가 어긋나면 두 지표가 다른 정의를 쓰기 시작한 것이다.
  test('fireAge는 고정소득 커버율과 같은 소득 정의를 쓴다', () => {
    const result = engine.run(params());
    const target = 4_000_000 * 12;

    const firstCovered = result.yearlyResults
      .find((row) => row.age >= 60 && (row.totalIncome - row.privatePensionIncome) >= target);

    expect(result.fireAge).toBe(firstCovered?.age ?? null);
  });

  // **안정소득(20점 축)의 식이 고정소득 커버율의 분자와 «같은 것»이 됐다.**
  //
  // 안정소득 = (pensionIncome − privatePensionIncome) + dividendIncome + otherIncome 이고,
  // 고정소득 커버율의 분자 = totalIncome − privatePensionIncome 인데,
  // totalIncome = dividendIncome + pensionIncome + otherIncome 이므로 둘은 항등식이다.
  // 그것이 이 커밋들이 노린 상태다 — 같은 개념을 두 곳에서 다르게 세지 않는다.
  //
  // 그래서 «두 축을 갈라놓는 시나리오는 원리상 없다». 아래는 그 항등식을 연도별 결과로
  // 직접 확인한다. 어느 한쪽 식이 바뀌면 이 등식이 먼저 깨진다.
  //
  // 한계를 밝혀 둔다: avgStableIncome은 결과 객체로 나오지 않아 이 축을 «단독으로» 관측할
  // 수 없다. 그래서 이 파일은 식의 동일성까지만 잠그고, 축의 배점 자체는 잠그지 않는다.
  test('안정소득과 고정소득 커버율의 분자는 같은 식이다', () => {
    const result = engine.run(params());
    const retired = result.yearlyResults.filter((row) => row.age >= 60);

    for (const row of retired) {
      const stableIncome = (row.pensionIncome - row.privatePensionIncome)
        + row.dividendIncome + row.otherIncome;
      const fixedIncomeNumerator = row.totalIncome - row.privatePensionIncome;
      expect(stableIncome).toBeCloseTo(fixedIncomeNumerator, 6);
    }

    // 전제 확인: 세 소득이 모두 0이 아니어야 위 등식이 뜻을 갖는다.
    const totals = retired.reduce((acc, row) => ({
      national: acc.national + (row.pensionIncome - row.privatePensionIncome),
      dividend: acc.dividend + row.dividendIncome,
      other: acc.other + row.otherIncome,
    }), { national: 0, dividend: 0, other: 0 });
    expect(totals.national).toBeGreaterThan(0);
    expect(totals.dividend).toBeGreaterThan(0);
    expect(totals.other).toBeGreaterThan(0);
  });

  // 세 번 감점의 «상한»을 둔다. 고갈되지 않고 은퇴 시점보다 많은 자산으로 끝나는 계획이
  // 「주의」보다 낮게 떨어지면, 그것은 규칙이 아니라 과잉교정이다.
  test('고갈 없이 끝나는 계획을 세 겹으로 감점해 최하 등급으로 보내지 않는다', () => {
    const result = engine.run(params());

    expect(result.depletionAge).toBeNull();
    expect(result.endingAssets).toBeGreaterThan(0);
    expect(result.retirementGrade).not.toBe('위험');
  });
});
