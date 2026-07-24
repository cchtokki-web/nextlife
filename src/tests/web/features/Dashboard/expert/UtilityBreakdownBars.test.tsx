import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UtilityBreakdownBars } from '@/web/features/Dashboard/expert/UtilityBreakdownBars';
import { UtilityBreakdown } from '@/core/entities/types';

const utility: UtilityBreakdown = {
  score: 76,
  components: { consumption: 27, depletionSafety: 20, pensionUtilization: 13, taxEfficiency: 8, taxationRisk: 8, bequestAdequacy: 0 },
};

describe('UtilityBreakdownBars', () => {
  test('6개 구성요소의 라벨과 점수/만점을 모두 렌더링한다', () => {
    render(<UtilityBreakdownBars utility={utility} />);

    expect(screen.getByText('소비 만족도')).toBeInTheDocument();
    expect(screen.getByText('27/35')).toBeInTheDocument();
    expect(screen.getByText('자산 고갈 방지')).toBeInTheDocument();
    expect(screen.getByText('20/20')).toBeInTheDocument();
    expect(screen.getByText('상속 자산 적정성')).toBeInTheDocument();
    expect(screen.getByText('0/10')).toBeInTheDocument();
  });
});
