import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoreKpiGrid } from '@/web/features/Dashboard/kpi/CoreKpiGrid';

describe('CoreKpiGrid', () => {
  test('4개 KPI(은퇴준비도/순자산/월생활비/Utility)를 모두 렌더링한다', () => {
    render(
      <CoreKpiGrid
        survivalScore={92}
        expectancy={90}
        endingAssets={500000000}
        monthlyTarget={3000000}
        utilityScore={81}
        formatValue={(v) => `${v}원`}
      />
    );

    expect(screen.getByText('90세까지 은퇴 준비도')).toBeInTheDocument();
    expect(screen.queryByText(/기대수명/)).not.toBeInTheDocument();
    expect(screen.getByText('90세 예상 순자산 · 현재 계획')).toBeInTheDocument();
    expect(screen.getByText('예상 월 생활비')).toBeInTheDocument();
    expect(screen.getByText('평생 효용')).toBeInTheDocument();
    expect(screen.getByText('500000000원')).toBeInTheDocument();
    expect(screen.getByText('3000000원')).toBeInTheDocument();
    expect(screen.getByText('81점')).toBeInTheDocument();
  });

  test('utilityScore가 없으면 Utility 카드를 렌더링하지 않는다', () => {
    render(
      <CoreKpiGrid
        survivalScore={92}
        expectancy={90}
        endingAssets={500000000}
        monthlyTarget={3000000}
        formatValue={(v) => `${v}원`}
      />
    );

    expect(screen.queryByText('평생 효용')).not.toBeInTheDocument();
  });
});

describe('CoreKpiGrid - 몬테카를로 성공률 병기', () => {
  const baseProps = {
    survivalScore: 92,
    expectancy: 90,
    endingAssets: 500000000,
    monthlyTarget: 3000000,
    utilityScore: 81,
    formatValue: (v: number) => `${v}원`,
    planAssetStatus: 'sustained' as const,
    monteCarloStatus: 'done' as const,
  };

  test('결정론 등급과 어긋나는 성공률에는 경고 표시가 붙는다', () => {
    // 51인 실측의 핵심: "매우 안정" 등급인데 시장 변동을 반영하면 성공률이 55%인 계획이
    // 흔하다. 등급만 보여 주면 사용자가 그 사실을 알 길이 없다.
    render(<CoreKpiGrid {...baseProps} monteCarlo={{ successRate: 0.78 }} />);

    expect(screen.getByText('시장변동 78%')).toBeInTheDocument();
    expect(screen.getByLabelText('시장 변동 반영 시 자산 유지 확률 78%')).toBeInTheDocument();
  });

  test('성공률이 문턱 이상이면 숫자만 표시한다', () => {
    render(<CoreKpiGrid {...baseProps} monteCarlo={{ successRate: 0.98 }} />);

    expect(screen.getByText('시장변동 98%')).toBeInTheDocument();
  });

  test('계산 중이거나 워커를 쓸 수 없으면 아무것도 표시하지 않는다', () => {
    // 사용자가 어찌할 수 없는 환경 문제를 계획의 문제로 오해하게 만들지 않는다.
    const { rerender } = render(
      <CoreKpiGrid {...baseProps} monteCarloStatus="running" monteCarlo={undefined} />
    );
    expect(screen.queryByText(/시장변동/)).not.toBeInTheDocument();

    rerender(<CoreKpiGrid {...baseProps} monteCarloStatus="unsupported" monteCarlo={undefined} />);
    expect(screen.queryByText(/시장변동/)).not.toBeInTheDocument();
  });

  test('추천 결과(After) 모드에서는 표시하지 않는다', () => {
    // 몬테카를로는 baseline params로만 계산된다. 추천안의 등급 옆에 현재 계획의 확률을
    // 붙이면 화면이 말하는 값과 계산에 쓴 값이 달라진다.
    render(<CoreKpiGrid {...baseProps} resultBasis="recommended" monteCarlo={{ successRate: 0.78 }} />);

    expect(screen.queryByText(/시장변동/)).not.toBeInTheDocument();
  });
});
