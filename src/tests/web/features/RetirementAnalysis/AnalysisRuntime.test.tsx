import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { AnalysisBoundary } from '@/web/features/RetirementAnalysis/AnalysisRuntime';

const pipelineSpy = vi.hoisted(() => vi.fn());
const monteCarloSpy = vi.hoisted(() => vi.fn());

vi.mock('@/web/hooks/useStrategyPipeline', () => ({
  useStrategyPipeline: pipelineSpy,
}));

vi.mock('@/web/hooks/useMonteCarlo', () => ({
  useMonteCarlo: monteCarloSpy,
}));

describe('AnalysisBoundary', () => {
  test('분석 요청 전에는 계산 훅을 마운트하지 않는다', () => {
    render(
      <AnalysisBoundary request={null} engine={new LegacySimulationEngine()}>
        {(analysis) => <div>{analysis ? '분석됨' : '입력 중'}</div>}
      </AnalysisBoundary>
    );

    expect(screen.getByText('입력 중')).toBeInTheDocument();
    expect(pipelineSpy).not.toHaveBeenCalled();
    expect(monteCarloSpy).not.toHaveBeenCalled();
  });
});
