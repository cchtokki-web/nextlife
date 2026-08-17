import { describe, expect, test } from 'vitest';
import type { SimulationParams } from '@/core/entities/types';
import type { RankedStrategyCandidate } from '@/core/strategy/StrategyOptimizer';
import { describeStrategyChanges } from '@/core/usecases/dashboard/describeStrategyChanges';
import { applyStrategyToParams } from '@/core/usecases/dashboard/applyStrategyToParams';
import { StrategyGenerator, type StrategyCandidate } from '@/core/strategy/StrategyGenerator';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { resolveStrategy } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';
import { makeParams, makeRanked } from './strategyFieldFixtures';

// 이 함수의 출력은 화면의 추천 카드와 PDF 리포트가 **함께** 쓴다. 여기서 잠근 문구가
// 바뀌면 같은 계획의 두 문서가 서로 다른 변경 목록을 말하게 된다.
//
// 이 파일은 strategyFieldMap 테이블 추출 리팩터의 안전망이다 — 내부 구조가 바뀌어도
// 사용자가 보는 문구는 한 글자도 달라지지 않아야 한다.

const formatValue = (value: number) => `${Math.round(value / 10_000)}만원`;

describe('describeStrategyChanges', () => {
  test('여섯 축이 모두 다르면 고정된 순서로 나열한다', () => {
    const params = makeParams({
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
      yieldPreset: 'conservative',
      withdrawalPlan: { nationalPensionStartAge: 60, accountWithdrawalPolicy: 'GENERAL_FIRST' },
    });
    const ranked = makeRanked({
      retirementAge: 62,
      nationalPensionStartAge: 65,
      targetMonthlySpending: 3_500_000,
      withdrawalPolicy: 'ISA_FIRST',
      assetAllocation: 'GROWTH',
      spendingPattern: 'FRONT_LOADED',
    });

    expect(describeStrategyChanges(params, ranked, formatValue)).toEqual([
      { label: '은퇴 시점', before: '60세', after: '62세' },
      { label: '국민연금', before: '60세', after: '65세' },
      { label: '월 생활비', before: '300만원', after: '350만원' },
      { label: '자산 인출', before: '일반계좌 우선 인출', after: 'ISA 우선 인출' },
      { label: '투자 성향', before: '보수적 자산배분', after: '성장형 자산배분' },
      { label: '생활비 배분', before: '생활비를 일정하게 유지', after: '통계 기준으로 감소' },
    ]);
  });

  test('현재 값과 같은 축은 목록에 넣지 않는다', () => {
    const params = makeParams({
      userProfile: { currentAge: 50, retirementAge: 62, expectancy: 90, targetMonthlySpending: 3_500_000 },
      yieldPreset: 'base',
      withdrawalPlan: { nationalPensionStartAge: 65, accountWithdrawalPolicy: 'ISA_FIRST' },
    });
    const ranked = makeRanked({
      retirementAge: 62,
      nationalPensionStartAge: 65,
      targetMonthlySpending: 3_500_000,
      withdrawalPolicy: 'ISA_FIRST',
      assetAllocation: 'BALANCED',
      spendingPattern: 'FIXED',
    });

    expect(describeStrategyChanges(params, ranked, formatValue)).toEqual([]);
  });

  test('국민연금 개시 나이를 정한 적 없으면 65세를 현재 값으로 본다', () => {
    const params = makeParams({ withdrawalPlan: { accountWithdrawalPolicy: 'ISA_FIRST' } });
    const ranked = makeRanked({ nationalPensionStartAge: 70 });

    expect(describeStrategyChanges(params, ranked, formatValue))
      .toContainEqual({ label: '국민연금', before: '65세', after: '70세' });
  });

  test('인출 정책을 정한 적 없으면 before를 "현재 설정"으로 적는다', () => {
    const params = makeParams({ withdrawalPlan: { nationalPensionStartAge: 65 } });
    const ranked = makeRanked({ withdrawalPolicy: 'TAX_OPTIMIZED' });

    expect(describeStrategyChanges(params, ranked, formatValue))
      .toContainEqual({ label: '자산 인출', before: '현재 설정', after: '세금 최적화 순서로 인출' });
  });

  test('투자 성향 before는 프리셋 세 가지 외에는 균형으로 적는다', () => {
    const cases: [SimulationParams['yieldPreset'], string][] = [
      ['conservative', '보수적 자산배분'],
      ['aggressive', '성장형 자산배분'],
      ['custom', '균형 자산배분'],
      [undefined, '균형 자산배분'],
    ];

    for (const [preset, expected] of cases) {
      const params = makeParams({ yieldPreset: preset });
      const ranked = makeRanked({ assetAllocation: 'BALANCED' });
      expect(describeStrategyChanges(params, ranked, formatValue))
        .toContainEqual({ label: '투자 성향', before: expected, after: '균형 자산배분' });
    }
  });

  // 다른 축과 같이 현재 설정과 비교한다. 예전에는 후보 값만 보고 판정했는데, 그때는
  // 반영 경로가 없어 현재 설정이 «언제나» 곡선 없음이었기 때문이다. 이제 계획이 곡선을
  // 가질 수 있으므로 같은 배분을 쓰는 계획에 없는 변경점이 뜨면 안 된다.
  test('생활비 배분도 현재 설정과 다를 때만 나온다', () => {
    const params = makeParams();

    expect(describeStrategyChanges(params, makeRanked({ spendingPattern: 'FIXED' }), formatValue))
      .not.toContainEqual(expect.objectContaining({ label: '생활비 배분' }));

    expect(describeStrategyChanges(params, makeRanked({ spendingPattern: 'CARE_HEAVY' }), formatValue))
      .toContainEqual({
        label: '생활비 배분',
        before: '생활비를 일정하게 유지',
        after: '완만하게 감소',
      });
  });

  test('이미 그 배분을 쓰는 계획에는 생활비 배분 변경점이 없다', () => {
    const base = makeParams();
    const params = makeParams({
      strategy: { ...resolveStrategy(base), spendingShape: 'care_heavy' },
    });

    expect(describeStrategyChanges(params, makeRanked({ spendingPattern: 'CARE_HEAVY' }), formatValue))
      .not.toContainEqual(expect.objectContaining({ label: '생활비 배분' }));
  });

  test('금액 축에만 formatValue를 쓴다', () => {
    const params = makeParams({
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
    });
    const ranked = makeRanked({ retirementAge: 62, targetMonthlySpending: 4_000_000 });
    const seen: number[] = [];

    describeStrategyChanges(params, ranked, (value) => {
      seen.push(value);
      return `${value}`;
    });

    expect(seen).toEqual([3_000_000, 4_000_000]);
  });

  test('RankedStrategyCandidate 타입을 그대로 받는다', () => {
    // 계약 테스트가 describe와 apply를 같은 입력으로 묶으려면 이 시그니처가 유지돼야 한다.
    const ranked: RankedStrategyCandidate = makeRanked({});
    expect(() => describeStrategyChanges(makeParams(), ranked, formatValue)).not.toThrow();
  });
});

// **「현상 유지」 후보는 아무 변경도 말하지 않아야 한다.**
//
// baselineDimensions는 미지정 인출정책을 'GENERAL_FIRST'로 «적어 둔다» — 격자와 같은 어휘로
// 라벨을 붙이기 위한 기본값이다. 인출 축이 그 dimensions를 읽으면, 아무것도 바꾸지 않는
// 카드가 "자산 인출: 현재 설정 → 일반계좌 우선 인출"을 내걸고 반영 버튼이 그 값을 실제로
// 저장한다. SimulationEngine은 accountWithdrawalPolicy가 «미지정일 때만» 기존 정기
// 균등분할 지급 경로를 타므로, 그 저장은 카드가 보여 준 것과 다른 계획을 만든다.
//
// 픽스처가 아니라 실제 StrategyGenerator 출력을 쓴다 — 손으로 만든 후보는 dimensions와
// strategy를 늘 일치시켜서, 정확히 이 어긋남을 재현하지 못한다.
describe('현상 유지 후보', () => {
  const rankedFrom = (candidate: StrategyCandidate): RankedStrategyCandidate =>
    ({ ...makeRanked(), candidate } as RankedStrategyCandidate);

  test('인출정책을 지정한 적 없는 사용자에게 인출 변경을 내걸지 않는다', () => {
    const legacy = structuredClone(initialParams);
    delete legacy.withdrawalPlan;
    const input = LegacySimulationAdapter.fromLegacy(legacy);
    const result = new StrategyGenerator().generate(input.profile, input.goals, input.strategy);
    const baseline = result.candidates.find((item) => item.id === result.debug.baselineCandidateId)!;

    // 전제 확인: dimensions에는 라벨용 기본값이 적혀 있고, 시뮬레이션된 전략에는 없다.
    expect(baseline.dimensions.withdrawalPolicy).toBe('GENERAL_FIRST');
    expect(baseline.strategy.withdrawalPolicy.accountWithdrawalPolicy).toBeUndefined();

    const changes = describeStrategyChanges(makeParams({ withdrawalPlan: undefined }), rankedFrom(baseline), formatValue);

    expect(changes.map((change) => change.label)).not.toContain('자산 인출');
  });

  test('반영해도 시뮬레이션하지 않은 인출정책을 저장하지 않는다', () => {
    const legacy = structuredClone(initialParams);
    delete legacy.withdrawalPlan;
    const input = LegacySimulationAdapter.fromLegacy(legacy);
    const result = new StrategyGenerator().generate(input.profile, input.goals, input.strategy);
    const baseline = result.candidates.find((item) => item.id === result.debug.baselineCandidateId)!;

    const params = makeParams({ withdrawalPlan: undefined });
    const applied = applyStrategyToParams(params, rankedFrom(baseline));

    expect(applied.params.withdrawalPlan?.accountWithdrawalPolicy).toBeUndefined();
  });
});
