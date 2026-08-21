import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EconomicAssumptionSection } from '@/web/features/StrategySettings/sections/EconomicAssumptionSection';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';
import { DEFAULT_HEALTHCARE } from '@/web/features/StrategySettings/strategyOptions';
import { isFieldVisible } from '@/web/features/StrategySettings/fieldVisibility';
import { HealthcareAssumptions, SimulationParams, StrategyMode } from '@/core/entities/types';

// 이 섹션은 마운트 시 실시간 환율을 조회한다. 테스트가 실제 네트워크를 타지 않도록
// 기본적으로 "응답 없음"으로 막고, 조회를 검증하는 테스트만 개별로 응답을 준다.
const stubFetch = (impl: () => Promise<unknown>) => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(impl));
};

beforeEach(() => {
  stubFetch(() => new Promise(() => {})); // 영원히 pending — 조회를 사실상 무력화한다
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// 자동 조회를 끈 params. 환율과 무관한 항목을 검증할 때 쓴다.
const noAutoRate = { ...initialParams, useLatestExchangeRate: false };

describe('EconomicAssumptionSection', () => {
  test('물가상승률·환율·기준 통화를 표시한다', () => {
    render(
      <EconomicAssumptionSection
        params={noAutoRate} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()}
      />
    );

    expect(screen.getByLabelText('물가상승률')).toHaveValue(2.5);
    expect(screen.getByLabelText('적용 환율')).toBeInTheDocument();
    expect(screen.getByLabelText('대시보드 기준 통화')).toBeInTheDocument();
  });

  test('실질 수익률 스위치를 끄면 inflationMode가 nominal이 된다', () => {
    const onChangeParams = vi.fn();
    render(
      <EconomicAssumptionSection
        params={noAutoRate} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()}
      />
    );

    fireEvent.click(screen.getByRole('switch', { name: /실질 수익률로 계산/ }));

    expect(onChangeParams).toHaveBeenCalledWith({ ...noAutoRate, inflationMode: 'nominal' });
  });

  test('경제 시나리오를 명시적으로 고르면 물가상승률 입력이 비활성화되고 안내문이 보인다', () => {
    const params = {
      ...noAutoRate,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, economicScenario: 'recession' as const },
    };

    render(
      <EconomicAssumptionSection
        params={params} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()}
      />
    );

    expect(screen.getByLabelText('물가상승률')).toBeDisabled();
    // applyEconomicScenario는 물가·환율만 대체하고 자산·사적연금의 수익률은 건드리지 않는다.
    // 배너가 그 사실을 정확히 전달해야 한다.
    expect(screen.getByText(/경제 시나리오가 아래 물가상승률과 환율을 대체합니다/)).toBeInTheDocument();
  });

  test('경제 시나리오가 AI 추천(미정)이면 물가상승률 입력이 가능하고 안내문이 없다', () => {
    render(
      <EconomicAssumptionSection
        params={noAutoRate} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()}
      />
    );

    expect(screen.getByLabelText('물가상승률')).not.toBeDisabled();
    expect(screen.queryByText(/경제 시나리오가 아래 물가상승률과 환율을 대체합니다/)).not.toBeInTheDocument();
  });

  test('간편 모드에서는 물가·환율 필드가 숨겨지므로 시나리오 안내 배너도 렌더되지 않는다', () => {
    // 표준/전문가에서 시나리오를 고른 뒤 간편으로 낮추면 값은 보존된다. 그때 배너만
    // 홀로 남으면 무엇을 가리키는 경고인지 알 수 없다.
    const params = {
      ...noAutoRate,
      strategy: {
        ...DEFAULT_RETIREMENT_STRATEGY, economicScenario: 'recession' as const, mode: 'simple' as const,
      },
    };

    render(
      <EconomicAssumptionSection
        params={params} onChangeParams={vi.fn()}
        mode="simple" changed={new Set()}
      />
    );

    expect(screen.queryByLabelText('물가상승률')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('적용 환율')).not.toBeInTheDocument();
    expect(screen.queryByText(/경제 시나리오가 아래 물가상승률과 환율을 대체합니다/)).not.toBeInTheDocument();
  });
});

// A4: 의료비 나이 입력도 BasicInfoSection과 같은 parseAge 규약을 따라야 한다.
// 빈 문자열이 Number()로 0이 되어 저장되면 디바운스 자동저장이 그 0을 영구화한다.
describe('EconomicAssumptionSection - 의료비 나이 입력', () => {
  const withHealthcare = {
    ...noAutoRate,
    healthcare: {
      enabled: true, costGrowthRate: 5, baseMonthlyCost: 300000,
      longTermCareEnabled: true, longTermCareStartAge: 80, longTermCareMonthlyCost: 1500000,
      shockEnabled: true, shockAge: 75, shockAmount: 30000000,
    },
  };

  test('장기요양 시작 나이를 비우면 저장하지 않는다', () => {
    const onChangeParams = vi.fn();
    render(
      <EconomicAssumptionSection
        params={withHealthcare} onChangeParams={onChangeParams}
        mode="expert" changed={new Set()}
      />
    );

    fireEvent.change(screen.getByLabelText('장기요양 시작 나이'), { target: { value: '' } });

    expect(onChangeParams).not.toHaveBeenCalled();
  });

  test('급증 발생 나이를 비우면 저장하지 않는다', () => {
    const onChangeParams = vi.fn();
    render(
      <EconomicAssumptionSection
        params={withHealthcare} onChangeParams={onChangeParams}
        mode="expert" changed={new Set()}
      />
    );

    fireEvent.change(screen.getByLabelText('급증 발생 나이'), { target: { value: '' } });

    expect(onChangeParams).not.toHaveBeenCalled();
  });

  test('나이 입력은 허용 범위로 클램프된다', () => {
    const onChangeParams = vi.fn();
    render(
      <EconomicAssumptionSection
        params={withHealthcare} onChangeParams={onChangeParams}
        mode="expert" changed={new Set()}
      />
    );

    fireEvent.change(screen.getByLabelText('급증 발생 나이'), { target: { value: '999' } });

    expect(onChangeParams).toHaveBeenCalledWith(
      expect.objectContaining({
        healthcare: expect.objectContaining({ shockAge: 120 }),
      })
    );
  });
});

describe('EconomicAssumptionSection - 최신 환율 자동 조회', () => {
  test('useLatestExchangeRate가 미지정이면 마운트 시 조회해 환율에 반영한다', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ rates: { KRW: 1400.44 } }) }));
    const onChangeParams = vi.fn();

    render(
      <EconomicAssumptionSection
        params={initialParams} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()}
      />
    );

    await waitFor(() => {
      expect(onChangeParams).toHaveBeenCalledWith({
        ...initialParams,
        baseExchangeRate: 1400.4, // 소수 첫째 자리까지 반올림
        exchangeScenario: 'base',
      });
    });
  });

  test('useLatestExchangeRate가 false면 조회하지 않고 환율을 직접 입력할 수 있다', () => {
    const onChangeParams = vi.fn();
    render(
      <EconomicAssumptionSection
        params={noAutoRate} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()}
      />
    );

    expect(fetch).not.toHaveBeenCalled();

    const input = screen.getByLabelText('적용 환율');
    expect(input).not.toBeDisabled();

    fireEvent.change(input, { target: { value: '1,400' } });

    expect(onChangeParams).toHaveBeenCalledWith({ ...noAutoRate, baseExchangeRate: 1400 });
  });

  test('자동 조회가 켜져 있으면 환율 입력을 직접 고칠 수 없다', () => {
    render(
      <EconomicAssumptionSection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()}
      />
    );

    expect(screen.getByLabelText('적용 환율')).toBeDisabled();
  });

  test('스위치를 끄면 useLatestExchangeRate가 false로 저장된다', () => {
    const onChangeParams = vi.fn();
    render(
      <EconomicAssumptionSection
        params={initialParams} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()}
      />
    );

    fireEvent.click(screen.getByRole('switch', { name: /최신 환율 자동 적용/ }));

    expect(onChangeParams).toHaveBeenCalledWith({ ...initialParams, useLatestExchangeRate: false });
  });

  test('조회에 실패하면 이유를 화면에 보여주고 기존 환율을 유지한다', async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));
    const onChangeParams = vi.fn();

    render(
      <EconomicAssumptionSection
        params={initialParams} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()}
      />
    );

    expect(await screen.findByText(/실시간 환율 데이터를 가져오지 못했습니다/)).toBeInTheDocument();
    expect(onChangeParams).not.toHaveBeenCalled();
  });

  test('응답 형식이 예상과 다르면 그 사실을 알린다', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ rates: {} }) }));

    render(
      <EconomicAssumptionSection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()}
      />
    );

    expect(await screen.findByText(/환율 데이터 형식이 유효하지 않습니다/)).toBeInTheDocument();
  });

  test('간편 모드에서는 환율 자동 조회 스위치도 숨긴다', () => {
    render(
      <EconomicAssumptionSection
        params={noAutoRate} onChangeParams={vi.fn()}
        mode="simple" changed={new Set()}
      />
    );

    expect(screen.queryByRole('switch', { name: /최신 환율 자동 적용/ })).not.toBeInTheDocument();
  });
});

// C7: 이 섹션의 의료비 블록은 상호작용 테스트가 하나도 없었다. 스위치·금액 입력이
// 전부 setHealthcare를 거치는데, 그 병합(기본값 → 기존 값 → 패치)이 무너지면 부분 객체가
// 저장되어 healthcareCosts.ts가 undefined를 곱하고 결과가 NaN이 된다.
describe('EconomicAssumptionSection - 의료비 가정', () => {
  // 세 스위치를 모두 켠 완전한 상태. 하위 필드가 전부 렌더된다.
  const fullHealthcare: HealthcareAssumptions = {
    enabled: true, costGrowthRate: 5, baseMonthlyCost: 300000,
    longTermCareEnabled: true, longTermCareStartAge: 80, longTermCareMonthlyCost: 1500000,
    shockEnabled: true, shockAge: 75, shockAmount: 30000000,
  };

  const withHealthcare = (patch: Partial<HealthcareAssumptions> = {}): SimulationParams => ({
    ...noAutoRate,
    healthcare: { ...fullHealthcare, ...patch },
  });

  const renderSection = (
    params: SimulationParams, onChangeParams = vi.fn(), mode: StrategyMode = 'expert'
  ) => {
    render(
      <EconomicAssumptionSection
        params={params} onChangeParams={onChangeParams}
        mode={mode} changed={new Set()}
      />
    );
    return onChangeParams;
  };

  // 의료비 필드가 하나만 바뀌고 나머지 params는 그대로여야 한다. objectContaining으로
  // 느슨하게 보면 엉뚱한 필드를 함께 덮어써도 통과한다.
  const expectHealthcarePatch = (
    onChangeParams: ReturnType<typeof vi.fn>,
    base: SimulationParams,
    patch: Partial<HealthcareAssumptions>
  ) => {
    expect(onChangeParams).toHaveBeenCalledWith({
      ...base,
      healthcare: { ...DEFAULT_HEALTHCARE, ...(base.healthcare ?? {}), ...patch },
    });
  };

  describe('표시 토글', () => {
    test('의료비 스위치가 꺼져 있으면 하위 필드가 하나도 없다', () => {
      // initialParams에는 healthcare 키 자체가 없다(= 꺼짐). 하위 필드가 이때도 보이면
      // 사용자가 끈 계산의 입력을 계속 만지게 되고, 그 값이 저장까지 된다.
      renderSection(noAutoRate);

      expect(screen.getByRole('switch', { name: /의료비를 따로 계산/ })).not.toBeChecked();
      expect(screen.queryByLabelText('은퇴 시점 월 의료비')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('의료비 증가율')).not.toBeInTheDocument();
      expect(screen.queryByRole('switch', { name: /장기요양 발생 가정/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('switch', { name: /의료비 급증 시나리오/ })).not.toBeInTheDocument();
    });

    test('의료비 스위치를 켜면 기본값 위에 enabled만 얹어 저장한다', () => {
      // healthcare가 undefined인 상태에서 { enabled: true }만 넘기면 나머지 키가 없는
      // 부분 객체가 저장되고, 이후 healthcareCosts가 undefined를 곱해 NaN을 만든다.
      const onChangeParams = renderSection(noAutoRate);

      fireEvent.click(screen.getByRole('switch', { name: /의료비를 따로 계산/ }));

      expect(onChangeParams).toHaveBeenCalledWith({
        ...noAutoRate,
        healthcare: { ...DEFAULT_HEALTHCARE, enabled: true },
      });
    });

    test('의료비 스위치가 켜지면 기본 필드가 나타난다', () => {
      renderSection(withHealthcare({ longTermCareEnabled: false, shockEnabled: false }));

      expect(screen.getByLabelText('은퇴 시점 월 의료비')).toBeInTheDocument();
      expect(screen.getByLabelText('의료비 증가율')).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: /장기요양 발생 가정/ })).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: /의료비 급증 시나리오/ })).toBeInTheDocument();
    });

    test('의료비 스위치를 끄면 enabled만 false가 되고 나머지 값은 보존된다', () => {
      // 끌 때 healthcare 자체를 지우면 다시 켰을 때 사용자가 넣은 금액·나이가 모두 날아간다.
      const params = withHealthcare();
      const onChangeParams = renderSection(params);

      fireEvent.click(screen.getByRole('switch', { name: /의료비를 따로 계산/ }));

      expectHealthcarePatch(onChangeParams, params, { enabled: false });
    });

    test('장기요양 스위치가 꺼져 있으면 그 하위 필드만 숨는다', () => {
      renderSection(withHealthcare({ longTermCareEnabled: false }));

      expect(screen.queryByLabelText('장기요양 시작 나이')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('장기요양 시작 시점 월 비용')).not.toBeInTheDocument();
      // 형제 블록(급증)은 영향을 받지 않아야 한다 — 조건을 한 곳에 묶으면 함께 사라진다.
      expect(screen.getByLabelText('급증 발생 나이')).toBeInTheDocument();
    });

    test('장기요양 스위치를 켜면 longTermCareEnabled만 뒤집히고 하위 필드가 나타난다', () => {
      const params = withHealthcare({ longTermCareEnabled: false });
      const onChangeParams = renderSection(params);

      fireEvent.click(screen.getByRole('switch', { name: /장기요양 발생 가정/ }));

      expectHealthcarePatch(onChangeParams, params, { longTermCareEnabled: true });

      renderSection(withHealthcare({ longTermCareEnabled: true }));
      expect(screen.getByLabelText('장기요양 시작 나이')).toBeInTheDocument();
      expect(screen.getByLabelText('장기요양 시작 시점 월 비용')).toBeInTheDocument();
    });

    test('급증 스위치가 꺼져 있으면 그 하위 필드만 숨는다', () => {
      renderSection(withHealthcare({ shockEnabled: false }));

      expect(screen.queryByLabelText('급증 발생 나이')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('급증 시 1회 금액')).not.toBeInTheDocument();
      expect(screen.getByLabelText('장기요양 시작 나이')).toBeInTheDocument();
    });

    test('급증 스위치를 켜면 shockEnabled만 뒤집히고 하위 필드가 나타난다', () => {
      const params = withHealthcare({ shockEnabled: false });
      const onChangeParams = renderSection(params);

      fireEvent.click(screen.getByRole('switch', { name: /의료비 급증 시나리오/ }));

      expectHealthcarePatch(onChangeParams, params, { shockEnabled: true });

      renderSection(withHealthcare({ shockEnabled: true }));
      expect(screen.getByLabelText('급증 발생 나이')).toBeInTheDocument();
      expect(screen.getByLabelText('급증 시 1회 금액')).toBeInTheDocument();
    });
  });

  describe('나이 입력 (parseAge 규약)', () => {
    // 빈 문자열을 그냥 Number()에 넣으면 0이 된다. 디바운스 자동저장(useScenarios)이
    // 타이핑 중간에 걸리면 그 0이 E2EE 저장소에 영구화된다 — "0세부터 장기요양"이 된다.
    test.each([
      ['장기요양 시작 나이'],
      ['급증 발생 나이'],
    ])('%s를 비우면 저장하지 않는다', (label) => {
      const onChangeParams = renderSection(withHealthcare());

      fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });

      expect(onChangeParams).not.toHaveBeenCalled();
    });

    test.each([
      ['장기요양 시작 나이'],
      ['급증 발생 나이'],
    ])('%s에 공백만 넣어도 저장하지 않는다', (label) => {
      const onChangeParams = renderSection(withHealthcare());

      fireEvent.change(screen.getByLabelText(label), { target: { value: '   ' } });

      expect(onChangeParams).not.toHaveBeenCalled();
    });

    // min/max 속성은 프로그램적 입력을 전혀 막지 못한다. 파싱 단계에서 걸러야
    // 0세·121세 같은 값이 저장소에 남지 않는다.
    test.each([
      ['장기요양 시작 나이', '0', 1, 'longTermCareStartAge'],
      ['장기요양 시작 나이', '121', 120, 'longTermCareStartAge'],
      ['급증 발생 나이', '0', 1, 'shockAge'],
      ['급증 발생 나이', '121', 120, 'shockAge'],
    ] as const)('%s에 %s를 넣으면 %d로 클램프된다', (label, input, expected, key) => {
      const params = withHealthcare();
      const onChangeParams = renderSection(params);

      fireEvent.change(screen.getByLabelText(label), { target: { value: input } });

      expectHealthcarePatch(onChangeParams, params, { [key]: expected });
    });
  });

  describe('금액 입력 (콤마 파싱)', () => {
    const AMOUNT_FIELDS = [
      ['은퇴 시점 월 의료비', 'baseMonthlyCost'],
      ['장기요양 시작 시점 월 비용', 'longTermCareMonthlyCost'],
      ['급증 시 1회 금액', 'shockAmount'],
    ] as const;

    test.each(AMOUNT_FIELDS)('%s는 콤마를 뗀 숫자로 저장한다', (label, key) => {
      const params = withHealthcare();
      const onChangeParams = renderSection(params);

      fireEvent.change(screen.getByLabelText(label), { target: { value: '1,234,567' } });

      // 콤마를 떼지 않으면 Number('1,234,567')이 NaN이 되어 그대로 저장된다.
      expectHealthcarePatch(onChangeParams, params, { [key]: 1234567 });
    });

    test.each(AMOUNT_FIELDS)('%s에 숫자가 아닌 값을 넣으면 저장하지 않는다', (label) => {
      const onChangeParams = renderSection(withHealthcare());

      fireEvent.change(screen.getByLabelText(label), { target: { value: '12만원' } });

      expect(onChangeParams).not.toHaveBeenCalled();
    });

    test.each(AMOUNT_FIELDS)('%s를 비우면 0으로 저장한다(지웠다 다시 입력하는 경로)', (label, key) => {
      const params = withHealthcare();
      const onChangeParams = renderSection(params);

      fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });

      expectHealthcarePatch(onChangeParams, params, { [key]: 0 });
    });

    test.each(AMOUNT_FIELDS)('%s는 콤마 표기로 보여준다', (label, key) => {
      renderSection(withHealthcare());

      expect(screen.getByLabelText(label)).toHaveValue(fullHealthcare[key].toLocaleString());
    });

    // 엔진은 의료비를 displayCurrency로 환산한 값과 맞대므로, 이 필드들의 단위는
    // 표시 통화를 따라야 한다. '원'으로 고정하면 USD 사용자가 달러 값을 넣으면서
    // '원'을 보게 되어 화면 표기와 엔진 해석이 어긋난다.
    test.each(AMOUNT_FIELDS)('%s의 단위 표기는 표시 통화를 따른다', (label) => {
      renderSection({ ...withHealthcare(), displayCurrency: 'USD' });

      expect(screen.getByLabelText(label).parentElement).toHaveTextContent('USD');
    });
  });

  // SECTION_FIELDS/isFieldVisible이 단일 소스인데 섹션이 자체 조건을 덧붙이면,
  // 간편 모드에서 숨겨야 할 필드가 노출되거나(간편 원칙 위반) 표준에서 보여야 할 필드가
  // 사라진다. 두 곳이 실제로 일치하는지 경로 단위로 대조한다.
  describe('모드별 표시 여부가 isFieldVisible과 일치한다', () => {
    const SWITCH_PATHS: ReadonlyArray<readonly [string, string]> = [
      ['healthcare.enabled', '의료비를 따로 계산'],
      ['healthcare.longTermCareEnabled', '장기요양 발생 가정'],
      ['healthcare.shockEnabled', '의료비 급증 시나리오'],
    ];
    const INPUT_PATHS: ReadonlyArray<readonly [string, string]> = [
      ['healthcare.baseMonthlyCost', '은퇴 시점 월 의료비'],
      ['healthcare.costGrowthRate', '의료비 증가율'],
      ['healthcare.longTermCareStartAge', '장기요양 시작 나이'],
      ['healthcare.longTermCareMonthlyCost', '장기요양 시작 시점 월 비용'],
      ['healthcare.shockAge', '급증 발생 나이'],
      ['healthcare.shockAmount', '급증 시 1회 금액'],
    ];

    test.each(['simple', 'standard', 'expert'] as const)('%s 모드', (mode) => {
      // 모든 스위치를 켠 상태에서 본다 — 숨김의 원인이 모드인지 스위치인지 섞이지 않는다.
      renderSection(withHealthcare(), vi.fn(), mode);

      for (const [path, label] of SWITCH_PATHS) {
        const found = screen.queryByRole('switch', { name: new RegExp(label) });
        expect(!!found, `${mode}/${path}`).toBe(isFieldVisible(mode, path));
      }
      for (const [path, label] of INPUT_PATHS) {
        const found = screen.queryByLabelText(label);
        expect(!!found, `${mode}/${path}`).toBe(isFieldVisible(mode, path));
      }
    });

    test('간편 모드에서는 의료비 관련 입력이 하나도 보이지 않는다', () => {
      // 위 대조 테스트는 isFieldVisible이 통째로 false를 돌려주게 바뀌어도 통과한다.
      // 간편 모드의 실제 기대(= 필수 입력만)를 별도로 못 박아 둔다.
      renderSection(withHealthcare(), vi.fn(), 'simple');

      expect(screen.queryByRole('switch', { name: /의료비를 따로 계산/ })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('은퇴 시점 월 의료비')).not.toBeInTheDocument();
    });

    test('표준 모드에서는 의료비 입력이 모두 보인다', () => {
      renderSection(withHealthcare(), vi.fn(), 'standard');

      expect(screen.getByRole('switch', { name: /의료비를 따로 계산/ })).toBeInTheDocument();
      expect(screen.getByLabelText('급증 시 1회 금액')).toBeInTheDocument();
    });
  });
});
