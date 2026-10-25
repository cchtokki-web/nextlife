import { describe, test, expect } from 'vitest';
import {
  NATIONAL_PENSION_OPTIONS, PRIVATE_PENSION_OPTIONS,
  RISK_PROFILE_OPTIONS, ECONOMIC_SCENARIO_OPTIONS, ISA_FIRST_OPTIONS,
} from '@/web/features/StrategySettings/strategyOptions';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { resolveAssumptionVariants } from '@/core/usecases/strategy/robustness';
import { SENTINEL_AXES, canFillSentinelAxis } from '@/core/usecases/strategy/verifiedSentinelPlan';
import { ECONOMIC_SCENARIO_PROFILES, GoverningEconomicScenario } from '@/core/usecases/scenario/economicScenarios';
import { BequestStrategy, RetirementStrategy, SimulationParams } from '@/core/entities/types';

// **문구는 엔진이 실제로 하는 일과 일치해야 한다.**
//
// 'ai_*' 센티널은 여러 축에 있고 전부 같은 라벨('AI 추천'/'AI 최적화')과 같은 Sparkles
// 아이콘, 같은 ⭐추천 배지를 달고 있다. 그런데 축마다 계약이 다르다:
//
//   - 결정 축(국민연금 개시 나이·ISA 만기 행선지 등): 검증된 값을 **실제로 채운다**.
//   - 가정 축(리스크 성향·경제 시나리오): 값을 채우지 않고, 여러 국면에서 견디는 계획을 고른다.
//   - 사적연금 인출량: 추천이 도착하면 검증된 값을 실제 계산에 자동 반영한다.
//
// 그 차이를 사용자에게 전달하는 단서는 설명 문구밖에 없다. 이 테스트는 문구를 한 자 한 자
// 고정하지 않고, **계약과 어긋나는 약속**만 막는다.

// "값을 정해 준다"는 약속. 값을 채우지 않는 축에 붙으면 거짓말이 된다.
const PROMISES_A_VALUE = /가장 유리한|최적의 값을 찾|알아서 정해/;

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

const compiledWith = (overrides: Partial<RetirementStrategy>) =>
  compileStrategy({ ...baseParams, strategy: { ...DEFAULT_RETIREMENT_STRATEGY, ...overrides } });

describe('AI 센티널 선택지 문구', () => {
  test('사적연금 자동 선택은 추천값을 채울 수 있음을 정확히 설명한다', () => {
    const compiled = compiledWith({ privatePensionStrategy: 'ai_optimized' });
    const axis = SENTINEL_AXES.find((a) => a.field === 'privatePensionMonthlyTarget')!;
    expect(compiled.params.withdrawalPlan?.privatePensionMonthlyTarget).toBeUndefined();
    expect(canFillSentinelAxis(axis, compiled.params)).toBe(true);
    expect(optionFor(PRIVATE_PENSION_OPTIONS, 'ai_optimized').description).toMatch(/자동 반영/);
  });

  test('값을 채우지 않는 축들은 값을 약속하지 않는다', () => {
    // 목표 우선순위·생활비 전략은 이 패널에 없다(「은퇴 목표」 카드가 정한다). 남은 가정 축만 본다.
    const undecided = [
      optionFor(RISK_PROFILE_OPTIONS, 'ai_recommended'),
      optionFor(ECONOMIC_SCENARIO_OPTIONS, 'ai_recommended'),
    ];

    for (const option of undecided) {
      expect(option.description, option.description).not.toMatch(PROMISES_A_VALUE);
    }
  });

  test('값을 실제로 채우는 축은 "찾아서 적용한다"고 말한다', () => {
    // 국민연금 개시 나이와 ISA 만기 행선지는 applyAiSentinels가 검증 후 실제로 채운다.
    // 문구가 그 사실을 담아야 값을 채우지 않는 축들과 구분된다.
    expect(optionFor(NATIONAL_PENSION_OPTIONS, 'ai_optimized').description).toMatch(/찾|계산에 자동 반영|계산합니다/);
    expect(optionFor(ISA_FIRST_OPTIONS, 'ai_optimized').description).toMatch(/찾|계산에 자동 반영|계산합니다/);
  });

  test('ISA 만기 행선지의 AI 최적화는 실제로 자동 채움 대상이다', () => {
    // 문구가 "찾아 적용한다"고 말하려면 엔진이 정말 그 축을 채울 수 있어야 한다.
    const compiled = compiledWith({ preferIsaFirst: 'ai_optimized' });
    const axis = SENTINEL_AXES.find((a) => a.field === 'isaMaturityDestination')!;

    expect('isaMaturityDestination' in (compiled.params.withdrawalPlan ?? {})).toBe(false);
    expect(canFillSentinelAxis(axis, compiled.params)).toBe(true);
  });

  test('확정 행선지를 고르면 자동 채움 대상이 아니다', () => {
    const compiled = compiledWith({ preferIsaFirst: 'pension_first' });
    const axis = SENTINEL_AXES.find((a) => a.field === 'isaMaturityDestination')!;

    expect(compiled.params.withdrawalPlan?.isaMaturityDestination).toBe('pension');
    expect(canFillSentinelAxis(axis, compiled.params)).toBe(false);
  });

  test('가정 축의 AI 추천은 "국면 전체에서 견딘다"고 말한다', () => {
    // 이 축들은 값을 채우지 않는 대신 여러 국면에서 재평가한다(강건성 모드).
    // 문구가 "아무것도 하지 않는다"로만 읽히면 실제 동작보다 소극적인 거짓이 된다.
    expect(resolveAssumptionVariants(compiledWith({}).params).length).toBeGreaterThan(0);

    expect(optionFor(RISK_PROFILE_OPTIONS, 'ai_recommended').description).toMatch(/모두|견디/);
    expect(optionFor(ECONOMIC_SCENARIO_OPTIONS, 'ai_recommended').description).toMatch(/모두|견디/);
  });

  // 경제 시나리오 선택지의 설명문은 ECONOMIC_SCENARIO_PROFILES가 실제로 지배하는 값(물가·
  // 환율)을 그대로 인용해야 한다. 이 브랜치가 고친 것이 바로 "설명문이 엔진의 값과 다른
  // 숫자를 말하던" 문제이므로, 숫자를 테스트에 다시 손으로 박으면 같은 방식으로 썩는다 —
  // 반드시 ECONOMIC_SCENARIO_PROFILES에서 기대값을 끌어온다.
  test('경제 시나리오 설명문은 ECONOMIC_SCENARIO_PROFILES의 물가·환율과 일치한다', () => {
    for (const scenario of Object.keys(ECONOMIC_SCENARIO_PROFILES) as GoverningEconomicScenario[]) {
      const profile = ECONOMIC_SCENARIO_PROFILES[scenario];
      const description = optionFor(ECONOMIC_SCENARIO_OPTIONS, scenario).description;

      expect(description, description).toContain(`물가 ${profile.inflationRate}%`);
      if (profile.exchangeScenario === 'usd_up') {
        expect(description, description).toContain('원화 약세');
      } else {
        expect(description, description).not.toContain('원화 약세');
      }
    }
  });

  // 화면에서 고를 수는 없어졌지만(생활비 전략은 목표 카드가 정한다), 저장된 시나리오에는
  // 아직 'ai'가 남아 있을 수 있다. 그때 엔진이 목표 생활비를 그대로 쓰는지는 계속 고정한다.
  test('저장된 생활비 AI 추천은 목표액 모드로 내려간다', () => {
    expect(compiledWith({ spendingChoice: 'ai' }).params.spendingStrategy).toBe('target');
  });
});

describe('상속 전략 — 제약인가 채점인가', () => {
  // 네 값 중 엔진에 실제 제약(assetFloor)을 거는 것은 '목표 금액 유지' 하나뿐이다. 나머지
  // 셋은 채점 기준만 바꾼다. 화면에서 고르는 것은 「상속 자산 확보」 목표뿐이지만, 그 목표가
  // 무엇으로 번역되는지는 이 성질에 달려 있다.
  const withBequest = (bequestStrategy: BequestStrategy, targetBequest?: number) =>
    compileStrategy({
      ...baseParams,
      userProfile: {
        ...baseParams.userProfile,
        ...(targetBequest === undefined ? {} : { targetBequest }),
      },
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, bequestStrategy },
    });

  test('목표 금액 유지만 하한선을 세운다', () => {
    expect(withBequest('target_amount', 500_000_000).params.assetFloor).toBe(500_000_000);
    expect(withBequest('spend_all').params.assetFloor).toBeUndefined();
    expect(withBequest('leave_some').params.assetFloor).toBeUndefined();
    expect(withBequest('maximize').params.assetFloor).toBeUndefined();
  });

});

describe('ISA 만기 행선지 문구 — 엔진이 실제로 하는 일', () => {
  test('"생활비로 먼저 쓴다"고 말하지 않는다', () => {
    // 엔진이 하는 것은 만기 자금의 이동처를 정하는 것뿐이다. 인출 순서를 앞당기지 않는다.
    for (const option of ISA_FIRST_OPTIONS) {
      expect(option.description, option.description).not.toMatch(/먼저 씁니다|먼저 사용/);
    }
  });

  test('확정 선택지 둘은 각각의 행선지를 명시한다', () => {
    expect(optionFor(ISA_FIRST_OPTIONS, 'pension_first').description).toMatch(/연금/);
    expect(optionFor(ISA_FIRST_OPTIONS, 'isa_first').description).toMatch(/일반 자산/);
  });
});
