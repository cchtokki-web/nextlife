import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SensitivityAnalysisSection } from '@/web/features/Dashboard/expert/SensitivityAnalysisSection';
import { SensitivityScenario } from '@/core/usecases/dashboard/computeSensitivityAnalysis';
import { formatManwon } from '@/core/usecases/utility/utilityAnalysis';

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
  scenario({ key: 'yieldConservative', label: '안정형 가정 (주식 5%)', depletionAge: 82, deltaYears: -6, endingAssets: 0, endingAssetsDelta: -2500000000, unmetSpendingYears: 8 }),
  scenario({ key: 'retirementEarlier', label: '은퇴시점 -3년', depletionAge: 84, deltaYears: -4, endingAssets: 0, endingAssetsDelta: -2500000000 }),
  scenario({ key: 'inflationUp', label: '물가상승률 +1%p', depletionAge: 86, deltaYears: -2, endingAssets: 0, endingAssetsDelta: -2500000000 }),
  scenario({ key: 'inflationDown', label: '물가상승률 -1%p', depletionAge: 90, deltaYears: 2, endingAssets: 3000000000, endingAssetsDelta: 500000000 }),
  scenario({ key: 'retirementLater', label: '은퇴시점 +3년', endingAssets: 3200000000, endingAssetsDelta: 700000000 }),
  scenario({ key: 'yieldAggressive', label: '공격형 가정 (주식 9%)', endingAssets: 5000000000, endingAssetsDelta: 2500000000 }),
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
    expect(screen.getByText('50억원')).toBeInTheDocument(); // yieldAggressive의 기말자산
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

    const worse = Array.from(bars).find((b) => b.getAttribute('data-key') === 'yieldConservative')!;
    expect(worse.className).toContain('bg-danger');

    const better = Array.from(bars).find((b) => b.getAttribute('data-key') === 'yieldAggressive')!;
    expect(better.className).toContain('bg-success');
  });

  test('기준선을 함께 표시한다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={88} baselineEndingAssets={2500000000} scenarios={scenarios} />);
    expect(screen.getByText(/현재 설정 기준/)).toBeInTheDocument();
    // 「88세」는 이제 산문 줄과 기준선 행 두 곳에 나온다 — 둘 다 기준선을 말하는 자리다.
    expect(screen.getAllByText(/88세/).length).toBeGreaterThan(0);
  });

  // 회귀: 이름 w-28 + 값 w-44가 둘 다 shrink-0인 flex 행은 최소 폭이 312px로 굳는다.
  // 모바일 카드 안쪽 폭이 그보다 좁아 행이 상자 밖으로 밀렸고 금액이 테두리를 넘어 잘렸다.
  // 좁은 폭에서는 막대가 아래 줄로 내려가고 두 글자 칸 중 어느 쪽도 고정 폭을 갖지 않아야 한다.
  test('행은 고정 폭 대신 컨테이너 폭에 맞춰 접힌다', () => {
    const { container } = render(
      <SensitivityAnalysisSection baselineDepletionAge={88} baselineEndingAssets={2500000000} scenarios={scenarios} />
    );

    expect(container.querySelector('section')?.className).toContain('@container');

    const rows = container.querySelectorAll('[class*="grid-cols-"]');
    expect(rows.length).toBe(scenarios.length + 1); // 시나리오 6행 + 기준선 1행
    rows.forEach((row) => {
      expect(row.className).toContain('grid-cols-[minmax(0,1fr)_auto]');
      expect(row.className).toContain('@min-[26rem]:grid-cols-[7rem_minmax(0,1fr)_11rem]');
    });

    // 어떤 자식도 「줄어들지 않는 고정 폭」을 갖지 않는다.
    container.querySelectorAll('*').forEach((el) => {
      expect(el.className).not.toContain('shrink-0');
    });
  });
});

// **수익률 3행은 사용자 가정 대비 ±가 아니라 5/7/9%라는 절대 앵커다**
// (computeSensitivityAnalysis의 SCENARIO_DEFINITIONS 주석). 사용자 가정이 그보다 높으면
// 세 행이 전부 기준선 «아래»로 내려가는 것이 정상인데, 화면이 사용자 자신의 수익률을
// 말하지 않아 실제 리포트에서 「공격형으로 바꿨는데 왜 돈이 줄지」라는 읽기가 나왔다.
describe('SensitivityAnalysisSection - 현재 수익률 가정 공개', () => {
  test('사용자 자신의 가중평균 총수익률과 세 행이 고정 기준이라는 사실을 밝힌다', () => {
    render(
      <SensitivityAnalysisSection
        baselineDepletionAge={null} baselineEndingAssets={1458410000}
        baselineWeightedTotalReturn={12.34} scenarios={scenarios}
      />
    );

    const note = screen.getByTestId('sensitivity-baseline-return');
    expect(note).toHaveTextContent('가중평균 총수익률 12.3%');
    // 가중평균은 사적연금을 포함한 값이라, 행 이름의 「주식 5%」와 곧바로 견주면 어긋난다.
    // 두 축을 모두 적어야 세 행이 무엇을 바꾼 결과인지가 정확해진다.
    expect(note).toHaveTextContent('사적연금 포함');
    expect(note).toHaveTextContent('주식·ISA를 5/7/9%, 사적연금을 3/4/6%로 통째로 바꾼 결과');
    expect(note).toHaveTextContent('현재 가정과 무관하게 고정된 비교 기준');
  });

  // 굴릴 잔액이 없으면 가중평균을 낼 수 없다. 없는 값을 0%라고 말하지 않는다.
  test('유도할 잔액이 없으면 수익률 줄을 만들지 않는다', () => {
    render(
      <SensitivityAnalysisSection
        baselineDepletionAge={null} baselineEndingAssets={1458410000}
        baselineWeightedTotalReturn={null} scenarios={scenarios}
      />
    );

    expect(screen.queryByTestId('sensitivity-baseline-return')).not.toBeInTheDocument();
  });

  // 산문 속 금액과 목록 속 금액을 눈으로 이어 붙여야 비교가 되면 대부분 이어 붙이지 않는다.
  test('기준선을 막대 목록 안에도 한 줄로 넣는다', () => {
    render(
      <SensitivityAnalysisSection
        baselineDepletionAge={null} baselineEndingAssets={1458410000} scenarios={scenarios}
      />
    );

    const row = screen.getByTestId('sensitivity-baseline-row');
    expect(row).toHaveTextContent('현재 가정 (기준)');
    expect(row).toHaveTextContent(formatManwon(1458410000));
  });

  // 기준선은 비교 «대상»이 아니라 비교의 «기준»이다. 증감 0짜리 막대를 그리면 목록에서
  // 「가장 나쁜 경우」로 읽힌다.
  test('기준선 행에는 막대를 그리지 않는다', () => {
    const { container } = render(
      <SensitivityAnalysisSection
        baselineDepletionAge={null} baselineEndingAssets={1458410000} scenarios={scenarios}
      />
    );

    const row = screen.getByTestId('sensitivity-baseline-row');
    expect(row.querySelector('[data-testid="sensitivity-bar"]')).toBeNull();
    // 시나리오 막대 수는 그대로다 — 기준선이 행 하나를 «더할» 뿐 막대를 늘리지 않는다.
    expect(container.querySelectorAll('[data-testid="sensitivity-bar"]').length).toBe(scenarios.length);
  });

  // 투자자산이 없는 계획은 모든 값이 0원이라 기준선 한 줄이 「0원」을 한 번 더 반복할 뿐이다.
  test('투자자산이 없는 계획에서는 기준선 행을 그리지 않는다', () => {
    render(
      <SensitivityAnalysisSection
        baselineDepletionAge={51} baselineEndingAssets={0} baselineUnmetSpendingYears={31}
        planAssetStatus="no_investable_asset" scenarios={scenarios}
      />
    );

    expect(screen.queryByTestId('sensitivity-baseline-row')).not.toBeInTheDocument();
  });
});

// **예전 동작을 되돌린 것이 이 스위트의 핵심이다.**
//
// 6개 시나리오가 전부 "평생 유지"이면 상세 막대를 접고 "고갈 위험 없습니다" 한 줄만
// 보여줬다. 그 결과 실제 리포트에서 수익률 가정(안정형/공격형)이 기말자산을 수십억
// 갈라놓는데도 사용자는 아무 차이도 보지 못했다 — 정보량이 0인 화면이었다.
// 고정한 생활비를 밝히지 않으면 사용자는 자기가 입력한 목표 생활비 기준으로 표를 읽는다.
// 「평생 소비 최적화」에서는 그 두 금액이 다르다.
describe('SensitivityAnalysisSection - 고정된 생활비 표기', () => {
  test('6개 시나리오가 공통으로 고정한 월 생활비를 밝힌다', () => {
    render(
      <SensitivityAnalysisSection
        baselineDepletionAge={88} baselineEndingAssets={2500000000}
        frozenMonthlySpending={2320000} scenarios={scenarios}
      />
    );

    expect(screen.getByText(/고정/)).toBeInTheDocument();
    expect(screen.getByText(/232만원/)).toBeInTheDocument();
  });

  test('값이 없으면 문장을 만들어 내지 않는다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={88} baselineEndingAssets={2500000000} scenarios={scenarios} />);

    expect(screen.queryByText(/고정한 채/)).not.toBeInTheDocument();
  });
});

describe('SensitivityAnalysisSection - 고갈이 전혀 없는 계획', () => {
  const allLifetime: SensitivityScenario[] = [
    scenario({ key: 'yieldConservative', label: '안정형 가정 (주식 5%)', endingAssets: 820000000, endingAssetsDelta: -1680000000 }),
    scenario({ key: 'yieldAggressive', label: '공격형 가정 (주식 9%)', endingAssets: 5100000000, endingAssetsDelta: 2600000000 }),
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
    expect(screen.getByText('안정형 가정 (주식 5%)')).toBeInTheDocument();
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

// 투자자산이 없는 계획에서는 수익률·물가 가정을 어떻게 흔들어도 기말자산이 0원으로 같다.
// 예전에는 6행이 전부 "0원 · 51세 고갈 · 생활비 부족 31년"으로 똑같이 찍혀, 분석이 있는데
// 아무것도 구분하지 못하는 화면이 됐다. 실제로 갈리는 것은 은퇴시점뿐이다.
describe('SensitivityAnalysisSection - 투자자산 미보유 계획', () => {
  const noAssetScenarios: SensitivityScenario[] = [
    scenario({ key: 'yieldConservative', label: '안정형 가정 (주식 5%)', depletionAge: 51, unmetSpendingYears: 31 }),
    scenario({ key: 'yieldAggressive', label: '공격형 가정 (주식 9%)', depletionAge: 51, unmetSpendingYears: 31 }),
    scenario({ key: 'inflationUp', label: '물가상승률 +1%p', depletionAge: 51, unmetSpendingYears: 31 }),
    scenario({ key: 'inflationDown', label: '물가상승률 -1%p', depletionAge: 51, unmetSpendingYears: 31 }),
    scenario({ key: 'retirementEarlier', label: '은퇴시점 -3년', depletionAge: 51, unmetSpendingYears: 34 }),
    scenario({ key: 'retirementLater', label: '은퇴시점 +3년', depletionAge: 51, unmetSpendingYears: 28 }),
  ];

  function renderNoAsset() {
    return render(
      <SensitivityAnalysisSection
        baselineDepletionAge={51}
        baselineEndingAssets={0}
        baselineUnmetSpendingYears={31}
        scenarios={noAssetScenarios}
        planAssetStatus="no_investable_asset"
      />
    );
  }

  test('수익률·물가처럼 결과가 baseline과 완전히 같은 행은 숨긴다', () => {
    renderNoAsset();

    expect(screen.queryByText('안정형 가정 (주식 5%)')).not.toBeInTheDocument();
    expect(screen.queryByText('물가상승률 +1%p')).not.toBeInTheDocument();
    expect(screen.getByText('은퇴시점 -3년')).toBeInTheDocument();
    expect(screen.getByText('은퇴시점 +3년')).toBeInTheDocument();
  });

  test('왜 그런지와 몇 개를 생략했는지를 밝힌다 (조용히 자르지 않는다)', () => {
    renderNoAsset();

    expect(screen.getByText(/투자자산이 없어/)).toBeInTheDocument();
    expect(screen.getByText(/4개 가정은 결과가 동일해 생략/)).toBeInTheDocument();
  });

  // 기말자산이 전부 0원이라 금액 막대는 길이도 값도 무의미하다. 실제로 갈리는 축인
  // 생활비 부족 연수로 막대를 그린다.
  test('막대와 값이 기말자산 대신 생활비 부족 연수를 기준으로 표시된다', () => {
    const { container } = renderNoAsset();

    const bars = container.querySelectorAll('[data-testid="sensitivity-bar"]');
    expect(bars).toHaveLength(2);

    const worse = Array.from(bars).find((b) => b.getAttribute('data-key') === 'retirementEarlier')!;
    expect(worse.className).toContain('bg-danger');
    const better = Array.from(bars).find((b) => b.getAttribute('data-key') === 'retirementLater')!;
    expect(better.className).toContain('bg-success');

    expect(screen.getByText('생활비 부족 34년')).toBeInTheDocument();
    expect(screen.getByText('생활비 부족 28년')).toBeInTheDocument();
    expect(screen.queryByText(/51세 고갈/)).not.toBeInTheDocument();
  });

  test('투자자산이 있으면(기존 계획) 기존과 동일하게 6행 전부를 금액 기준으로 보여준다', () => {
    const { container } = render(
      <SensitivityAnalysisSection
        baselineDepletionAge={88}
        baselineEndingAssets={2500000000}
        baselineUnmetSpendingYears={0}
        scenarios={scenarios}
        planAssetStatus="sustained"
      />
    );

    expect(container.querySelectorAll('[data-testid="sensitivity-bar"]')).toHaveLength(6);
    expect(screen.queryByText(/생략/)).not.toBeInTheDocument();
  });
});
