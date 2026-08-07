import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UtilityBreakdownBars } from '@/web/features/Dashboard/expert/UtilityBreakdownBars';
import { UtilityBreakdown } from '@/core/entities/types';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { OBJECTIVE_WEIGHT_PRESETS } from '@/core/usecases/strategy/objectivePresets';

const utility: UtilityBreakdown = {
  score: 76,
  components: { consumption: 27, depletionSafety: 20, pensionUtilization: 13, taxEfficiency: 8, taxationRisk: 8, bequestAdequacy: 0 },
};

describe('UtilityBreakdownBars', () => {
  test('6개 구성요소의 라벨과 점수/만점을 모두 렌더링한다', () => {
    render(<UtilityBreakdownBars utility={utility} weights={DEFAULT_UTILITY_CONFIG.weights} />);

    expect(screen.getByText('소비 만족도')).toBeInTheDocument();
    expect(screen.getByText('27/35')).toBeInTheDocument();
    expect(screen.getByText('자산 고갈 방지')).toBeInTheDocument();
    expect(screen.getByText('20/20')).toBeInTheDocument();
    expect(screen.getByText('상속 자산 적정성')).toBeInTheDocument();
    expect(screen.getByText('0/10')).toBeInTheDocument();
  });

  // 목표 우선순위를 바꾸면 컴포넌트별 배점 자체가 바뀐다(OBJECTIVE_WEIGHT_PRESETS).
  // 예전에는 화면 메타가 기본 배점을 모듈 로드 시점에 고정해, '세금 최소화'를 고른 사용자
  // 화면에 "세금 효율 21/10", "과세 위험 관리 15/10"처럼 만점을 넘긴 분수가 찍히고
  // 막대는 100%에서 잘렸다.
  test('목표 우선순위가 바꾼 배점을 분모로 쓴다', () => {
    const taxMinUtility: UtilityBreakdown = {
      score: 55,
      components: { consumption: 6, depletionSafety: 0, pensionUtilization: 8, taxEfficiency: 21, taxationRisk: 15, bequestAdequacy: 5 },
    };

    render(<UtilityBreakdownBars utility={taxMinUtility} weights={OBJECTIVE_WEIGHT_PRESETS.tax_minimization} />);

    expect(screen.getByText('21/25')).toBeInTheDocument(); // 세금 효율
    expect(screen.getByText('15/15')).toBeInTheDocument(); // 과세 위험 관리
    expect(screen.getByText('6/25')).toBeInTheDocument(); // 소비 만족도
    expect(screen.queryByText('21/10')).not.toBeInTheDocument();
  });
});
