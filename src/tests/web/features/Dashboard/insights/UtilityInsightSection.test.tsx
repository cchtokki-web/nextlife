import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UtilityInsightSection } from '@/web/features/Dashboard/insights/UtilityInsightSection';
import { UtilityBreakdown } from '@/core/entities/types';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';

const utility: UtilityBreakdown = {
  score: 76,
  components: { consumption: 27, depletionSafety: 20, pensionUtilization: 13, taxEfficiency: 8, taxationRisk: 8, bequestAdequacy: 0 },
};

describe('UtilityInsightSection', () => {
  test('Collapse 없이 평생 효용 점수 구성과 현재 전략 강점/약점을 바로 보여준다', () => {
    render(<UtilityInsightSection utility={utility} utilityConfig={DEFAULT_UTILITY_CONFIG} bequestAdequacyExplanation="예상 잔여자산이 목표보다 많아 감점되었습니다." />);

    expect(screen.getByText('평생 효용 점수 구성')).toBeInTheDocument();
    expect(screen.getByText('소비 만족도')).toBeInTheDocument();
    expect(screen.getByText(/예상 잔여자산이 목표보다 많아 감점되었습니다\./)).toBeInTheDocument();
    expect(screen.getByText('장점')).toBeInTheDocument();
    expect(screen.getByText('단점')).toBeInTheDocument();
  });

  test('bequestAdequacyExplanation이 없으면 해당 문구를 렌더링하지 않는다', () => {
    render(<UtilityInsightSection utility={utility} utilityConfig={DEFAULT_UTILITY_CONFIG} />);
    expect(screen.queryByText(/상속 자산 적정성:/)).not.toBeInTheDocument();
  });
});
