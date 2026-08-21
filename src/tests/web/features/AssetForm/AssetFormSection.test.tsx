import { describe, test, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssetFormSection } from '@/web/features/AssetForm/AssetFormSection';
import { SimulationParams } from '@/core/entities/types';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';

// 탭 클릭 시 handleTabClick이 scrollIntoView를 부르는데 jsdom에는 구현이 없다.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const baseParams: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

// 사적연금(IRP)·ISA를 하나씩 가진 params. 여러 describe가 공유한다.
const withPensionAndIsa = (
  strategy: SimulationParams['strategy'],
  pensionInvestmentType?: 'etf'
): SimulationParams => ({
  ...baseParams,
  strategy,
  privatePensions: [{
    id: 'p1', type: 'irp', balance: 1000, monthlyContribution: 0, totalReturn: 5,
    currency: 'KRW', investmentType: pensionInvestmentType, ticker: 'AAA',
  }],
  isaAccounts: [{
    id: 'i1', type: 'general', balance: 1000, monthlyContribution: 0,
    totalReturn: 5, dividendYield: 1.5, currency: 'KRW', maturityYears: 3,
  }],
});

// 인적사항 탭은 사라졌다. 같은 값을 두 곳에서 편집할 수 있으면 어느 쪽이 진짜인지 알 수 없다.
// 지금 각 값이 있는 곳: 현재 나이·기대수명은 입력 1단계(와 고급 「기본 정보」),
// 은퇴 나이·생활비·목표 상속자산은 입력 3단계의 「은퇴 목표」 카드 — 그 축들은 목표에서
// 파생되므로(normalizeGoalDrivenParams) 고급 패널에는 아예 입력이 없다.
describe('AssetFormSection - 인적사항 탭 제거됨', () => {
  test('인적사항 탭 버튼과 중복 입력 필드를 렌더링하지 않는다', () => {
    render(<AssetFormSection params={baseParams} onChangeParams={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /인적사항/ })).not.toBeInTheDocument();
    for (const label of ['현재 나이', '목표 은퇴 나이', '기대 수명', '목표 상속자산', '은퇴 생활비 전략']) {
      expect(screen.queryByText(label), label).not.toBeInTheDocument();
    }
  });

  test('기본 탭은 주식 & ETF이며 자산 추가 UI가 바로 보인다', () => {
    render(<AssetFormSection params={baseParams} onChangeParams={vi.fn()} />);

    expect(screen.getByRole('button', { name: /주식 & ETF/ })).toBeInTheDocument();
    expect(screen.getByText(/자산 추가/)).toBeInTheDocument();
  });
});

// B2: compileStrategy는 리스크 성향(또는 경제 시나리오)이 명시적이면 applyYieldPreset/
// applyEconomicScenario로 자산·연금·ISA 수익률을 통째로 덮어쓴다. 이 폼은 compiled.params가
// 아니라 원본 params를 받으므로, 입력을 열어두면 사용자는 자기 입력값을 보면서 엔진은
// 프리셋 값으로 계산하는 상태가 된다. 저율과세 한도·물가상승률과 같은 처리를 한다:
// 전략이 지배 중이면 비활성화하고 이유를 표시한다.
describe('AssetFormSection - 전략이 수익률을 지배할 때', () => {
  const withAsset: SimulationParams = {
    ...baseParams,
    assets: [{
      id: 'a1', type: 'etf', ticker: 'AAA', name: '자산1', quantity: 10, averagePrice: 1000,
      totalReturn: 12, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: false, currency: 'KRW',
    }],
  };

  const renderExpanded = (params: SimulationParams) => {
    render(<AssetFormSection params={params} onChangeParams={vi.fn()} />);
    // 수익률 입력은 자산 카드를 펼쳐야 보인다.
    fireEvent.click(screen.getByText('자산1'));
  };

  test('리스크 성향이 명시적이면 연 총수익률 입력이 비활성화되고 이유가 표시된다', () => {
    renderExpanded({
      ...withAsset,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, riskProfile: 'conservative' },
    });

    expect(screen.getByLabelText('연 총수익률')).toBeDisabled();
    expect(screen.getByText(/리스크 성향/)).toBeInTheDocument();
  });

  test('경제 시나리오가 명시적이면 연 총수익률 입력이 비활성화되고 이유가 표시된다', () => {
    renderExpanded({
      ...withAsset,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, economicScenario: 'recession' },
    });

    expect(screen.getByLabelText('연 총수익률')).toBeDisabled();
    expect(screen.getByText(/경제 시나리오/)).toBeInTheDocument();
  });

  test('둘 다 AI 추천(미정)이면 입력이 열려 있고 안내 문구도 없다', () => {
    renderExpanded({ ...withAsset, strategy: { ...DEFAULT_RETIREMENT_STRATEGY } });

    expect(screen.getByLabelText('연 총수익률')).toBeEnabled();
    expect(screen.queryByText(/이 값을 결정합니다/)).not.toBeInTheDocument();
  });

  test('전략이 아예 없는(레거시) 시나리오에서도 입력이 열려 있다', () => {
    renderExpanded(withAsset);

    expect(screen.getByLabelText('연 총수익률')).toBeEnabled();
  });

  test('배당률은 프리셋이 건드리지 않으므로 계속 편집할 수 있다', () => {
    renderExpanded({
      ...withAsset,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, riskProfile: 'aggressive' },
    });

    expect(screen.getByLabelText('연 배당률')).toBeEnabled();
  });

  test('사적연금·ISA 수익률 입력도 함께 비활성화된다', () => {
    const params = withPensionAndIsa({ ...DEFAULT_RETIREMENT_STRATEGY, riskProfile: 'conservative' });
    render(<AssetFormSection params={params} onChangeParams={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /연금 자산/ }));
    fireEvent.click(screen.getByText(/IRP 연금 계좌/));
    expect(screen.getByLabelText('연 총수익률')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /ISA 계좌/ }));
    fireEvent.click(screen.getByText(/중개형 ISA/));
    expect(screen.getByLabelText('연 총수익률')).toBeDisabled();
  });

  // A2(2): 실시간 조회 버튼은 totalReturn을 덮어쓰면서 yieldPreset을
  // 'custom'으로까지 찍는다. 입력만 잠그고 이 버튼을 남기면 지배 중에도 버튼 하나로
  // 화면상 수익률과 'custom' 표식이 동시에 바뀌고 엔진은 여전히 프리셋으로 계산한다.
  test('지배 중이면 자산의 실시간 성장률/배당률 조회 버튼도 비활성화된다', () => {
    renderExpanded({
      ...withAsset,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, riskProfile: 'conservative' },
    });

    for (const button of screen.getAllByTitle(/실시간 성장률\/배당률 조회/)) {
      expect(button).toBeDisabled();
    }
  });

  test('지배하지 않으면 실시간 조회 버튼은 평소대로 쓸 수 있다', () => {
    renderExpanded({ ...withAsset, strategy: { ...DEFAULT_RETIREMENT_STRATEGY } });

    for (const button of screen.getAllByTitle(/실시간 성장률\/배당률 조회/)) {
      expect(button).toBeEnabled();
    }
  });

  test('지배 중이면 사적연금의 실시간 수익률 조회 버튼도 비활성화된다', () => {
    const params = withPensionAndIsa(
      { ...DEFAULT_RETIREMENT_STRATEGY, economicScenario: 'recession' },
      'etf'
    );
    render(<AssetFormSection params={params} onChangeParams={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /연금 자산/ }));
    fireEvent.click(screen.getByText(/IRP 연금 계좌/));

    for (const button of screen.getAllByTitle(/실시간 수익률/)) {
      expect(button).toBeDisabled();
    }
  });
});

// A3(WCAG 2.5.3): 보이는 라벨과 접근성 이름이 달라선 안 된다. 음성 제어 사용자가 화면에
// 보이는 "연 총수익률"이라고 말했을 때 aria-label이 "연 수익률"이면 잡히지 않는다.
describe('AssetFormSection - 수익률 입력의 접근성 이름', () => {
  test('사적연금 수익률 입력의 접근성 이름이 보이는 라벨과 같다', () => {
    const params = withPensionAndIsa(DEFAULT_RETIREMENT_STRATEGY);
    render(<AssetFormSection params={params} onChangeParams={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /연금 자산/ }));
    fireEvent.click(screen.getByText(/IRP 연금 계좌/));

    expect(screen.getByLabelText('연 총수익률')).toHaveAccessibleName('연 총수익률');
  });

  test('ISA 수익률 입력의 접근성 이름이 보이는 라벨과 같다', () => {
    const params = withPensionAndIsa(DEFAULT_RETIREMENT_STRATEGY);
    render(<AssetFormSection params={params} onChangeParams={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /ISA 계좌/ }));
    fireEvent.click(screen.getByText(/중개형 ISA/));

    expect(screen.getByLabelText('연 총수익률')).toHaveAccessibleName('연 총수익률');
  });

  test('예금형 사적연금은 "연 이자율 (금리)"로 읽힌다', () => {
    const params: SimulationParams = {
      ...baseParams,
      privatePensions: [{
        id: 'p1', type: 'irp', balance: 1000, monthlyContribution: 0,
        totalReturn: 5, currency: 'KRW', investmentType: 'deposit',
      }],
    };
    render(<AssetFormSection params={params} onChangeParams={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /연금 자산/ }));
    fireEvent.click(screen.getByText(/IRP 연금 계좌/));

    expect(screen.getByLabelText('연 이자율 (금리)')).toHaveAccessibleName('연 이자율 (금리)');
  });
});

// 사적연금 수령 개시 나이 설정 기능(WithdrawalPlan.privatePensionStartAge) 제거 회귀 가드.
// 연금 탭을 실제로 열어 확인한다 — 닫힌 탭에서 없음을 확인하면 항상 통과하는 빈 테스트가 된다.
describe('AssetFormSection - 사적연금 수령 개시 나이 UI 제거됨', () => {
  test('사적연금 계좌가 있어도 수령 개시 나이 입력 UI를 렌더링하지 않는다', () => {
    const params: SimulationParams = {
      ...baseParams,
      privatePensions: [
        { id: 'pension-1', type: 'irp', balance: 100000000, monthlyContribution: 0, totalReturn: 5, currency: 'KRW' },
      ],
    };
    render(<AssetFormSection params={params} onChangeParams={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /연금 자산/ }));

    expect(screen.queryByText(/사적연금 수령 개시 나이/)).not.toBeInTheDocument();
    expect(screen.queryByText('수령 개시 나이')).not.toBeInTheDocument();
  });
});

// 「매일 적립」은 달력일이 아니라 영업일 250일로 월 환산한다. 엔진에는 monthlyContribution
// 하나만 넘어가므로, 이 환산이 어긋나면 연 납입액이 그대로 46% 부풀려진다.
describe('AssetFormSection - 매일 적립의 월 환산', () => {
  const dailyAsset: SimulationParams = {
    ...baseParams,
    assets: [{
      id: 'a1', type: 'etf', ticker: 'AAA', name: '자산1', quantity: 10, averagePrice: 1000,
      totalReturn: 12, dividendYield: 2, monthlyContribution: 0,
      contributionPeriod: 'daily', contributionAmount: 0,
      reinvestDividend: false, currency: 'KRW',
    }],
  };

  const applyFirstChange = (
    onChangeParams: ReturnType<typeof vi.fn>,
    params: SimulationParams
  ): SimulationParams => {
    const updater = onChangeParams.mock.calls[0][0] as (prev: SimulationParams) => SimulationParams;
    return updater(params);
  };

  test('매일 15,000원을 넣으면 월 적립액이 영업일 기준 312,500원이 된다', () => {
    const onChangeParams = vi.fn();
    render(<AssetFormSection params={dailyAsset} onChangeParams={onChangeParams} />);
    fireEvent.click(screen.getByText('자산1'));

    fireEvent.change(screen.getByLabelText('매일 적립 투자금'), { target: { value: '15,000' } });

    const next = applyFirstChange(onChangeParams, dailyAsset);
    expect(next.assets[0].contributionAmount).toBe(15_000);
    expect(next.assets[0].monthlyContribution).toBe(312_500);
  });

  test('매월에서 매일로 주기를 바꿔도 연 납입액이 유지된다', () => {
    const monthlyAsset: SimulationParams = {
      ...dailyAsset,
      assets: [{
        ...dailyAsset.assets[0],
        contributionPeriod: 'monthly',
        contributionAmount: 500_000,
        monthlyContribution: 500_000,
      }],
    };
    const onChangeParams = vi.fn();
    render(<AssetFormSection params={monthlyAsset} onChangeParams={onChangeParams} />);
    fireEvent.click(screen.getByText('자산1'));

    // SelectField의 라벨은 select와 연결돼 있지 않아 현재 선택값으로 찾는다.
    fireEvent.change(screen.getByDisplayValue('매월'), { target: { value: 'daily' } });

    const next = applyFirstChange(onChangeParams, monthlyAsset);
    expect(next.assets[0].contributionAmount).toBe(24_000); // 500,000 × 12 / 250
    expect(next.assets[0].monthlyContribution).toBe(500_000);
  });
});
