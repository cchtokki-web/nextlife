import { describe, expect, test } from 'vitest';
import { applyStrategyToParams } from '@/core/usecases/dashboard/applyStrategyToParams';
import { compileStrategy, resolveStrategy } from '@/core/usecases/strategy/compileStrategy';
import { makeParams, makeRanked } from './strategyFieldFixtures';

const labelsOf = (items: readonly { label: string }[]) => items.map((item) => item.label);

describe('applyStrategyToParams', () => {
  test('여섯 축 중 반영 가능한 다섯 축을 적용하고 나머지 하나는 사유와 함께 남긴다', () => {
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
      assetAllocation: 'GROWTH',
      spendingPattern: 'FRONT_LOADED',
    });

    const result = applyStrategyToParams(params, ranked);

    expect(labelsOf(result.applied)).toEqual([
      '은퇴 시점', '국민연금', '월 생활비', '자산 인출', '투자 성향',
    ]);
    expect(result.skipped).toEqual([
      {
        key: 'spendingPattern',
        label: '생활비 배분',
        reason: '목표액 기준 계획에는 연령대별 생활비 곡선을 적용할 수 없습니다',
      },
    ]);
    expect(result.params.userProfile.retirementAge).toBe(62);
    expect(result.params.userProfile.targetMonthlySpending).toBe(3_500_000);
    expect(result.params.withdrawalPlan?.nationalPensionStartAge).toBe(70);
    expect(result.params.withdrawalPlan?.accountWithdrawalPolicy).toBe('ISA_FIRST');
    expect(result.params.yieldPreset).toBe('aggressive');
  });

  // 이 테스트가 이 기능의 핵심이다. compileStrategy는 분석할 때마다 params.strategy에서
  // 국민연금 개시 나이와 수익률 프리셋을 다시 계산해 저수준 필드를 덮어쓴다. 저수준 필드만
  // 써 넣으면 적용 버튼을 눌러도 재분석 결과가 그대로다 — 사용자에게는 버튼이 고장 난 것으로 보인다.
  test('compileStrategy를 통과한 뒤에도 추천값이 살아남는다', () => {
    const params = makeParams({
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
      yieldPreset: 'conservative',
      withdrawalPlan: { nationalPensionStartAge: 60, accountWithdrawalPolicy: 'GENERAL_FIRST' },
      strategy: { ...resolveStrategy(makeParams()), nationalPensionStrategy: 'early', riskProfile: 'conservative' },
    });
    const ranked = makeRanked({
      retirementAge: 62,
      nationalPensionStartAge: 70,
      targetMonthlySpending: 3_500_000,
      withdrawalPolicy: 'TAX_OPTIMIZED',
      assetAllocation: 'GROWTH',
    });

    const compiled = compileStrategy(applyStrategyToParams(params, ranked).params).params;

    expect(compiled.userProfile.retirementAge).toBe(62);
    expect(compiled.userProfile.targetMonthlySpending).toBe(3_500_000);
    expect(compiled.withdrawalPlan?.nationalPensionStartAge).toBe(70);
    expect(compiled.withdrawalPlan?.accountWithdrawalPolicy).toBe('TAX_OPTIMIZED');
    expect(compiled.yieldPreset).toBe('aggressive');
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

  test('수익률 프리셋과 리스크 성향을 함께 기록한다', () => {
    const params = makeParams({ yieldPreset: 'base' });
    const result = applyStrategyToParams(params, makeRanked({ assetAllocation: 'CONSERVATIVE' }));

    expect(result.params.yieldPreset).toBe('conservative');
    // 리스크 성향을 함께 쓰지 않으면 compileStrategy가 프리셋을 옛 성향으로 되돌린다.
    expect(result.params.strategy?.riskProfile).toBe('conservative');
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
    // 국민연금 축은 현재 값과 같아 반영 대상이 아니고, 투자 성향만 달라진 후보다.
    const ranked = makeRanked({
      retirementAge: 60, nationalPensionStartAge: 60, assetAllocation: 'GROWTH',
    });

    const result = applyStrategyToParams(params, ranked);

    expect(labelsOf(result.applied)).toEqual(['투자 성향']);
    expect(compileStrategy(result.params).params.withdrawalPlan?.nationalPensionStartAge).toBe(60);
  });

  test('반영할 수 없는 축은 조용히 넘기지 않는다', () => {
    const ranked = makeRanked({ assetAllocation: 'GROWTH' });
    // 시장성 자산이 없는 시나리오에서는 후보가 프리셋 없이 만들어진다.
    delete ranked.candidate.strategy.legacySettings.yieldPreset;

    const result = applyStrategyToParams(makeParams({ yieldPreset: 'base' }), ranked);

    expect(labelsOf(result.applied)).not.toContain('투자 성향');
    expect(result.skipped).toContainEqual({
      key: 'assetAllocation',
      label: '투자 성향',
      reason: '후보가 수익률 프리셋을 지정하지 않았습니다',
    });
  });
});
