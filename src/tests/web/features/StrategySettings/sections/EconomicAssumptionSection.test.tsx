import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EconomicAssumptionSection } from '@/web/features/StrategySettings/sections/EconomicAssumptionSection';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';

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
    expect(screen.getByText(/경제 시나리오가 아래 물가상승률과 환율을 결정합니다/)).toBeInTheDocument();
  });

  test('경제 시나리오가 AI 추천(미정)이면 물가상승률 입력이 가능하고 안내문이 없다', () => {
    render(
      <EconomicAssumptionSection
        params={noAutoRate} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()}
      />
    );

    expect(screen.getByLabelText('물가상승률')).not.toBeDisabled();
    expect(screen.queryByText(/경제 시나리오가 아래 물가상승률과 환율을 결정합니다/)).not.toBeInTheDocument();
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
    expect(screen.queryByText(/경제 시나리오가 아래 물가상승률과 환율을 결정합니다/)).not.toBeInTheDocument();
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
