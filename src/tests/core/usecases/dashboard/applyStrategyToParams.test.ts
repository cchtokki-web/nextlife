import { describe, expect, test } from 'vitest';
import { applyStrategyToParams, previewStrategyApply } from '@/core/usecases/dashboard/applyStrategyToParams';
import { describeStrategyChanges } from '@/core/usecases/dashboard/describeStrategyChanges';
import { compileStrategy, resolveStrategy } from '@/core/usecases/strategy/compileStrategy';
import { makeParams, makeRanked } from './strategyFieldFixtures';

const labelsOf = (items: readonly { label: string }[]) => items.map((item) => item.label);

describe('applyStrategyToParams — 생활비 배분', () => {
  // 이 축은 오래 「반영할 수 없음」으로 남아 있었고, 그래서 카드가 곡선을 켜고 계산한
  // 확률을 보여 준 뒤 적용하면 곡선 없는 계획이 저장됐다. 두 숫자가 어긋나던 원인이다.
  test('후보의 생활비 배분이 계획의 소비 성향으로 반영된다', () => {
    const params = makeParams();
    const ranked = makeRanked({ spendingPattern: 'CARE_HEAVY' });

    const result = applyStrategyToParams(params, ranked);

    expect(result.skipped).toEqual([]);
    expect(labelsOf(result.applied)).toContain('생활비 배분');
    expect(resolveStrategy(result.params).spendingShape).toBe('care_heavy');
  });

  // 반영된 값이 컴파일까지 살아남아야 실제 계산이 달라진다. 저수준 곡선만 보고 판단하면
  // compileStrategy가 전략에서 곡선을 다시 만들며 덮어쓴다.
  test('반영한 소비 성향이 컴파일된 곡선까지 이어진다', () => {
    const result = applyStrategyToParams(makeParams(), makeRanked({ spendingPattern: 'CARE_HEAVY' }));

    const curve = compileStrategy(result.params).params.spendingCurve!;
    expect(curve.multipliers[0]).toBeGreaterThan(curve.multipliers[curve.multipliers.length - 1]);
  });

  // 현재 계획이 이미 그 배분이면 바꿀 것이 없다. 예전에는 후보 값만 보고 판정해서,
  // 이미 같은 값을 쓰는 계획에도 「연령대별 동일 기준 → …」이라는 변경점이 떴다.
  test('현재 계획이 이미 같은 배분이면 변경점으로 세지 않는다', () => {
    const params = makeParams({
      strategy: { ...resolveStrategy(makeParams()), spendingShape: 'care_heavy' },
    });

    const result = applyStrategyToParams(params, makeRanked({ spendingPattern: 'CARE_HEAVY' }));

    expect(labelsOf(result.applied)).not.toContain('생활비 배분');
    expect(result.skipped).toEqual([]);
  });
});

// 버튼 활성화는 «카드가 말한 것»과 «실제로 반영되는 것»의 교집합으로 정한다.
//
// 두 기준이 서로 다른 params를 본다는 사실이 이 함수가 있는 이유다: 카드는 센티널이 채운
// effective.params를, 적용은 사용자가 입력한 activeParams를 본다.
describe('previewStrategyApply', () => {
  const formatValue = (value: number) => `${Math.round(value / 10_000)}만원`;

  // 사용자가 국민연금 개시 나이를 정한 적이 없는 계획.
  const target = makeParams({ withdrawalPlan: { accountWithdrawalPolicy: 'ISA_FIRST' } });
  // applyAiSentinels가 66세를 채워 엔진에 들어간 값. 카드는 이것을 「현재 계획」으로 서술한다.
  const simulated = makeParams({
    withdrawalPlan: { nationalPensionStartAge: 66, accountWithdrawalPolicy: 'ISA_FIRST' },
  });

  /**
   * 회귀: 「핵심 설정은 유지하고 시장 변동 안정성만 재검증한 전략입니다」라고 적힌 균형형
   * 카드에 적용 버튼이 살아 있었다.
   *
   * 후보의 개시 나이(66세)는 센티널이 채운 계산 기준과 같아 카드에 변경점이 뜨지 않는데,
   * 사용자 설정에는 그 값이 없어(=기본 65세) 적용 대상으로는 잡혔다. 눌렀다면 카드가 말한
   * 적 없는 국민연금 축이 'defer_1y'로 설정에 확정됐을 것이다.
   */
  test('센티널이 채운 축만 반영되는 후보는 적용할 수 없다', () => {
    const ranked = makeRanked({ retirementAge: 60, nationalPensionStartAge: 66 });

    // 카드가 「달라지는 점」을 하나도 보여 주지 않는 상태라는 것을 먼저 고정한다.
    expect(describeStrategyChanges(simulated, ranked, formatValue)).toEqual([]);
    expect(labelsOf(applyStrategyToParams(target, ranked, simulated).applied)).toEqual(['국민연금']);

    expect(previewStrategyApply(target, simulated, ranked).canApply).toBe(false);
  });

  test('카드가 말한 축이 실제로 반영되면 적용할 수 있다', () => {
    const ranked = makeRanked({ retirementAge: 63, nationalPensionStartAge: 66 });

    expect(labelsOf(describeStrategyChanges(simulated, ranked, formatValue))).toEqual(['은퇴 시점']);
    expect(previewStrategyApply(target, simulated, ranked).canApply).toBe(true);
  });

  // 집합의 «크기»만 비교하면(변경점도 있고 반영할 것도 있으니 참) 통과하는 조합이다.
  // 카드는 은퇴 시점을 말했는데 실제로 반영되는 것은 국민연금 하나뿐이다.
  test('카드가 말한 축과 반영되는 축이 서로 다르면 적용할 수 없다', () => {
    const noGoals = { retirementGoals: [] };
    const ranked = makeRanked({ retirementAge: 63, nationalPensionStartAge: 66 });

    const targetWithoutGoals = makeParams({ ...target, ...noGoals });
    const simulatedWithoutGoals = makeParams({ ...simulated, ...noGoals });

    expect(labelsOf(describeStrategyChanges(simulatedWithoutGoals, ranked, formatValue)))
      .toEqual(['은퇴 시점']);
    const outcome = applyStrategyToParams(targetWithoutGoals, ranked, simulatedWithoutGoals);
    expect(labelsOf(outcome.applied)).toEqual(['국민연금']);
    expect(labelsOf(outcome.skipped)).toEqual(['은퇴 시점']);

    expect(previewStrategyApply(targetWithoutGoals, simulatedWithoutGoals, ranked).canApply).toBe(false);
  });

  test('반영할 축이 하나도 없으면 적용할 수 없다', () => {
    const ranked = makeRanked({ retirementAge: 60, nationalPensionStartAge: 65 });

    expect(previewStrategyApply(target, target, ranked).canApply).toBe(false);
  });

  /**
   * 회귀: 카드는 「국민연금 66세 → 65세」라는 변경점을 또렷이 보여 주는데 버튼이
   * 「반영할 수 있는 설정이 없습니다」로 잠겨 있었다.
   *
   * 후보가 원하는 65세가 사용자 설정의 «기본값»과 같아서, 사용자 설정만 보던 판정이 「바꿀
   * 것 없음」으로 읽었다. 실제로 필요한 일은 65세를 확정해 센티널이 66세로 올리지 못하게
   * 하는 것이고, 그 계획은 화면에서 만들 방법이 아예 없었다.
   */
  test('카드가 말한 축이 사용자 설정의 기본값과 같아도 적용할 수 있다', () => {
    const ranked = makeRanked({ retirementAge: 60, nationalPensionStartAge: 65 });

    expect(labelsOf(describeStrategyChanges(simulated, ranked, formatValue))).toEqual(['국민연금']);
    expect(previewStrategyApply(target, simulated, ranked).canApply).toBe(true);
  });
});

// 카드가 「현재 계획」이라 부르는 기준(센티널 적용 후)과 값을 써 넣을 사용자 설정이 서로
// 다를 때, 반영 대상은 두 기준의 «합집합»이다.
describe('applyStrategyToParams — 서술 기준이 사용자 설정과 어긋날 때', () => {
  // 사용자가 국민연금 개시 나이를 정한 적 없는 계획(=기본 65세)과, 센티널이 66세를 채워
  // 엔진에 들어간 계산 기준.
  const target = makeParams({ withdrawalPlan: { accountWithdrawalPolicy: 'ISA_FIRST' } });
  const simulated = makeParams({
    withdrawalPlan: { nationalPensionStartAge: 66, accountWithdrawalPolicy: 'ISA_FIRST' },
  });

  // 서술 기준 쪽에서만 다른 축. 반영하지 않으면 카드가 약속한 계획이 만들어지지 않는다.
  test('사용자 설정에서는 같아 보여도 카드가 말한 축이면 반영한다', () => {
    const ranked = makeRanked({ retirementAge: 60, nationalPensionStartAge: 65 });

    const result = applyStrategyToParams(target, ranked, simulated);

    expect(labelsOf(result.applied)).toEqual(['국민연금']);
    // 'normal'로 «확정»해야 재분석에서 센티널이 다시 66세를 채우지 못한다.
    expect(result.params.strategy?.nationalPensionStrategy).toBe('normal');
    expect(compileStrategy(result.params).params.withdrawalPlan?.nationalPensionStartAge).toBe(65);
  });

  /**
   * 사용자 설정 쪽에서만 다른 축(카드는 말하지 않은 축). 이것을 반영에서 빼면 안 된다 —
   * 다른 축을 반영하며 strategy 객체가 실체화될 때 withStrategy가 사용자 설정의 65세로
   * 이 축을 고정해, 카드가 시뮬레이션한 66세 계획이 65세 계획으로 바뀐다.
   */
  test('카드가 말하지 않았어도 사용자 설정과 다르면 반영해 계획을 재현한다', () => {
    const ranked = makeRanked({
      retirementAge: 60, nationalPensionStartAge: 66, spendingPattern: 'FRONT_LOADED',
    });

    const result = applyStrategyToParams(target, ranked, simulated);

    expect(labelsOf(result.applied)).toEqual(['국민연금', '생활비 배분']);
    expect(compileStrategy(result.params).params.withdrawalPlan?.nationalPensionStartAge).toBe(66);
  });

  test('서술 기준을 생략하면 사용자 설정 하나만 본다', () => {
    const ranked = makeRanked({ retirementAge: 60, nationalPensionStartAge: 65 });

    expect(applyStrategyToParams(target, ranked).applied).toEqual([]);
    expect(applyStrategyToParams(target, ranked).params).toBe(target);
  });

  // 실제 흐름은 「적용 → 재분석 → 새 서술 기준」이다. 그 경로에서 두 번째 적용이 무동작이
  // 되지 않으면 사용자가 같은 버튼을 눌러 설정이 계속 새 객체로 갈린다.
  test('적용 후 재컴파일한 기준으로 다시 적용하면 바뀔 것이 없다', () => {
    const ranked = makeRanked({ retirementAge: 60, nationalPensionStartAge: 65 });

    const once = applyStrategyToParams(target, ranked, simulated);
    const twice = applyStrategyToParams(once.params, ranked, compileStrategy(once.params).params);

    expect(twice.applied).toEqual([]);
    expect(twice.params).toBe(once.params);
  });
});

describe('applyStrategyToParams', () => {
  test('다섯 축을 모두 적용한다', () => {
    const params = makeParams({
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
      yieldPreset: 'conservative',
      withdrawalPlan: { nationalPensionStartAge: 60, accountWithdrawalPolicy: 'GENERAL_FIRST' },
    });
    const ranked = makeRanked({
      retirementAge: 62,
      nationalPensionStartAge: 70,
      targetMonthlySpending: 3_500_000,
      withdrawalPolicy: 'ISA_FIRST',
      spendingPattern: 'FRONT_LOADED',
    });

    const result = applyStrategyToParams(params, ranked);

    expect(labelsOf(result.applied)).toEqual([
      '은퇴 시점', '국민연금', '월 생활비', '자산 인출', '생활비 배분',
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.params.userProfile.retirementAge).toBe(62);
    expect(result.params.userProfile.targetMonthlySpending).toBe(3_500_000);
    expect(result.params.withdrawalPlan?.nationalPensionStartAge).toBe(70);
    expect(result.params.withdrawalPlan?.accountWithdrawalPolicy).toBe('ISA_FIRST');
    // 수익률 가정은 어느 축도 건드리지 않는다 — 사용자가 고른 그대로 남는다.
    expect(result.params.yieldPreset).toBe('conservative');
  });

  // 이 테스트가 이 기능의 핵심이다. compileStrategy는 분석할 때마다 params.strategy에서
  // 국민연금 개시 나이를 다시 계산해 저수준 필드를 덮어쓴다. 저수준 필드만 써 넣으면
  // 적용 버튼을 눌러도 재분석 결과가 그대로다 — 사용자에게는 버튼이 고장 난 것으로 보인다.
  // (수익률 가정은 이제 반영 축이 아니다 — 추천은 인출 계획만 바꾼다.)
  test('compileStrategy를 통과한 뒤에도 추천값이 살아남는다', () => {
    const params = makeParams({
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
      yieldPreset: 'conservative',
      withdrawalPlan: { nationalPensionStartAge: 60, accountWithdrawalPolicy: 'GENERAL_FIRST' },
      strategy: { ...resolveStrategy(makeParams()), nationalPensionStrategy: 'early', riskProfile: 'ai_recommended' },
    });
    const ranked = makeRanked({
      retirementAge: 62,
      nationalPensionStartAge: 70,
      targetMonthlySpending: 3_500_000,
      withdrawalPolicy: 'TAX_OPTIMIZED',
    });

    const compiled = compileStrategy(applyStrategyToParams(params, ranked).params).params;

    expect(compiled.userProfile.retirementAge).toBe(62);
    expect(compiled.userProfile.targetMonthlySpending).toBe(3_500_000);
    expect(compiled.withdrawalPlan?.nationalPensionStartAge).toBe(70);
    expect(compiled.withdrawalPlan?.accountWithdrawalPolicy).toBe('TAX_OPTIMIZED');
    expect(compiled.yieldPreset).toBe('conservative');
  });

  test('국민연금 개시 나이를 수령 전략 enum으로 정확히 옮긴다', () => {
    const cases: [number, string][] = [[60, 'early'], [65, 'normal'], [70, 'defer_max']];

    for (const [age, expected] of cases) {
      const params = makeParams({ withdrawalPlan: { nationalPensionStartAge: 63 } });
      const result = applyStrategyToParams(params, makeRanked({ nationalPensionStartAge: age }));

      expect(result.params.strategy?.nationalPensionStrategy).toBe(expected);
      expect(result.params.withdrawalPlan?.nationalPensionStartAge).toBe(age);
    }
  });

  // **추천 반영은 사용자가 입력한 수익률 가정을 건드리지 않는다.** 예전에는 「투자 성향」
  // 축이 yieldPreset을 갈아끼웠고, 그것이 「성장형으로 바꾸세요」라는 조언의 실체였다 —
  // 조언이 아니라 가정 변경이었다. 그 축을 없앤 뒤로 반영은 인출 계획만 바꾼다.
  // (strategy 자체는 다른 축 때문에 여전히 실체화될 수 있다 — nationalPensionStrategy를
  // 「현재 값」에 고정하는 부수효과다. 그래서 원본이 아니라 resolveStrategy와 비교한다.)
  test('추천을 반영해도 수익률 가정과 리스크 성향은 그대로 둔다', () => {
    const params = makeParams({ yieldPreset: 'base' });
    const ranked = makeRanked({ retirementAge: 60, spendingPattern: 'FRONT_LOADED' });
    const result = applyStrategyToParams(params, ranked);

    expect(labelsOf(result.applied)).toEqual(['생활비 배분']);
    expect(result.params.yieldPreset).toBe('base');
    expect(result.params.strategy?.riskProfile).toBe(resolveStrategy(params).riskProfile);
  });

  test('최대 지속가능 생활비 시나리오는 목표액 모드로 내린다', () => {
    const base = makeParams({
      userProfile: { currentAge: 50, retirementAge: 62, expectancy: 90, targetMonthlySpending: 3_000_000 },
    });
    const params = makeParams({
      ...base,
      strategy: { ...resolveStrategy(base), spendingChoice: 'max_sustainable' },
    });

    const result = applyStrategyToParams(params, makeRanked({ targetMonthlySpending: 4_000_000 }));

    expect(result.params.userProfile.targetMonthlySpending).toBe(4_000_000);
    // 모드를 내리지 않으면 엔진이 역산값을 쓰므로 방금 써 넣은 금액이 계산에 반영되지 않는다.
    expect(result.params.strategy?.spendingChoice).toBe('target');
  });

  test('생활비 모드가 이미 목표액이면 전략 객체를 건드리지 않는다', () => {
    const params = makeParams();
    const result = applyStrategyToParams(params, makeRanked({ targetMonthlySpending: 4_000_000 }));

    expect(result.params.strategy).toBeUndefined();
  });

  // 은퇴 나이·목표 생활비는 「은퇴 목표」 카드가 유일한 편집 경로다. userProfile만 덮어쓰면
  // 다음 정규화가 목표에서 그 값을 다시 파생시켜 방금 적용한 값이 조용히 사라진다.
  test('은퇴 시점·월 생활비는 대응하는 목표의 목표값까지 함께 갱신한다', () => {
    const params = makeParams({
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
    });

    const result = applyStrategyToParams(params, makeRanked({
      retirementAge: 62,
      targetMonthlySpending: 3_500_000,
    }));

    const goals = result.params.retirementGoals ?? [];
    expect(goals.find((goal) => goal.type === 'EARLY_RETIREMENT')?.targetValue).toBe(62);
    expect(goals.find((goal) => goal.type === 'LIVING_EXPENSE_STABILITY')?.targetValue).toBe(3_500_000);
    expect(result.params.userProfile.retirementAge).toBe(62);
    expect(result.params.userProfile.targetMonthlySpending).toBe(3_500_000);
  });

  // 사용자가 고르지 않은 목표를 앱이 대신 만들지는 않는다(최대 5개 제한과 우선순위를
  // 앱이 대신 결정하게 된다). 대신 왜 반영하지 못했는지를 남긴다.
  test('대응하는 목표가 없으면 반영하지 않고 사유를 남긴다', () => {
    const params = makeParams({
      retirementGoals: [{ type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' }],
    });

    const result = applyStrategyToParams(params, makeRanked({
      retirementAge: 62,
      targetMonthlySpending: 4_000_000,
    }));

    expect(labelsOf(result.skipped)).toEqual(expect.arrayContaining(['은퇴 시점', '월 생활비']));
    expect(result.skipped.find((item) => item.key === 'retirementAge')?.reason)
      .toMatch(/빠른 은퇴/);
    expect(result.params.userProfile.retirementAge).toBe(params.userProfile.retirementAge);
  });

  test('인출 정책을 바꾸면 짝이 맞지 않는 사용자 지정 순서를 지운다', () => {
    const params = makeParams({
      withdrawalPlan: {
        nationalPensionStartAge: 65,
        accountWithdrawalPolicy: 'CUSTOM',
        customWithdrawalOrder: ['isa', 'general'],
      },
    });

    const result = applyStrategyToParams(params, makeRanked({ withdrawalPolicy: 'PENSION_FIRST' }));

    expect(result.params.withdrawalPlan?.accountWithdrawalPolicy).toBe('PENSION_FIRST');
    expect(result.params.withdrawalPlan?.customWithdrawalOrder).toBeUndefined();
  });

  test('바꿀 것이 없으면 입력과 같은 참조를 돌려준다', () => {
    const params = makeParams({
      userProfile: { currentAge: 50, retirementAge: 62, expectancy: 90, targetMonthlySpending: 3_500_000 },
      yieldPreset: 'base',
      withdrawalPlan: { nationalPensionStartAge: 65, accountWithdrawalPolicy: 'ISA_FIRST' },
    });

    const result = applyStrategyToParams(params, makeRanked({}));

    // page.tsx가 "이미 반영된 상태"를 참조 비교로 판정한다.
    expect(result.params).toBe(params);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  test('입력 params를 변형하지 않는다', () => {
    const params = Object.freeze(makeParams({
      userProfile: Object.freeze({
        currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000,
      }),
      withdrawalPlan: Object.freeze({
        nationalPensionStartAge: 60, accountWithdrawalPolicy: 'GENERAL_FIRST' as const,
      }),
    }));

    expect(() => applyStrategyToParams(params, makeRanked({
      retirementAge: 65, nationalPensionStartAge: 70, withdrawalPolicy: 'ISA_FIRST',
    }))).not.toThrow();
    expect(params.userProfile.retirementAge).toBe(60);
    expect(params.withdrawalPlan?.nationalPensionStartAge).toBe(60);
  });

  test('전략 객체가 없는 옛 시나리오에도 적용된다', () => {
    const params = makeParams({ strategy: undefined, withdrawalPlan: undefined });
    const result = applyStrategyToParams(params, makeRanked({
      nationalPensionStartAge: 70, withdrawalPolicy: 'GENERAL_FIRST',
    }));

    expect(result.params.withdrawalPlan?.nationalPensionStartAge).toBe(70);
    expect(result.params.withdrawalPlan?.accountWithdrawalPolicy).toBe('GENERAL_FIRST');
    expect(result.params.strategy?.nationalPensionStrategy).toBe('defer_max');
  });

  // 회귀: resolveStrategy는 withdrawalPlan.nationalPensionStartAge에서 수령 전략을 유도하지
  // 않는다. 다른 축을 적용하느라 전략 객체를 처음 실체화하면 이 축이 기본값 'ai_optimized'
  // (=65세)로 채워져, 카드가 말하지 않은 국민연금 변경이 함께 일어났다.
  test('반영 대상이 아닌 국민연금 축을 조용히 옮기지 않는다', () => {
    const params = makeParams({
      yieldPreset: 'base',
      withdrawalPlan: { nationalPensionStartAge: 60, accountWithdrawalPolicy: 'ISA_FIRST' },
    });
    // 국민연금 축은 현재 값과 같아 반영 대상이 아니고, 생활비 배분만 달라진 후보다.
    const ranked = makeRanked({
      retirementAge: 60, nationalPensionStartAge: 60, spendingPattern: 'FRONT_LOADED',
    });

    const result = applyStrategyToParams(params, ranked);

    expect(labelsOf(result.applied)).toEqual(['생활비 배분']);
    expect(compileStrategy(result.params).params.withdrawalPlan?.nationalPensionStartAge).toBe(60);
  });

  test('반영할 수 없는 축은 조용히 넘기지 않는다', () => {
    const ranked = makeRanked({ withdrawalPolicy: 'ISA_FIRST' });
    // 「현상 유지」 후보는 인출 정책을 지정하지 않는다. 여기서 기본값을 채워 넣으면 카드가
    // 보여 준 것과 다른 계획이 저장되므로, 반영하지 못했다고 밝힌다.
    delete ranked.candidate.strategy.withdrawalPolicy.accountWithdrawalPolicy;

    const result = applyStrategyToParams(makeParams(), ranked);

    expect(labelsOf(result.applied)).not.toContain('자산 인출');
    expect(result.skipped).toContainEqual({
      key: 'withdrawalPolicy',
      label: '자산 인출',
      reason: '현재 인출 정책을 그대로 두는 후보입니다',
    });
  });
});
