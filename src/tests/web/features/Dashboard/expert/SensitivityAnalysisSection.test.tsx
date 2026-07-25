import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SensitivityAnalysisSection } from '@/web/features/Dashboard/expert/SensitivityAnalysisSection';
import { SensitivityScenario } from '@/core/usecases/dashboard/computeSensitivityAnalysis';

const scenarios: SensitivityScenario[] = [
  { key: 'returnDown', label: '투자수익률 -2%p', depletionAge: 82, deltaYears: -6 },
  { key: 'retirementEarlier', label: '은퇴시점 -3년', depletionAge: 84, deltaYears: -4 },
  { key: 'inflationUp', label: '물가상승률 +1%p', depletionAge: 86, deltaYears: -2 },
  { key: 'inflationDown', label: '물가상승률 -1%p', depletionAge: 90, deltaYears: 2 },
  { key: 'retirementLater', label: '은퇴시점 +3년', depletionAge: null, deltaYears: 4 },
  { key: 'returnUp', label: '투자수익률 +2%p', depletionAge: null, deltaYears: 4 },
];

describe('SensitivityAnalysisSection', () => {
  test('6개 시나리오 행이 모두 렌더된다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={88} scenarios={scenarios} />);
    scenarios.forEach((s) => {
      expect(screen.getByText(s.label)).toBeInTheDocument();
    });
  });

  test('depletionAge가 null이면 "평생 유지"를 표시한다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={88} scenarios={scenarios} />);
    const lifetimeTexts = screen.getAllByText('평생 유지');
    expect(lifetimeTexts.length).toBeGreaterThanOrEqual(2);
  });

  test('숫자 depletionAge는 "N세"와 델타(N년)를 함께 표시한다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={88} scenarios={scenarios} />);
    expect(screen.getByText(/82세/)).toBeInTheDocument();
    expect(screen.getByText(/-6년/)).toBeInTheDocument();
  });

  test('악화(deltaYears < 0) 막대는 danger 색상 클래스를, 개선(deltaYears > 0)은 success 색상 클래스를 갖는다', () => {
    const { container } = render(<SensitivityAnalysisSection baselineDepletionAge={88} scenarios={scenarios} />);
    const bars = container.querySelectorAll('[data-testid="sensitivity-bar"]');
    expect(bars).toHaveLength(6);

    const worseBar = Array.from(bars).find((b) => b.getAttribute('data-key') === 'returnDown')!;
    expect(worseBar.className).toContain('bg-danger');

    const betterBar = Array.from(bars).find((b) => b.getAttribute('data-key') === 'inflationDown')!;
    expect(betterBar.className).toContain('bg-success');
  });

  test('기준선(baselineDepletionAge) 텍스트를 표시한다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={88} scenarios={scenarios} />);
    expect(screen.getByText(/현재 설정 기준/)).toBeInTheDocument();
    expect(screen.getByText(/88세/)).toBeInTheDocument();
  });

  test('baselineDepletionAge가 null이면 기준선에도 "평생 유지"를 표시한다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={null} scenarios={scenarios} />);
    expect(screen.getByText(/현재 설정 기준/)).toBeInTheDocument();
  });
});
