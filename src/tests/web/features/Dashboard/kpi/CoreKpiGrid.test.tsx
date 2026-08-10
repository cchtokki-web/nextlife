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

  // 경고 여부는 아이콘과 색으로만 드러난다. aria-label과 '시장변동 N%' 텍스트는 충돌
  // 여부와 무관하게 **언제나** 렌더되므로, 그것들만 확인하면 임계값을 0으로 내리든
  // 1.5로 올리든(= 항상 경고) 테스트가 통과한다. 실제로 그런 상태였다.
  const warningIcon = (container: HTMLElement) => container.querySelector('svg.lucide-triangle-alert');

  test('결정론 등급과 어긋나는 성공률에는 경고 표시가 붙는다', () => {
    // 51인 실측의 핵심: "매우 안정" 등급인데 시장 변동을 반영하면 성공률이 55%인 계획이
    // 흔하다. 등급만 보여 주면 사용자가 그 사실을 알 길이 없다.
    const { container } = render(<CoreKpiGrid {...baseProps} monteCarlo={{ successRate: 0.78 }} />);

    expect(screen.getByText(/시장변동 78%/)).toBeInTheDocument();
    expect(screen.getByLabelText('시장 변동 반영 시 자산 유지 확률 78%')).toBeInTheDocument();
    expect(warningIcon(container)).toBeInTheDocument();
  });

  test('성공률이 문턱 이상이면 경고 없이 숫자만 표시한다', () => {
    const { container } = render(<CoreKpiGrid {...baseProps} monteCarlo={{ successRate: 0.98 }} />);

    expect(screen.getByText(/시장변동 98%/)).toBeInTheDocument();
    // 여기가 핵심이다 — 부재를 단언하지 않으면 "항상 경고"가 통과한다.
    expect(warningIcon(container)).not.toBeInTheDocument();
  });

  // **헤드라인 숫자가 결정론 점수면 안 되는 이유.**
  //
  // 실제 리포트에서 "64점(주의)"과 "성공률 37%"가 한 화면에 놓였는데, 사용자가 받는 인상은
  // 앞의 숫자가 결정한다 — 뒤의 확률은 부연으로 읽힌다.
  describe('시장 변동 반영 점수', () => {
    // 평생 효용 카드도 같은 등급 어휘를 쓰므로 그 카드를 빼고 준비도 카드만 남긴다 —
    // 그렇지 않으면 '안정' 같은 단어가 화면에 둘 있어 무엇을 단언하는지 모호해진다.
    const soloProps = { ...baseProps, utilityScore: undefined };

    test('헤드라인 점수와 판정이 성공률을 반영한다', () => {
      render(<CoreKpiGrid {...soloProps} monteCarlo={{ successRate: 0.78 }} />);

      // round(92 * (0.5 + 0.5*0.78)) = 82, 성공률 78% -> '주의'
      expect(screen.getByText(/82점/)).toBeInTheDocument();
      expect(screen.getByText('주의')).toBeInTheDocument();
      expect(screen.getByText('90세까지 은퇴 준비도 · 시장 변동 반영')).toBeInTheDocument();
    });

    test('성공률이 낮을수록 점수가 더 깎인다', () => {
      const { rerender } = render(<CoreKpiGrid {...soloProps} monteCarlo={{ successRate: 0.37 }} />);
      // round(92 * (0.5 + 0.5*0.37)) = 63
      expect(screen.getByText(/63점/)).toBeInTheDocument();
      expect(screen.getByText('매우 위험')).toBeInTheDocument();

      rerender(<CoreKpiGrid {...soloProps} monteCarlo={{ successRate: 0.95 }} />);
      expect(screen.getByText(/90점/)).toBeInTheDocument();
      expect(screen.getByText('안정')).toBeInTheDocument();
    });

    // MC를 못 쓰는 상태에서 보정 점수를 지어내면 안 된다 — 그때 보이는 것은 결정론 점수다.
    test('MC가 없으면 결정론 등급으로 되돌아가고 라벨에 반영 표시를 붙이지 않는다', () => {
      render(<CoreKpiGrid {...soloProps} monteCarloStatus="unsupported" monteCarlo={undefined} />);

      expect(screen.getByText('90세까지 은퇴 준비도')).toBeInTheDocument();
      expect(screen.getByText('매우 안정')).toBeInTheDocument(); // survivalScore 92의 결정론 등급
    });
  });

  test('결정론 판정이 고갈이면 성공률이 낮아도 충돌로 표시하지 않는다', () => {
    // 충돌은 "결정론은 괜찮다는데 확률은 아니다"라는 어긋남을 알리는 것이다. 결정론도
    // 이미 고갈을 말하고 있으면 어긋남이 없고, 그 경고는 고갈 알림이 따로 담당한다.
    const { container } = render(
      <CoreKpiGrid {...baseProps} planAssetStatus="depleted" monteCarlo={{ successRate: 0.4 }} />
    );

    expect(warningIcon(container)).not.toBeInTheDocument();
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
