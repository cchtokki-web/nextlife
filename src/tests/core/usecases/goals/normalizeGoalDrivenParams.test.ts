import { describe, expect, test } from 'vitest';
import { initialParams } from '@/infrastructure/storage/localStore';
import type { SimulationParams } from '@/core/entities/types';
import { normalizeGoalDrivenParams } from '@/core/usecases/goals/normalizeGoalDrivenParams';
import { migrateRetirementGoals } from '@/core/usecases/goals/retirementGoalAdapter';
import { compileStrategy, resolveStrategy } from '@/core/usecases/strategy/compileStrategy';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '@/core/usecases/pension/nationalPensionRules';

function normalize(params: SimulationParams): SimulationParams {
  return normalizeGoalDrivenParams(params, resolveStrategy(params));
}

describe('normalizeGoalDrivenParams — 목표가 정하는 축', () => {
  test('「빠른 은퇴」를 고르지 않으면 국민연금 정상 개시 나이로 은퇴한다', () => {
    const normalized = normalize({
      ...initialParams,
      retirementGoals: [{ type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' }],
    });

    expect(initialParams.userProfile.retirementAge).not.toBe(NATIONAL_PENSION_NORMAL_START_AGE);
    expect(normalized.userProfile.retirementAge).toBe(NATIONAL_PENSION_NORMAL_START_AGE);
  });

  test('「빠른 은퇴」를 고르면 그 목표값이 은퇴 나이가 된다', () => {
    const normalized = normalize({
      ...initialParams,
      retirementGoals: [
        { type: 'EARLY_RETIREMENT', priority: 1, targetValue: 58, constraintType: 'HARD' },
      ],
    });

    expect(normalized.userProfile.retirementAge).toBe(58);
  });

  // 목표 금액은 모든 전략에서 소비 만족도의 «분모»라 계산에 계속 필요하고, 이 축에는
  // 「권장」 상수가 없다. 지워 버리면 채점 기준이 사라진다.
  test('생활비 목표가 없으면 저장된 목표 생활비를 그대로 둔다', () => {
    const normalized = normalize({
      ...initialParams,
      userProfile: { ...initialParams.userProfile, targetMonthlySpending: 2_800_000 },
      retirementGoals: [{ type: 'TAX_OPTIMIZATION', priority: 1, constraintType: 'SOFT' }],
    });

    expect(normalized.userProfile.targetMonthlySpending).toBe(2_800_000);
  });

  test('생활비 목표를 고르면 그 목표값이 목표 생활비가 된다', () => {
    const normalized = normalize({
      ...initialParams,
      retirementGoals: [
        { type: 'COMFORTABLE_SPENDING', priority: 1, targetValue: 4_200_000, constraintType: 'SOFT' },
      ],
    });

    expect(normalized.userProfile.targetMonthlySpending).toBe(4_200_000);
  });

  test('상속 목표가 없으면 「일부 남기기」로 되돌리고 목표 상속자산 키를 지운다', () => {
    const normalized = normalize({
      ...initialParams,
      userProfile: { ...initialParams.userProfile, targetBequest: 300_000_000 },
      retirementGoals: [{ type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' }],
    });

    expect('targetBequest' in normalized.userProfile).toBe(false);
    expect(normalized.strategy?.bequestStrategy).toBe('leave_some');
  });

  test('상속 목표를 고르면 그 금액을 지키는 전략으로 컴파일된다', () => {
    const normalized = normalize({
      ...initialParams,
      retirementGoals: [
        { type: 'INHERITANCE', priority: 1, targetValue: 100_000_000, constraintType: 'HARD' },
      ],
    });

    expect(normalized.userProfile.targetBequest).toBe(100_000_000);
    expect(normalized.strategy?.bequestStrategy).toBe('target_amount');
  });
});

describe('normalizeGoalDrivenParams — 고급 설정에서 사라진 축', () => {
  // 이 조합이 이번 작업의 출발점이다. 「생활비 안정」을 고른 계획이 배당금만 소비로 돌면
  // 목표 금액은 인출에 쓰이지 않으면서 채점 분모로만 남고, 부족분 판정식이 「계획한 인출액」
  // 기준이라 목표 달성 확률은 구조적으로 100%가 된다.
  test('저장된 「배당금만 소비」는 「원하는 생활비 직접 입력」으로 정규화된다', () => {
    const saved: SimulationParams = {
      ...initialParams,
      spendingStrategy: 'dividend_only',
      retirementGoals: [
        { type: 'LIVING_EXPENSE_STABILITY', priority: 1, targetValue: 3_000_000, constraintType: 'SOFT' },
      ],
    };

    expect(resolveStrategy(saved).spendingChoice).toBe('dividend_only');
    expect(normalize(saved).strategy?.spendingChoice).toBe('target');
    // 엔진에 실제로 내려가는 저수준 필드까지 확인한다 — 여기가 인출 규칙을 정한다.
    // 정규화는 시나리오를 읽을 때 일어나므로(migrateRetirementGoals) 그 뒤에 컴파일한다.
    expect(compileStrategy(migrateRetirementGoals(saved)).params.spendingStrategy).toBe('target');
  });

  test('저장된 목표 우선순위는 균형 평가로 정규화된다', () => {
    const saved: SimulationParams = {
      ...initialParams,
      strategy: { ...resolveStrategy(initialParams), objective: 'tax_minimization' },
    };

    expect(normalize(saved).strategy?.objective).toBe('ai_recommended');
  });

  // 소비 성향·최소 생활비·안전마진은 「평생 소비 최적화」에서만 보이던 하위 입력이다.
  // 그 전략이 사라진 뒤에도 값이 남아 있으면 화면 어디에도 없는 값이 곡선과 하한선을 움직인다.
  test('평생 소비 최적화 전용 하위 입력은 무동작 값으로 되돌린다', () => {
    const saved: SimulationParams = {
      ...initialParams,
      strategy: {
        ...resolveStrategy(initialParams),
        spendingChoice: 'max_sustainable',
        spendingShape: 'front_loaded',
        minMonthlySpending: 2_000_000,
        bequestSafetyMarginRate: 30,
      },
    };

    const normalized = normalize(saved);
    expect(normalized.strategy?.spendingShape).toBe('flat');
    expect(normalized.strategy?.bequestSafetyMarginRate).toBe(0);
    expect(normalized.strategy?.minMonthlySpending).toBeUndefined();
    expect(compileStrategy(migrateRetirementGoals(saved)).params.spendingCurve).toBeUndefined();
  });

  test('연금·투자·경제 축은 건드리지 않는다', () => {
    const saved: SimulationParams = {
      ...initialParams,
      strategy: {
        ...resolveStrategy(initialParams),
        nationalPensionStrategy: 'defer_max',
        privatePensionStrategy: 'tax_first',
        riskProfile: 'conservative',
        economicScenario: 'high_inflation',
        preferIsaFirst: 'isa_first',
      },
    };

    expect(normalize(saved).strategy).toMatchObject({
      nationalPensionStrategy: 'defer_max',
      privatePensionStrategy: 'tax_first',
      riskProfile: 'conservative',
      economicScenario: 'high_inflation',
      preferIsaFirst: 'isa_first',
    });
  });
});

// 시나리오를 읽는 경로(useScenarios의 migrateParams)와 엔진에 들어가는 경로(compileStrategy)를
// 이어 붙여, 화면이 실제로 계산하는 값이 목표를 따르는지 확인한다.
describe('저장된 시나리오 → 엔진 입력', () => {
  test('「빠른 은퇴」가 없는 저장 시나리오는 국민연금 정상 개시 나이로 계산된다', () => {
    const saved: SimulationParams = {
      ...initialParams,
      userProfile: { ...initialParams.userProfile, retirementAge: 58 },
      retirementGoals: [{ type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' }],
    };

    const compiled = compileStrategy(migrateRetirementGoals(saved)).params;
    expect(compiled.userProfile.retirementAge).toBe(NATIONAL_PENSION_NORMAL_START_AGE);
  });

  test('「빠른 은퇴」를 고른 시나리오는 그 나이로 계산된다', () => {
    const saved: SimulationParams = {
      ...initialParams,
      userProfile: { ...initialParams.userProfile, retirementAge: 58 },
      retirementGoals: [
        { type: 'EARLY_RETIREMENT', priority: 1, targetValue: 62, constraintType: 'HARD' },
      ],
    };

    const compiled = compileStrategy(migrateRetirementGoals(saved)).params;
    expect(compiled.userProfile.retirementAge).toBe(62);
  });
});

describe('normalizeGoalDrivenParams — 멱등성', () => {
  test('두 번 돌려도 같은 결과이며 두 번째는 입력 참조를 그대로 돌려준다', () => {
    const once = normalize({
      ...initialParams,
      spendingStrategy: 'max_sustainable',
      retirementGoals: [
        { type: 'EARLY_RETIREMENT', priority: 1, targetValue: 61, constraintType: 'HARD' },
      ],
    });

    expect(normalize(once)).toBe(once);
  });

  // compileStrategy의 "아무것도 켜지 않은 시나리오는 입력이 비트 단위로 보존된다" 통과 경로가
  // 이 성질에 기댄다. 바꿀 것이 없는데 새 객체를 만들면 그 경로가 조용히 죽는다.
  test('이미 정규화된 값이면 입력 참조를 그대로 돌려준다', () => {
    const already: SimulationParams = {
      ...initialParams,
      userProfile: {
        ...initialParams.userProfile,
        retirementAge: NATIONAL_PENSION_NORMAL_START_AGE,
      },
    };

    expect(normalize(already)).toBe(already);
  });
});
