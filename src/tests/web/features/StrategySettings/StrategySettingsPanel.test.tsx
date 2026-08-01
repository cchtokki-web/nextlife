import { describe, test, expect, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { StrategySettingsPanel } from '@/web/features/StrategySettings/StrategySettingsPanel';
import { initialParams } from '@/infrastructure/storage/localStore';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { StrategyRecommendation } from '@/core/entities/types';
import * as RecommendationEngine from '@/core/usecases/strategy/RecommendationEngine';

// 추천은 page.tsx가 계산해 prop으로 내려준다. 패널은 더 이상 스스로 계산하지 않으므로
// 테스트도 recommendStrategy를 모킹하지 않고 원하는 추천을 그대로 넣는다.
const noRecommendation = { recommendation: undefined, recommendationFailed: false };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StrategySettingsPanel', () => {
  test('전략 모드 3개와 6개 섹션 제목을 렌더링한다', () => {
    render(<StrategySettingsPanel params={initialParams} onChangeParams={vi.fn()} {...noRecommendation} />);

    expect(screen.getByRole('radio', { name: /간편/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /표준/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /전문가/ })).toBeInTheDocument();

    for (const title of ['기본 정보', '은퇴 목표', '연금 전략', '투자 전략', '경제 가정', '고급 설정']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  test('strategy가 없으면 간편 모드가 선택된다', () => {
    render(<StrategySettingsPanel params={initialParams} onChangeParams={vi.fn()} {...noRecommendation} />);

    expect(screen.getByRole('radio', { name: /간편/ })).toBeChecked();
  });

  test('모드를 바꾸면 strategy.mode가 반영된 params로 onChangeParams가 호출된다', () => {
    const onChangeParams = vi.fn();
    render(<StrategySettingsPanel params={initialParams} onChangeParams={onChangeParams} {...noRecommendation} />);

    fireEvent.click(screen.getByRole('radio', { name: /전문가/ }));

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, mode: 'expert' },
    });
  });

  test('기본값과 다른 값이 있으면 해당 섹션에 변경 개수 배지가 표시된다', () => {
    const params = {
      ...initialParams,
      userProfile: { ...initialParams.userProfile, currentAge: 42 },
    };

    render(<StrategySettingsPanel params={params} onChangeParams={vi.fn()} {...noRecommendation} />);

    expect(screen.getByText('1개 변경')).toBeInTheDocument();
  });

  test('간편 모드에서 고급 설정 변경이 있으면 숨겨진 설정 개수를 알린다', () => {
    const params = {
      ...initialParams,
      taxSettings: { ...initialParams.taxSettings, usDividendTaxRate: 20 } as never,
    };

    render(<StrategySettingsPanel params={params} onChangeParams={vi.fn()} {...noRecommendation} />);

    expect(screen.getByText('숨겨진 사용자 설정 1개')).toBeInTheDocument();
  });

  test('AI가 60세(조기수령)를 추천하면 적용 시 조기 수령 전략으로 역매핑된다', () => {
    // StrategyCandidateGenerator의 나이 격자는 [60, 65, 70]이라 AI가 60세를 정당하게
    // 추천할 수 있다. NationalPensionStrategy에 조기수령(early=60) 값이 없으면 최근접
    // 역매핑이 60을 'normal'(65)로 뒤집어 추천과 반대 방향이 된다 — 이 테스트가 그 경로를 잡는다.
    const recommendation = {
      improved: true,
      recommendedPlan: { nationalPensionStartAge: 60, isaMaturityDestination: 'pension' },
    } as unknown as StrategyRecommendation;

    const onChangeParams = vi.fn();
    render(
      <StrategySettingsPanel
        params={initialParams}
        onChangeParams={onChangeParams}
        recommendation={recommendation}
        recommendationFailed={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '연금 전략 AI 추천' }));

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: {
        ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'early', preferIsaFirst: false,
      },
    });
  });

  // page.tsx가 이미 recommendStrategy를 돌린다. 패널이 또 돌리면 이 앱에서 가장 무거운
  // 계산(최대 162개 후보 시뮬레이션)이 params 변경마다 두 번 실행된다.
  test('패널은 추천을 직접 계산하지 않는다 (prop으로 받은 값만 쓴다)', () => {
    const spy = vi.spyOn(RecommendationEngine, 'recommendStrategy');

    render(<StrategySettingsPanel params={initialParams} onChangeParams={vi.fn()} {...noRecommendation} />);

    expect(spy).not.toHaveBeenCalled();
  });

  test('추천 계산이 실패하면 섹션의 AI 추천 버튼에 에러 문구가 표시된다', () => {
    render(
      <StrategySettingsPanel
        params={initialParams}
        onChangeParams={vi.fn()}
        recommendation={undefined}
        recommendationFailed
      />
    );

    expect(screen.getByRole('button', { name: '연금 전략 추천을 계산하지 못했습니다.' }))
      .toBeDisabled();
  });

  test('섹션에서 값을 바꾸면 그 섹션이 잠깐 강조되고 시간이 지나면 해제된다', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <StrategySettingsPanel params={initialParams} onChangeParams={vi.fn()} {...noRecommendation} />
      );

      fireEvent.click(screen.getByRole('button', { name: /기본 정보/ }));
      fireEvent.change(screen.getByLabelText('현재 나이'), { target: { value: '48' } });

      expect(container.querySelectorAll('[data-highlighted]')).toHaveLength(1);

      act(() => { vi.advanceTimersByTime(2000); });

      expect(container.querySelectorAll('[data-highlighted]')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
