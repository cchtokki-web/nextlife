import { describe, expect, test } from 'vitest';
import type { SimulationParams } from '@/core/entities/types';
import type { RankedStrategyCandidate } from '@/core/strategy/StrategyOptimizer';
import { describeStrategyChanges } from '@/core/usecases/dashboard/describeStrategyChanges';
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
      { label: '생활비 배분', before: '연령대별 동일 기준', after: '은퇴 초기에 생활비를 더 사용' },
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

  // 이 축만 현재 params를 보지 않고 후보의 값만 본다. 의도된 현행 동작이므로 잠근다 —
  // 바꾸면 PDF 리포트 문구까지 함께 움직인다.
  test('생활비 배분은 FIXED가 아닐 때만, 현재 설정과 무관하게 나온다', () => {
    const params = makeParams();

    expect(describeStrategyChanges(params, makeRanked({ spendingPattern: 'FIXED' }), formatValue))
      .not.toContainEqual(expect.objectContaining({ label: '생활비 배분' }));

    expect(describeStrategyChanges(params, makeRanked({ spendingPattern: 'CARE_HEAVY' }), formatValue))
      .toContainEqual({
        label: '생활비 배분',
        before: '연령대별 동일 기준',
        after: '후기 의료·돌봄 지출에 대비',
      });
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
