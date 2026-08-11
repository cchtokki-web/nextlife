import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoreKpiGrid } from '@/web/features/Dashboard/kpi/CoreKpiGrid';
import { computePlanConfidence } from '@/core/usecases/dashboard/computePlanConfidence';

const confidence = (spendingSuccessRate: number, assetSuccessRate = spendingSuccessRate, score = 92) =>
  computePlanConfidence(score, { spendingSuccessRate, assetSuccessRate });

const baseProps = {
  expectancy: 90,
  endingAssets: 500000000,
  sustainableMonthly: 2230000,
  goalMonthly: 3500000,
  utilityScore: 81,
  formatValue: (v: number) => `${v}원`,
};

describe('CoreKpiGrid', () => {
  test('4개 KPI(성공률/지속가능 생활비/목표 생활비/연금 공백)를 모두 렌더링한다', () => {
    render(
      <CoreKpiGrid
        {...baseProps}
        confidence={confidence(0.95)}
        pensionGap={{ fromAge: 60, toAge: 64, years: 5, monthlyAssetWithdrawal: 2500000, bridgeAmount: 150000000 }}
      />
    );

    expect(screen.getByText('은퇴 성공률 · 생활 유지')).toBeInTheDocument();
    expect(screen.getByText('95%')).toBeInTheDocument();
    expect(screen.getByText('지속가능 생활비')).toBeInTheDocument();
    expect(screen.getByText('월 2230000원')).toBeInTheDocument();
    expect(screen.getByText('목표 생활비')).toBeInTheDocument();
    expect(screen.getByText('월 3500000원')).toBeInTheDocument();
    expect(screen.getByText('연금 공백')).toBeInTheDocument();
    expect(screen.getByText('60~64세')).toBeInTheDocument();
  });

  // 목표와 지속가능액의 차이가 이 화면의 핵심 결론이다. 두 카드를 나란히 두는 이유가 그것이므로
  // 차액을 반드시 명시한다.
  test('목표 대비 부족액을 함께 표시한다', () => {
    render(<CoreKpiGrid {...baseProps} confidence={confidence(0.95)} />);

    expect(screen.getByText('월 1270000원 부족')).toBeInTheDocument();
  });

  test('연금 공백이 없으면 "없음"으로 표시한다', () => {
    render(<CoreKpiGrid {...baseProps} confidence={confidence(0.95)} />);

    expect(screen.getByText('없음')).toBeInTheDocument();
  });

  // 카드에서는 내렸지만 화면에서 지우지는 않는다 — 상속 목표가 있는 사용자에게 기말 순자산은
  // 여전히 중요하고, 평생 효용은 이 앱의 핵심 개념이다.
  test('기말 순자산과 평생 효용은 보조 행에 남는다', () => {
    render(<CoreKpiGrid {...baseProps} confidence={confidence(0.95)} />);

    expect(screen.getByText(/90세 예상 순자산/)).toBeInTheDocument();
    expect(screen.getByText('500000000원')).toBeInTheDocument();
    expect(screen.getByText(/평생 효용/)).toBeInTheDocument();
    expect(screen.getByText('81점')).toBeInTheDocument();
  });

  test('utilityScore가 없으면 평생 효용을 표시하지 않는다', () => {
    render(<CoreKpiGrid {...baseProps} utilityScore={undefined} confidence={confidence(0.95)} />);

    expect(screen.queryByText(/평생 효용/)).not.toBeInTheDocument();
  });
});

describe('CoreKpiGrid - 두 성공률 병기', () => {
  // 경고 여부는 아이콘과 색으로만 드러난다. 확률 텍스트는 밴드와 무관하게 언제나 렌더되므로,
  // 그것만 확인하면 임계를 어떻게 바꿔도 테스트가 통과한다.
  const warningIcon = (container: HTMLElement) => container.querySelector('svg.lucide-triangle-alert');

  test('생활 유지 성공률이 큰 숫자이고 자산 보존은 함께 병기된다', () => {
    render(<CoreKpiGrid {...baseProps} confidence={confidence(0.92, 0.4)} />);

    expect(screen.getByText('92%')).toBeInTheDocument();
    expect(screen.getByText('자산 보존 40%')).toBeInTheDocument();
    expect(screen.getByLabelText('생활 유지 성공률 92%, 자산 보존 성공률 40%')).toBeInTheDocument();
  });

  // **판정은 밴드에서만 나온다.** 예전에는 "결정론은 괜찮다는데 확률이 낮다"(isMonteCarloConflict)를
  // 별도로 계산해 경고를 띄웠는데, 판정 자체가 확률에서 나오는 지금은 같은 말을 두 번 하는 것이다.
  test('밴드가 위험 계열이면 경고 아이콘이 붙는다', () => {
    const { container } = render(<CoreKpiGrid {...baseProps} confidence={confidence(0.39)} />);

    expect(warningIcon(container)).toBeInTheDocument();
    expect(screen.getByText('위험')).toBeInTheDocument();
  });

  test('밴드가 안정 계열이면 경고 없이 숫자만 표시한다', () => {
    const { container } = render(<CoreKpiGrid {...baseProps} confidence={confidence(0.98)} />);

    // 부재를 단언하지 않으면 "항상 경고"가 통과한다.
    expect(warningIcon(container)).not.toBeInTheDocument();
    expect(screen.getByText('매우 안정')).toBeInTheDocument();
  });

  // **헤드라인 숫자가 결정론 점수면 안 되는 이유.**
  //
  // 실제 리포트에서 "64점(주의)"과 "성공률 37%"가 한 화면에 놓였는데, 사용자가 받는 인상은
  // 앞의 숫자가 결정한다 — 뒤의 확률은 부연으로 읽힌다. 그래서 이 카드의 큰 숫자는 이제
  // 점수가 아니라 확률 자체이고, 등급 라벨도 그 확률에서만 나온다.
  test('큰 숫자와 등급이 모두 성공률을 따라간다', () => {
    const { rerender } = render(<CoreKpiGrid {...baseProps} confidence={confidence(0.37)} />);
    expect(screen.getByText('37%')).toBeInTheDocument();
    expect(screen.getByText('위험')).toBeInTheDocument();

    rerender(<CoreKpiGrid {...baseProps} confidence={confidence(0.95)} />);
    expect(screen.getByText('95%')).toBeInTheDocument();
    expect(screen.getByText('매우 안정')).toBeInTheDocument();
  });

  // MC를 못 쓰는 상태에서 확률을 지어내면 안 된다 — 사용자가 어찌할 수 없는 환경 문제를
  // 계획의 문제로 오해하게 만들지도 않는다.
  test('MC가 없으면 결정론 등급으로 되돌아가고 미반영임을 밝힌다', () => {
    render(<CoreKpiGrid {...baseProps} utilityScore={undefined} confidence={computePlanConfidence(92)} />);

    expect(screen.getByText('매우 안정')).toBeInTheDocument(); // 92점의 결정론 등급
    expect(screen.getByText('시장 변동성 미반영')).toBeInTheDocument();
    expect(screen.queryByText(/자산 보존/)).not.toBeInTheDocument();
  });
});
