import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SensitivityAnalysisSection } from '@/web/features/Dashboard/expert/SensitivityAnalysisSection';
import { SensitivityScenario } from '@/core/usecases/dashboard/computeSensitivityAnalysis';

function scenario(overrides: Partial<SensitivityScenario> & Pick<SensitivityScenario, 'key' | 'label'>): SensitivityScenario {
  return {
    depletionAge: null,
    deltaYears: null,
    endingAssets: 0,
    endingAssetsDelta: 0,
    unmetSpendingYears: 0,
    ...overrides,
  };
}

const scenarios: SensitivityScenario[] = [
  scenario({ key: 'returnDown', label: '투자수익률 -2%p', depletionAge: 82, deltaYears: -6, endingAssets: 0, endingAssetsDelta: -2500000000, unmetSpendingYears: 8 }),
  scenario({ key: 'retirementEarlier', label: '은퇴시점 -3년', depletionAge: 84, deltaYears: -4, endingAssets: 0, endingAssetsDelta: -2500000000 }),
  scenario({ key: 'inflationUp', label: '물가상승률 +1%p', depletionAge: 86, deltaYears: -2, endingAssets: 0, endingAssetsDelta: -2500000000 }),
  scenario({ key: 'inflationDown', label: '물가상승률 -1%p', depletionAge: 90, deltaYears: 2, endingAssets: 3000000000, endingAssetsDelta: 500000000 }),
  scenario({ key: 'retirementLater', label: '은퇴시점 +3년', endingAssets: 3200000000, endingAssetsDelta: 700000000 }),
  scenario({ key: 'returnUp', label: '투자수익률 +2%p', endingAssets: 5000000000, endingAssetsDelta: 2500000000 }),
];

describe('SensitivityAnalysisSection', () => {
  test('6개 시나리오 행이 모두 렌더된다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={88} baselineEndingAssets={2500000000} scenarios={scenarios} />);
    scenarios.forEach((s) => {
      expect(screen.getByText(s.label)).toBeInTheDocument();
    });
  });

  test('각 시나리오의 기말자산을 표시한다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={88} baselineEndingAssets={2500000000} scenarios={scenarios} />);
    expect(screen.getByText('50억원')).toBeInTheDocument(); // returnUp의 기말자산
  });

  test('고갈이 발생하는 시나리오는 고갈 나이도 함께 표시한다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={88} baselineEndingAssets={2500000000} scenarios={scenarios} />);
    expect(screen.getByText(/82세 고갈/)).toBeInTheDocument();
  });

  test('생활비를 채우지 못한 해가 있으면 그 사실을 표시한다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={88} baselineEndingAssets={2500000000} scenarios={scenarios} />);
    expect(screen.getByText(/8년/)).toBeInTheDocument();
  });

  test('악화 막대는 danger, 개선 막대는 success 색상을 갖는다', () => {
    const { container } = render(
      <SensitivityAnalysisSection baselineDepletionAge={88} baselineEndingAssets={2500000000} scenarios={scenarios} />
    );
    const bars = container.querySelectorAll('[data-testid="sensitivity-bar"]');
    expect(bars).toHaveLength(6);

    const worse = Array.from(bars).find((b) => b.getAttribute('data-key') === 'returnDown')!;
    expect(worse.className).toContain('bg-danger');

    const better = Array.from(bars).find((b) => b.getAttribute('data-key') === 'returnUp')!;
    expect(better.className).toContain('bg-success');
  });

  test('기준선을 함께 표시한다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={88} baselineEndingAssets={2500000000} scenarios={scenarios} />);
    expect(screen.getByText(/현재 설정 기준/)).toBeInTheDocument();
    expect(screen.getByText(/88세/)).toBeInTheDocument();
  });
});

// **예전 동작을 되돌린 것이 이 스위트의 핵심이다.**
//
// 6개 시나리오가 전부 "평생 유지"이면 상세 막대를 접고 "고갈 위험 없습니다" 한 줄만
// 보여줬다. 그 결과 실제 리포트에서 수익률 ±2%p가 기말자산을 수십억 갈라놓는데도
// 사용자는 아무 차이도 보지 못했다 — 정보량이 0인 화면이었다.
describe('SensitivityAnalysisSection - 고갈이 전혀 없는 계획', () => {
  const allLifetime: SensitivityScenario[] = [
    scenario({ key: 'returnDown', label: '투자수익률 -2%p', endingAssets: 820000000, endingAssetsDelta: -1680000000 }),
    scenario({ key: 'returnUp', label: '투자수익률 +2%p', endingAssets: 5100000000, endingAssetsDelta: 2600000000 }),
    scenario({ key: 'inflationUp', label: '물가상승률 +1%p', endingAssets: 1900000000, endingAssetsDelta: -600000000 }),
    scenario({ key: 'inflationDown', label: '물가상승률 -1%p', endingAssets: 3300000000, endingAssetsDelta: 800000000 }),
    scenario({ key: 'retirementEarlier', label: '은퇴시점 -3년', endingAssets: 2100000000, endingAssetsDelta: -400000000 }),
    scenario({ key: 'retirementLater', label: '은퇴시점 +3년', endingAssets: 2900000000, endingAssetsDelta: 400000000 }),
  ];

  test('고갈이 없어도 기말자산 막대 6줄을 모두 보여준다', () => {
    const { container } = render(
      <SensitivityAnalysisSection baselineDepletionAge={null} baselineEndingAssets={2500000000} scenarios={allLifetime} />
    );

    expect(container.querySelectorAll('[data-testid="sensitivity-bar"]')).toHaveLength(6);
    expect(screen.getByText('투자수익률 -2%p')).toBeInTheDocument();
  });

  test('고갈이 없다는 사실 자체는 여전히 알린다', () => {
    render(
      <SensitivityAnalysisSection baselineDepletionAge={null} baselineEndingAssets={2500000000} scenarios={allLifetime} />
    );

    expect(screen.getByText(/고갈 위험이 없습니다/)).toBeInTheDocument();
  });

  test('고갈이 없는 시나리오에는 고갈 나이를 붙이지 않는다', () => {
    render(
      <SensitivityAnalysisSection baselineDepletionAge={null} baselineEndingAssets={2500000000} scenarios={allLifetime} />
    );

    expect(screen.queryByText(/세 고갈/)).not.toBeInTheDocument();
  });
});
