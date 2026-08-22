import { describe, test, expect } from 'vitest';
import {
  compileStrategy, DEFAULT_RETIREMENT_STRATEGY, resolveStrategy,
} from '@/core/usecases/strategy/compileStrategy';
import { ECONOMIC_SCENARIO_PROFILES } from '@/core/usecases/scenario/economicScenarios';
import { DEFAULT_PRIVATE_PENSION_LIMIT_KRW } from '@/core/usecases/tax/taxRates';
import { RetirementStrategy, SimulationParams } from '@/core/entities/types';

// 각 전략 축은 단독으로는 촘촘히 검증되지만, 두 축(또는 축과 레거시 씨앗)이 같은 저수준
// 필드를 동시에 건드릴 때 누가 이기는지는 대부분 고정되어 있지 않다. 이 파일은 그 승패만
// 다룬다 — 축 하나짜리 번역 규칙은 compileStrategy.{test,pension,investment,legacy}.ts에 있다.
//
// 이미 다른 파일이 덮고 있어 여기서 반복하지 않는 조합:
//   - privatePensionStrategy × taxSettings.limitPrivatePensionToTaxLimit
//     → compileStrategy.pension.test.ts의 '명시적 전략은 고급 설정의 한도 내 인출 값을 덮어쓴다'
//
// 2026-08-22: riskProfile × economicScenario(수익률의 최종 승자) 조합은 더 이상 존재하지
// 않는다 — 어느 축도 수익률을 지배하지 않으므로 "승자"가 없다. 아래 '네 축이 동시에…'가
// 그 사실(사용자 입력이 항상 남는다)을 대신 고정한다.

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 1,
      totalReturn: 7, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: false, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 1000, monthlyContribution: 0, totalReturn: 4, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const withStrategy = (
  patch: Partial<RetirementStrategy>,
  paramsPatch: Partial<SimulationParams> = {}
): SimulationParams => ({
  ...baseParams,
  ...paramsPatch,
  strategy: { ...DEFAULT_RETIREMENT_STRATEGY, ...patch },
});

describe('상속 축 × 레거시 targetBequest 씨앗', () => {
  // 레거시 씨앗은 targetBequest > 0을 'target_amount'로 읽는다(seedStrategyFromLegacyParams).
  // 그러니 저장된 금액이 있는 시나리오에서 사용자가 새 UI로 다른 상속 전략을 고르면 두
  // 규칙이 정면으로 부딪힌다. 이 describe가 없으면 우선순위가 뒤집혀 사용자가 방금 고른
  // 전략이 저장된 금액에 의해 되살아나도(또는 그 반대로) 아무 테스트도 빨간불이 되지 않는다.

  test('명시적 "모두 사용"은 저장된 targetBequest를 0으로 지운다', () => {
    const params = withStrategy(
      { bequestStrategy: 'spend_all' },
      { userProfile: { ...baseParams.userProfile, targetBequest: 500000000 } }
    );

    // 씨앗이 이기면 5억이 그대로 남아, 사용자가 고른 '모두 사용'이 조용히 무시된다.
    expect(compileStrategy(params).params.userProfile.targetBequest).toBe(0);
  });

  test('명시적 "일부 남기기"는 저장된 targetBequest를 월생활비 × 24로 덮어쓴다', () => {
    const params = withStrategy(
      { bequestStrategy: 'leave_some' },
      { userProfile: { ...baseParams.userProfile, targetBequest: 500000000 } }
    );

    // 현재 동작을 그대로 고정한다: 사용자가 입력해 둔 5억은 사라지고 7,200만원이 된다.
    // ('일부 남기기'는 기본값이기도 하므로 이 값이 흔들리면 저장된 금액을 가진 모든
    //  시나리오의 상속 채점이 함께 흔들린다.)
    expect(compileStrategy(params).params.userProfile.targetBequest).toBe(3000000 * 24);
  });

  test('명시적 "목표 금액 유지"인데 입력된 금액이 없으면 미지정으로 떨어진다', () => {
    // 금액 입력 없이 '목표 금액 유지'만 고른 상태. targetBequest 키 자체가 사라져야
    // UtilityEngine이 기존 추정식(월생활비 × appropriateBequestMonths)으로 채점한다.
    // 0으로 떨어지면 "모두 사용"으로 뒤바뀌어 상속 점수가 통째로 달라진다.
    const compiled = compileStrategy(withStrategy({ bequestStrategy: 'target_amount' }));

    expect(compiled.params.userProfile.targetBequest).toBeUndefined();
    expect('targetBequest' in compiled.params.userProfile).toBe(false);
  });
});

describe('생활비 축 × 레거시 spendingStrategy 씨앗', () => {
  // resolveStrategy 수준의 우선순위는 compileStrategy.legacy.test.ts가 한 방향만 본다
  // (씨앗 'dividend_only' vs 명시적 'target'). 여기서 고정하는 것은 컴파일 결과로 실제
  // 엔진에 내려가는 params.spendingStrategy다 — 그 배선이 끊기면 화면은 새 선택을 보여주는데
  // 엔진은 레거시 값으로 계산한다(이 저장소가 이미 한 번 겪은 결함이다).

  test('명시적 spendingChoice가 저장된 레거시 spendingStrategy를 이긴다', () => {
    const params = withStrategy(
      { spendingChoice: 'max_sustainable' },
      { spendingStrategy: 'dividend_only' }
    );

    expect(compileStrategy(params).params.spendingStrategy).toBe('max_sustainable');
  });

  test('spendingChoice "AI 추천"은 레거시 씨앗을 살리지 않고 baseline(target)으로 내린다', () => {
    // 'ai'는 "미정" 센티널이지만 명시적으로 저장된 값이므로 씨앗보다 우선한다.
    // 즉 레거시 'dividend_only' 시나리오에서 사용자가 'AI 추천'을 고르면 엔진은 'target'으로
    // 돈다. 센티널이 씨앗으로 폴백하도록 바뀌면 여기서 잡힌다.
    const params = withStrategy({ spendingChoice: 'ai' }, { spendingStrategy: 'dividend_only' });

    expect(compileStrategy(params).params.spendingStrategy).toBe('target');
    // 사용자가 무엇을 골랐는지는 strategy 쪽에 그대로 남는다.
    expect(compileStrategy(params).params.strategy?.spendingChoice).toBe('ai');
  });
});

describe('네 축이 동시에 저수준 필드를 정하는 경우', () => {
  // 축별 테스트는 한 번에 한 축만 켜므로, 한 축의 적용이 다른 축이 이미 써 둔 필드를
  // 되돌려도 드러나지 않는다(예: applyYieldPreset이 params 전체를 다시 만들면서
  // 시나리오가 정한 inflationRate를 날리는 식). 다섯 필드를 한 번에 단정해 그 상호
  // 간섭을 막는다. 레거시 씨앗과 고급 설정도 함께 켜 최대 충돌 상태로 만든다.
  const params = withStrategy(
    {
      economicScenario: 'high_inflation', // 물가 5%, 환율 usd_up (수익률은 지배하지 않는다)
      riskProfile: 'ai_recommended', // 2026-08-22: 어떤 값이어도 수익률을 지배하지 않는다
      privatePensionStrategy: 'tax_first', // 한도 내 인출 강제 + 한도 전액 인출
      bequestStrategy: 'spend_all',
      spendingChoice: 'max_sustainable',
    },
    {
      // 레거시 씨앗: 상속은 '목표 금액 유지', 생활비는 '배당금만 소비'로 유도된다.
      userProfile: { ...baseParams.userProfile, targetBequest: 500000000 },
      spendingStrategy: 'dividend_only',
      // 고급 설정: 전략이 지배하는 값과 반대로 저장되어 있다.
      taxSettings: { limitPrivatePensionToTaxLimit: false } as SimulationParams['taxSettings'],
    }
  );
  const compiled = compileStrategy(params);

  test('물가·환율은 경제 시나리오가 정한 값이 남는다', () => {
    expect(compiled.params.inflationRate).toBe(ECONOMIC_SCENARIO_PROFILES.high_inflation.inflationRate);
    expect(compiled.params.exchangeScenario).toBe(ECONOMIC_SCENARIO_PROFILES.high_inflation.exchangeScenario);
  });

  // 2026-08-22: 경제 시나리오도 리스크 성향도 수익률을 지배하지 않는다. 두 축이 동시에
  // 「고물가」·「지배값」으로 켜져 있어도 사용자가 baseParams에 입력한 값이 그대로 남아야
  // 한다 — 최대 충돌 상태에서도 수익률만은 침범당하지 않는다는 것이 이 축 분리의 핵심이다.
  test('수익률은 어느 축의 개입도 없이 사용자 입력이 그대로 남는다', () => {
    expect(compiled.params.assets[0].totalReturn).toBe(baseParams.assets[0].totalReturn);
    expect(compiled.params.privatePensions[0].totalReturn).toBe(baseParams.privatePensions[0].totalReturn);
    expect(compiled.params.yieldPreset).toBeUndefined();
  });

  test('연금 축은 고급 설정과 다른 축의 적용에도 지워지지 않는다', () => {
    expect(compiled.params.taxSettings?.limitPrivatePensionToTaxLimit).toBe(true);
    expect(compiled.params.withdrawalPlan?.privatePensionMonthlyTarget)
      .toBe(DEFAULT_PRIVATE_PENSION_LIMIT_KRW / 12);
  });

  test('상속·생활비 축은 레거시 씨앗을 이긴 결과가 그대로 남는다', () => {
    expect(compiled.params.userProfile.targetBequest).toBe(0);
    expect(compiled.params.spendingStrategy).toBe('max_sustainable');
  });

  test('충돌 상태에서도 컴파일이 멱등이다', () => {
    // 컴파일 결과를 다시 읽는 쪽(resolveStrategy)이 실체화된 저수준 값을 레거시 씨앗으로
    // 재해석하면 축이 되돌아간다 — targetBequest 0이 'spend_all'로, 'max_sustainable'이
    // spendingChoice로 재유도되는데, 둘 다 이미 고른 값과 같아야 결과가 안정된다.
    const twice = compileStrategy(compiled.params);

    expect(twice.params).toEqual(compiled.params);
    expect(resolveStrategy(compiled.params)).toEqual(compiled.params.strategy);
  });
});
