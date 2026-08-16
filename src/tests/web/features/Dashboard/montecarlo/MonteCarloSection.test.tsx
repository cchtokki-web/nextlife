import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MonteCarloSection } from '@/web/features/Dashboard/montecarlo/MonteCarloSection';
import { MonteCarloResult } from '@/core/entities/montecarlo';
import { SequenceRiskResult } from '@/core/usecases/montecarlo/sequenceRisk';
import { NO_GOAL_FAILURE, LEGACY_GOAL_CONDITIONS } from '@/tests/fixtures/goalFailure';

function makeMonteCarlo(overrides: Partial<MonteCarloResult> = {}): MonteCarloResult {
  return {
    trials: 1000,
    seed: 1,
    annualStdDev: 18,
    successAge: 90,
    successRate: 0.87,
    spendingSuccessRate: 0.81,
    goalSuccessProbability: 0.81,
    goalFailure: NO_GOAL_FAILURE, goalConditions: LEGACY_GOAL_CONDITIONS,
    plannedMonthlySpending: 2230000,
    endingAssets: { p10: 200000000, p50: 1800000000, p90: 5200000000 },
    assetDownside: [
      { age: 60, p10: 400000000 },
      { age: 90, p10: 200000000 },
    ],
    depletion: { count: 130, earliestAge: 79, medianAge: 86 },
    deterministicEndingAssets: 2500000000,
    ...overrides,
  };
}

function makeSequenceRisk(overrides: Partial<SequenceRiskResult> = {}): SequenceRiskResult {
  return {
    cases: [
      { key: 'deterministic', label: '변동 없음 (기준)', endingAssets: 2500000000, depletionAge: null, yearlyTotalAssets: [] },
      { key: 'bestFirst', label: '좋은 해가 먼저', endingAssets: 4100000000, depletionAge: null, yearlyTotalAssets: [] },
      { key: 'shuffled', label: '무작위 순서', endingAssets: 2200000000, depletionAge: null, yearlyTotalAssets: [] },
      { key: 'worstFirst', label: '나쁜 해가 먼저', endingAssets: 600000000, depletionAge: null, yearlyTotalAssets: [] },
      { key: 'earlyCrash', label: '은퇴 직후 5년 급락', endingAssets: 900000000, depletionAge: null, yearlyTotalAssets: [] },
    ],
    orderingSpread: 3500000000,
    sharedMeanShock: 0.02,
    ...overrides,
  };
}

const formatValue = (v: number) => `${Math.round(v / 100000000)}억원`;

describe('MonteCarloSection', () => {
  test('계산 중에는 스켈레톤을 보여준다', () => {
    render(<MonteCarloSection status="running" formatValue={formatValue} isPro={false} />);

    expect(screen.getByText(/계산 중/)).toBeInTheDocument();
  });

  test('실패하면 그 사실을 알린다', () => {
    render(<MonteCarloSection status="error" formatValue={formatValue} isPro={false} />);

    expect(screen.getByText(/계산하지 못했습니다/)).toBeInTheDocument();
  });

  // 브라우저가 Worker를 지원하지 않아도 나머지 화면은 정상이어야 한다. 조용히 사라지는
  // 대신 왜 없는지 밝힌다.
  test('Worker를 지원하지 않으면 그 사실을 알린다', () => {
    render(<MonteCarloSection status="unsupported" formatValue={formatValue} isPro={false} />);

    expect(screen.getByText(/지원하지 않아/)).toBeInTheDocument();
  });

  test('아직 시작하지 않았으면 아무것도 렌더하지 않는다', () => {
    const { container } = render(<MonteCarloSection status="idle" formatValue={formatValue} isPro={false} />);

    expect(container.firstChild).toBeNull();
  });

  test('성공률을 백분율로 보여준다', () => {
    render(
      <MonteCarloSection status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );

    expect(screen.getByText(/87%/)).toBeInTheDocument();
    expect(screen.getByText(/90세까지/)).toBeInTheDocument();
  });

  test('시행 횟수를 밝힌다', () => {
    render(
      <MonteCarloSection status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );

    expect(screen.getByText(/1,000회/)).toBeInTheDocument();
  });

  test('변동성·분포·상관·시드 가정을 밝힌다', () => {
    render(
      <MonteCarloSection status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );

    expect(screen.getByText(/연 변동성 18%p/)).toBeInTheDocument();
    expect(screen.getByText(/정규분포/)).toBeInTheDocument();
    expect(screen.getByText(/같은 시장 충격/)).toBeInTheDocument();
    expect(screen.getByText(/고정 시드 1/)).toBeInTheDocument();
  });

  // **변동성 손실을 숨기지 않는다 — 무료 사용자에게도.**
  //
  // 중앙값이 결정론 결과보다 낮은 것은 버그가 아니라 이 기능의 존재 이유다. 그런데 이
  // 설명이 Pro 게이팅 안에 있어, 무료 사용자는 자산 추이 차트의 낙관적인 결정론 곡선만
  // 보고 그것을 기대값으로 읽었다. 차트에서 중앙값 선을 걷어내면서 그 창구가 아예 사라졌다.
  //
  // 방향("낮아집니다")만으로는 부족하다. 얼마나 낮은지를 모르면 사용자가 할 수 있는 일이
  // 없다. 그래서 두 값을 «수치로» 나란히 놓는다.
  test('변동성 손실을 무료 사용자에게도 두 수치로 보여준다', () => {
    render(
      <MonteCarloSection status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );

    const drag = screen.getByTestId('volatility-drag');
    expect(drag).toHaveTextContent(/변동 없음 가정/);
    // 결정론 25억 vs 중앙값 18억 — 픽스처의 두 값이 모두 인쇄되어야 격차가 보인다.
    expect(drag).toHaveTextContent(formatValue(2_500_000_000));
    expect(drag).toHaveTextContent(formatValue(1_800_000_000));
  });

  test('Pro 사용자에게도 같은 설명을 보여준다', () => {
    render(
      <MonteCarloSection status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={true} />
    );

    expect(screen.getByTestId('volatility-drag')).toBeInTheDocument();
  });

  test('무료 사용자에게도 성공률은 보여준다', () => {
    render(
      <MonteCarloSection status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );

    expect(screen.getByText(/87%/)).toBeInTheDocument();
  });

  test('상세 분포는 Pro 사용자에게만 보여준다', () => {
    const { rerender } = render(
      <MonteCarloSection status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );
    expect(screen.queryByTestId('monte-carlo-distribution')).not.toBeInTheDocument();

    rerender(
      <MonteCarloSection status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={true} />
    );
    expect(screen.getByTestId('monte-carlo-distribution')).toBeInTheDocument();
  });

  test('고갈이 예상되는 시행이 있으면 가장 이른 나이를 알린다', () => {
    render(
      <MonteCarloSection status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={true} />
    );

    expect(screen.getByText(/79세/)).toBeInTheDocument();
  });
});

describe('MonteCarloSection - 순서 리스크', () => {
  test('순서만으로 갈린 격차를 헤드라인으로 보여준다', () => {
    render(
      <MonteCarloSection
        status="done" monteCarlo={makeMonteCarlo()} sequenceRisk={makeSequenceRisk()}
        formatValue={formatValue} isPro={false}
      />
    );

    expect(screen.getByText(/35억원/)).toBeInTheDocument();
  });

  // 이 문장이 시퀀스 리스크의 요점이다. 순열이라 평균이 실제로 같다는 사실을 말하지 않으면
  // 사용자는 "그냥 운이 나쁜 경우"로 읽는다.
  test('평균이 같다는 사실을 명시한다', () => {
    render(
      <MonteCarloSection
        status="done" monteCarlo={makeMonteCarlo()} sequenceRisk={makeSequenceRisk()}
        formatValue={formatValue} isPro={false}
      />
    );

    // 이 문장은 <strong>으로 강조되어 별도 노드에 있다.
    expect(screen.getByText(/연평균 수익률이 완전히 같습니다/)).toBeInTheDocument();
  });

  test('Pro 사용자에게는 경우별 비교를 모두 보여준다', () => {
    render(
      <MonteCarloSection
        status="done" monteCarlo={makeMonteCarlo()} sequenceRisk={makeSequenceRisk()}
        formatValue={formatValue} isPro={true}
      />
    );

    expect(screen.getByText('나쁜 해가 먼저')).toBeInTheDocument();
    expect(screen.getByText('은퇴 직후 5년 급락')).toBeInTheDocument();
  });

  test('순서 리스크 데이터가 없으면 그 부분만 생략한다', () => {
    render(
      <MonteCarloSection status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={true} />
    );

    expect(screen.getByText(/87%/)).toBeInTheDocument();
    expect(screen.queryByText('나쁜 해가 먼저')).not.toBeInTheDocument();
  });
});
