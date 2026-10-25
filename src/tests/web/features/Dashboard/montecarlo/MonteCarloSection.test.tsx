import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MonteCarloSection } from '@/web/features/Dashboard/montecarlo/MonteCarloSection';
import { MonteCarloResult } from '@/core/entities/montecarlo';
import { SequenceRiskResult } from '@/core/usecases/montecarlo/sequenceRisk';
import { NO_GOAL_FAILURE, LEGACY_GOAL_CONDITIONS } from '@/tests/fixtures/goalFailure';
import { SimulationParams } from '@/core/entities/types';
import { resolveSpendingCurve } from '@/core/usecases/spending/spendingCurve';
import { describeSuccessRates } from '@/core/usecases/montecarlo/describeSuccessRates';

// 캡션이 서술하는 판정 기준은 params의 생활비 곡선에서 나온다. 기본 픽스처는 곡선을 «켠»
// 계획이다 — 이 컴포넌트에서 회귀가 났던 자리가 정확히 「곡선이 있는데 기준액 하나만
// 인쇄한다」였기 때문이다.
function makeParams(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
    assets: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    spendingCurve: resolveSpendingCurve('front_loaded'),
    ...overrides,
  };
}

function makeMonteCarlo(overrides: Partial<MonteCarloResult> = {}): MonteCarloResult {
  return {
    trials: 1000,
    seed: 1,
    annualStdDev: 18,
    successAge: 90,
    successRate: 0.87,
    spendingSuccessRate: 0.81,
    averageSpendingFulfillmentRate: 0.973,
    goalSuccessProbability: 0.81,
    goalFailure: NO_GOAL_FAILURE, goalConditions: LEGACY_GOAL_CONDITIONS,
    plannedMonthlySpending: 2230000,
    endingAssets: { p10: 200000000, p50: 1800000000, p90: 5200000000 },
    assetBands: [
      { age: 60, p10: 400000000, p50: 1200000000 },
      { age: 90, p10: 200000000, p50: 600000000 },
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
      { key: 'earlyCrash', label: '은퇴 직후 최악 5년', endingAssets: 900000000, depletionAge: null, yearlyTotalAssets: [] },
    ],
    orderingSpread: 3500000000,
    sharedMeanShock: 0.02,
    ...overrides,
  };
}

const formatValue = (v: number) => `${Math.round(v / 100000000)}억원`;

// 화면은 이 문장을 만들지 않고 core가 만든 것을 그대로 받는다(DashboardSection이 한 번
// 계산해 내려보낸다). 테스트도 같은 경로를 그대로 태워야 두 곳이 갈라지는 날 여기서 걸린다.
function copyFor(overrides: Partial<SimulationParams> = {}) {
  return describeSuccessRates({ monteCarlo: makeMonteCarlo(), params: makeParams(overrides), formatValue });
}
const successRateCopy = copyFor();

describe('MonteCarloSection', () => {
  test('계산 중에는 스켈레톤을 보여준다', () => {
    render(<MonteCarloSection successRateCopy={successRateCopy} status="running" formatValue={formatValue} isPro={false} />);

    expect(screen.getByText(/계산 중/)).toBeInTheDocument();
  });

  test('실패하면 그 사실을 알린다', () => {
    render(<MonteCarloSection successRateCopy={successRateCopy} status="error" formatValue={formatValue} isPro={false} />);

    expect(screen.getByText(/계산하지 못했습니다/)).toBeInTheDocument();
  });

  // 브라우저가 Worker를 지원하지 않아도 나머지 화면은 정상이어야 한다. 조용히 사라지는
  // 대신 왜 없는지 밝힌다.
  test('Worker를 지원하지 않으면 그 사실을 알린다', () => {
    render(<MonteCarloSection successRateCopy={successRateCopy} status="unsupported" formatValue={formatValue} isPro={false} />);

    expect(screen.getByText(/지원하지 않아/)).toBeInTheDocument();
  });

  test('아직 시작하지 않았으면 아무것도 렌더하지 않는다', () => {
    const { container } = render(<MonteCarloSection successRateCopy={successRateCopy} status="idle" formatValue={formatValue} isPro={false} />);

    expect(container.firstChild).toBeNull();
  });

  test('성공률을 백분율로 보여준다', () => {
    render(
      <MonteCarloSection successRateCopy={successRateCopy} status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );

    expect(screen.getByText(/87%/)).toBeInTheDocument();
    expect(screen.getByText('목표생활비 완전 충족률')).toBeInTheDocument();
    expect(screen.getByText('평균 목표생활비 충족도')).toBeInTheDocument();
    expect(screen.getByText('97.3%')).toBeInTheDocument();
    expect(screen.getByText('90세까지 자산 유지 확률')).toBeInTheDocument();
    expect(screen.getByTestId('asset-success-caption')).toHaveTextContent(/90세 이전에 금융자산이 0원이 되지 않은/);
  });

  // **캡션은 엔진이 실제로 판정하는 기준을 말해야 한다.**
  //
  // 회귀 방지 대상: 예전에는 「계획 생활비(월 300만원)를 한 해도 줄이지 않은 경우입니다」였다.
  // 그런데 엔진은 연령대별 배수를 곱한 값으로 판정한다 — 70대에 258만원을 썼어도 그것이
  // 그 해의 «목표»였으면 성공이다. 문구가 300만원 하나만 말해 사용자가 71%를 「300만원을
  // 30년 내내 유지한 비율」로 읽게 만들었다.
  test('생활 유지 성공률의 기준을 연령대별 목표 생활비로 밝힌다', () => {
    render(
      <MonteCarloSection successRateCopy={successRateCopy} status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );

    const caption = screen.getByTestId('spending-success-caption');
    expect(caption).toHaveTextContent('연령별 목표 생활비');
    // front_loaded 곡선(1 / 0.86 / 0.76) × 기준액 223만원.
    expect(caption).toHaveTextContent('60~69세');
    expect(caption).toHaveTextContent('70~79세');
    expect(caption).toHaveTextContent('80~90세');
  });

  // 곡선이 없는 계획에서는 나열할 구간이 없다. 그 계획에서는 종전 문장이 참이므로 그대로 쓴다.
  test('생활비 곡선이 없으면 기준액 한 줄로 말한다', () => {
    render(
      <MonteCarloSection
        successRateCopy={copyFor({ spendingCurve: undefined })}
        status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false}
      />
    );

    const caption = screen.getByTestId('spending-success-caption');
    expect(caption).toHaveTextContent('계획 생활비');
    expect(caption).not.toHaveTextContent('연령별');
  });

  // 요구 ④: 두 비율은 서로 다른 시행 집합에서 나온 «다른» 지표다(요구 ②). 정밀도도 각자
  // 다르므로 구간 하나를 돌려쓸 수 없다. 1000회 기준 독립 계산: 0.81 → 78~83%, 0.87 → 85~89%.
  test('두 비율에 각자의 신뢰구간을 붙인다', () => {
    render(
      <MonteCarloSection successRateCopy={successRateCopy} status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );

    expect(screen.getByTestId('spending-success-caption')).toHaveTextContent('95% 신뢰구간 78~83%');
    expect(screen.getByTestId('asset-success-caption')).toHaveTextContent('95% 신뢰구간 85~89%');
  });

  // **평균 목표생활비 충족도에는 붙이지 않는다.** 이항 비율이 아니라 비율의 «평균»이라
  // 이항 신뢰구간이 설명하는 대상이 아니다. 붙이면 없는 정밀도를 주장하게 된다.
  test('평균 목표생활비 충족도에는 신뢰구간을 붙이지 않는다', () => {
    render(
      <MonteCarloSection successRateCopy={successRateCopy} status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );

    const block = screen.getByText('평균 목표생활비 충족도').closest('div');
    expect(block?.textContent).not.toContain('신뢰구간');
  });

  // 두 비율이 같은 값으로 나란히 뜨면 사용자는 「그러면 둘이 같은 지표 아닌가」로 읽는다.
  // 상단 「목표 달성 확률」이 둘을 «같은 시행에서» 함께 판정한 값이라는 관계를 밝힌다.
  test('상단 목표 달성 확률과 두 비율의 관계를 밝힌다', () => {
    render(
      <MonteCarloSection successRateCopy={successRateCopy} status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );

    const note = screen.getByTestId('composite-probability-note');
    expect(note).toHaveTextContent('같은 시행에서');
    expect(note).toHaveTextContent('곱하거나 더한 값이 아닙니다');
  });

  test('시행 횟수를 밝힌다', () => {
    render(
      <MonteCarloSection successRateCopy={successRateCopy} status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );

    expect(screen.getByText(/1,000회/)).toBeInTheDocument();
  });

  test('변동성·분포·상관·시드 가정을 밝힌다', () => {
    render(
      <MonteCarloSection successRateCopy={successRateCopy} status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );

    expect(screen.getByText(/연 변동성 18%p/)).toBeInTheDocument();
    expect(screen.getByText(/정규분포/)).toBeInTheDocument();
    expect(screen.getByText(/계좌별 충격은 기대수익률에 비례/)).toBeInTheDocument();
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
      <MonteCarloSection successRateCopy={successRateCopy} status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );

    const drag = screen.getByTestId('volatility-drag');
    expect(drag).toHaveTextContent(/변동 없음 가정/);
    // 결정론 25억 vs 중앙값 18억 — 픽스처의 두 값이 모두 인쇄되어야 격차가 보인다.
    expect(drag).toHaveTextContent(formatValue(2_500_000_000));
    expect(drag).toHaveTextContent(formatValue(1_800_000_000));
  });

  test('Pro 사용자에게도 같은 설명을 보여준다', () => {
    render(
      <MonteCarloSection successRateCopy={successRateCopy} status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={true} />
    );

    expect(screen.getByTestId('volatility-drag')).toBeInTheDocument();
  });

  test('무료 사용자에게도 성공률은 보여준다', () => {
    render(
      <MonteCarloSection successRateCopy={successRateCopy} status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );

    expect(screen.getByText(/87%/)).toBeInTheDocument();
  });

  test('상세 분포는 Pro 사용자에게만 보여준다', () => {
    const { rerender } = render(
      <MonteCarloSection successRateCopy={successRateCopy} status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={false} />
    );
    expect(screen.queryByTestId('monte-carlo-distribution')).not.toBeInTheDocument();

    rerender(
      <MonteCarloSection successRateCopy={successRateCopy} status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={true} />
    );
    expect(screen.getByTestId('monte-carlo-distribution')).toBeInTheDocument();
  });

  test('고갈이 예상되는 시행이 있으면 가장 이른 나이를 알린다', () => {
    render(
      <MonteCarloSection successRateCopy={successRateCopy} status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={true} />
    );

    // 「70~79세」 구간 캡션과 겹치므로 분포 섹션 안에서 찾는다.
    expect(screen.getByTestId('monte-carlo-distribution')).toHaveTextContent(/가장 이른 시점은 79세/);
  });
});

describe('MonteCarloSection - 순서 리스크', () => {
  test('순서만으로 갈린 격차를 헤드라인으로 보여준다', () => {
    render(
      <MonteCarloSection successRateCopy={successRateCopy}
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
      <MonteCarloSection successRateCopy={successRateCopy}
        status="done" monteCarlo={makeMonteCarlo()} sequenceRisk={makeSequenceRisk()}
        formatValue={formatValue} isPro={false}
      />
    );

    // 이 문장은 <strong>으로 강조되어 별도 노드에 있다.
    expect(screen.getByText(/같은 수익률 집합을 사용합니다/)).toBeInTheDocument();
  });

  test('Pro 사용자에게는 경우별 비교를 모두 보여준다', () => {
    render(
      <MonteCarloSection successRateCopy={successRateCopy}
        status="done" monteCarlo={makeMonteCarlo()} sequenceRisk={makeSequenceRisk()}
        formatValue={formatValue} isPro={true}
      />
    );

    expect(screen.getByText('나쁜 해가 먼저')).toBeInTheDocument();
    expect(screen.getByText('은퇴 직후 최악 5년')).toBeInTheDocument();
  });

  test('순서 리스크 데이터가 없으면 그 부분만 생략한다', () => {
    render(
      <MonteCarloSection successRateCopy={successRateCopy} status="done" monteCarlo={makeMonteCarlo()} formatValue={formatValue} isPro={true} />
    );

    expect(screen.getByText(/87%/)).toBeInTheDocument();
    expect(screen.queryByText('나쁜 해가 먼저')).not.toBeInTheDocument();
  });
});
