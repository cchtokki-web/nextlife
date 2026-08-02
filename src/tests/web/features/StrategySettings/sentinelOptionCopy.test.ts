import { describe, test, expect } from 'vitest';
import {
  NATIONAL_PENSION_OPTIONS, PRIVATE_PENSION_OPTIONS, OBJECTIVE_OPTIONS,
  RISK_PROFILE_OPTIONS, ECONOMIC_SCENARIO_OPTIONS, SPENDING_STRATEGY_OPTIONS,
} from '@/web/features/StrategySettings/strategyOptions';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { SimulationParams } from '@/core/entities/types';

// 'ai_*' 센티널은 다섯 축에 있지만 값이 실제로 시뮬레이션에 들어가는 것은 국민연금 하나뿐이다.
// 나머지 넷은 "미정"으로 남아 baseline으로 계산된다. 다섯이 같은 라벨('AI 추천'/'AI 최적화')과
// 같은 Sparkles 아이콘, 같은 ⭐추천 배지를 달고 있으므로, 그 계약 차이를 사용자에게 전달하는
// 단서는 설명 문구밖에 없다.
//
// 이 테스트는 문구를 한 자 한 자 고정하지 않는다. "무언가를 찾아 준다"는 약속이 실제로
// 아무것도 하지 않는 축에 붙는 것만 막는다.
const OVERPROMISE = /가장 유리한|최적의 값을 찾|알아서 정해/;

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const optionFor = <T extends string>(
  options: ReadonlyArray<{ value: T; description: string }>,
  value: T
) => {
  const found = options.find((o) => o.value === value);
  expect(found, `${value} 선택지가 사라졌다`).toBeDefined();
  return found!;
};

describe('AI 센티널 선택지 문구', () => {
  test('사적연금 AI 최적화는 실제로 아무것도 지배하지 않으므로 최적화를 약속하지 않는다', () => {
    // 실제 동작 확인: 'ai_optimized'로 컴파일해도 privatePensionMonthlyTarget이 생기지 않는다.
    const compiled = compileStrategy({
      ...baseParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, privatePensionStrategy: 'ai_optimized' },
    });
    expect(compiled.params.withdrawalPlan?.privatePensionMonthlyTarget).toBeUndefined();

    expect(optionFor(PRIVATE_PENSION_OPTIONS, 'ai_optimized').description)
      .not.toMatch(OVERPROMISE);
  });

  test('값을 채우지 않는 축들은 모두 최적화를 약속하지 않는다', () => {
    const undecided = [
      optionFor(PRIVATE_PENSION_OPTIONS, 'ai_optimized'),
      optionFor(OBJECTIVE_OPTIONS, 'ai_recommended'),
      optionFor(RISK_PROFILE_OPTIONS, 'ai_recommended'),
      optionFor(ECONOMIC_SCENARIO_OPTIONS, 'ai_recommended'),
      optionFor(SPENDING_STRATEGY_OPTIONS, 'ai'),
    ];

    for (const option of undecided) {
      expect(option.description, option.description).not.toMatch(OVERPROMISE);
    }
  });

  test('국민연금 AI 최적화만 "찾은 값으로 계산한다"고 말한다', () => {
    // 이 축만 applyAiSentinels가 실제로 채운다. 문구가 그 사실을 담아야 나머지 넷과 구분된다.
    expect(optionFor(NATIONAL_PENSION_OPTIONS, 'ai_optimized').description)
      .toMatch(/계산합니다/);
  });

  test('생활비 AI 추천은 계산에 입력값이 쓰인다는 사실을 밝힌다', () => {
    // compileStrategy가 'ai'를 baseline인 'target'으로 내린다 — 제안은 힌트일 뿐이다.
    const compiled = compileStrategy({
      ...baseParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, spendingChoice: 'ai' },
    });
    expect(compiled.params.spendingStrategy).toBe('target');

    expect(optionFor(SPENDING_STRATEGY_OPTIONS, 'ai').description)
      .toMatch(/입력한 목표 생활비/);
  });
});
