import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CurrentStrategyAnalysis } from '@/web/features/Dashboard/expert/CurrentStrategyAnalysis';
import { UtilityBreakdown } from '@/core/entities/types';

// depletionSafety 20/20(비율 1.0, 강점) / bequestAdequacy 0/10(비율 0, 약점)이 되도록 구성
const utility: UtilityBreakdown = {
  score: 76,
  components: { consumption: 27, depletionSafety: 20, pensionUtilization: 13, taxEfficiency: 8, taxationRisk: 8, bequestAdequacy: 0 },
};

describe('CurrentStrategyAnalysis', () => {
  test('강점/약점 제목과 analyzeCurrentStrategy 결과 문구를 렌더링한다', () => {
    render(<CurrentStrategyAnalysis utility={utility} />);

    expect(screen.getByText('장점')).toBeInTheDocument();
    expect(screen.getByText('단점')).toBeInTheDocument();
    expect(screen.getByText(/자산 고갈 방지.*우수/)).toBeInTheDocument();
    expect(screen.getByText(/상속 자산 적정성/)).toBeInTheDocument();
  });
});
