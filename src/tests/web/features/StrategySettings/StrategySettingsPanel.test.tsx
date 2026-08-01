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

// 모드를 지정한 params. 기본값(strategy 미지정)은 간편 모드로 해석된다.
const withMode = (mode: 'simple' | 'standard' | 'expert') => ({
  ...initialParams,
  strategy: { ...DEFAULT_RETIREMENT_STRATEGY, mode },
});

describe('StrategySettingsPanel', () => {
  test('전략 모드 3개를 렌더링한다', () => {
    render(<StrategySettingsPanel params={initialParams} onChangeParams={vi.fn()} {...noRecommendation} />);

    expect(screen.getByRole('radio', { name: /간편/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /표준/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /전문가/ })).toBeInTheDocument();
  });

  // 모드에서 손댈 수 있는 필드가 하나도 없는 섹션은 열어봐야 빈 껍데기라 고장으로 읽힌다.
  describe('설정 가능한 필드가 없는 섹션은 렌더링하지 않는다', () => {
    // 섹션 헤더는 aria-expanded를 가진 유일한 버튼이다. 제목 텍스트로 찾으면
    // 같은 이름을 가진 AI 추천 버튼('투자 전략 AI 추천')에 걸려 거짓 통과한다.
    const sectionTitles = (container: HTMLElement) =>
      [...container.querySelectorAll('button[aria-expanded]')].map((b) => b.textContent ?? '');

    const renderIn = (mode: 'simple' | 'standard' | 'expert') => {
      const { container } = render(
        <StrategySettingsPanel params={withMode(mode)} onChangeParams={vi.fn()} {...noRecommendation} />
      );
      return (title: string) => sectionTitles(container).some((t) => t.includes(title));
    };

    test('간편 모드에서는 투자 전략·경제 가정·고급 설정이 없다', () => {
      const has = renderIn('simple');

      expect(has('기본 정보')).toBe(true);
      expect(has('은퇴 목표')).toBe(true);
      expect(has('연금 전략')).toBe(true);
      expect(has('투자 전략')).toBe(false);
      expect(has('경제 가정')).toBe(false);
      expect(has('고급 설정')).toBe(false);
    });

    test('표준 모드에서는 고급 설정만 없다', () => {
      const has = renderIn('standard');

      expect(has('투자 전략')).toBe(true);
      expect(has('경제 가정')).toBe(true);
      expect(has('고급 설정')).toBe(false);
    });

    test('전문가 모드에서는 6개 섹션이 모두 보인다', () => {
      const has = renderIn('expert');

      for (const title of ['기본 정보', '은퇴 목표', '연금 전략', '투자 전략', '경제 가정', '고급 설정']) {
        expect(has(title), title).toBe(true);
      }
    });
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

  // 숨긴 섹션의 값도 계산에는 그대로 들어간다. 섹션을 통째로 없애면 그 사실을 알릴
  // 자리가 사라지므로, 모드 선택 바로 아래에 합계를 한 줄로 요약한다.
  describe('숨긴 섹션에 남아 있는 사용자 설정 알림', () => {
    const withTaxRate = (usDividendTaxRate: number) => ({
      ...initialParams,
      taxSettings: { ...initialParams.taxSettings, usDividendTaxRate } as never,
    });

    const notice = () => screen.queryByTestId('hidden-section-notice');

    test('간편 모드에서 고급 설정 값이 기본과 다르면 합계를 알린다', () => {
      render(<StrategySettingsPanel params={withTaxRate(20)} onChangeParams={vi.fn()} {...noRecommendation} />);

      expect(notice()).toHaveTextContent('숨겨진 사용자 설정 1개');
    });

    test('숨긴 섹션이 전부 기본값이면 알림이 없다', () => {
      render(<StrategySettingsPanel params={initialParams} onChangeParams={vi.fn()} {...noRecommendation} />);

      expect(notice()).not.toBeInTheDocument();
    });

    test('전문가 모드에서는 숨긴 섹션이 없으므로 알림이 없다', () => {
      const params = {
        ...withTaxRate(20),
        strategy: { ...DEFAULT_RETIREMENT_STRATEGY, mode: 'expert' as const },
      };

      render(<StrategySettingsPanel params={params} onChangeParams={vi.fn()} {...noRecommendation} />);

      expect(notice()).not.toBeInTheDocument();
    });

    // 보이는 섹션 안의 숨은 필드(간편 모드의 '목표 상속자산' 등)는 예전처럼 그 섹션
    // 헤더 배지가 맡는다. 요약 줄이 그것까지 세면 같은 변경이 두 번 보고된다.
    test('보이는 섹션의 숨은 필드는 요약이 아니라 섹션 헤더 배지가 알린다', () => {
      const params = {
        ...initialParams,
        userProfile: { ...initialParams.userProfile, targetBequest: 100000000 },
      };

      render(<StrategySettingsPanel params={params} onChangeParams={vi.fn()} {...noRecommendation} />);

      expect(screen.getByText('숨겨진 사용자 설정 1개')).toBeInTheDocument();
      expect(notice()).not.toBeInTheDocument();
    });
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

  // B2: aiDisabled가 패널 전역(!ai.improved) 판정이라, 적용해도 이 섹션에서 바뀔 것이
  // 하나도 없는데 버튼이 활성이었다. 특히 적용 불가능한 축(사적연금 월 인출 목표)이
  // 계속 개선 여지를 만들어 improved가 사실상 영구히 true가 된다.
  describe('AI 추천 버튼의 섹션별 활성 판정', () => {
    // 이미 추천과 같은 상태(65세 = normal, ISA 연금 이전)라 연금 전략에서 적용할 것이 없다.
    const alreadyOptimalPension = {
      improved: true,
      recommendedPlan: {
        nationalPensionStartAge: 65, isaMaturityDestination: 'pension',
        monthlySpendingMultiplier: 1,
      },
      recommendedAssetReinvestment: null,
    } as unknown as StrategyRecommendation;

    // 국민연금 전략이 이미 'normal'(65세)이고 ISA도 연금 이전인 상태.
    const settledParams = {
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'normal' as const },
    };

    test('적용해도 바뀌는 값이 없으면 그 섹션의 AI 추천 버튼이 비활성화된다', () => {
      render(
        <StrategySettingsPanel
          params={settledParams}
          onChangeParams={vi.fn()}
          recommendation={alreadyOptimalPension}
          recommendationFailed={false}
        />
      );

      expect(screen.queryByRole('button', { name: new RegExp('^연금 전략 ') })).not.toBeInTheDocument();
    });

    test('적용할 값이 있으면 그 섹션만 활성화된다', () => {
      const recommendation = {
        improved: true,
        recommendedPlan: {
          nationalPensionStartAge: 70, isaMaturityDestination: 'pension',
          monthlySpendingMultiplier: 1,
        },
        recommendedAssetReinvestment: null,
      } as unknown as StrategyRecommendation;

      render(
        <StrategySettingsPanel
          params={settledParams}
          onChangeParams={vi.fn()}
          recommendation={recommendation}
          recommendationFailed={false}
        />
      );

      expect(screen.getByRole('button', { name: '연금 전략 AI 추천' })).toBeEnabled();
      // 은퇴 목표는 생활비 배수가 없으므로 적용할 것이 없다 — 버튼 자체를 내지 않는다.
      expect(screen.queryByRole('button', { name: new RegExp('^은퇴 목표 ') })).not.toBeInTheDocument();
    });

    test('배당 재투자 권장이 현재 설정과 같으면 투자 전략 버튼도 나오지 않는다', () => {
      const params = {
        // 투자 전략 섹션은 간편 모드에서 렌더되지 않으므로 표준 모드로 올린다.
        ...withMode('standard'),
        assets: [{
          id: 'a1', type: 'etf' as const, ticker: 'AAA', name: '자산1', quantity: 1, averagePrice: 1000,
          annualGrowthRate: 6, dividendYield: 2, monthlyContribution: 0,
          reinvestDividend: true, currency: 'KRW' as const,
        }],
      };
      const recommendation = {
        improved: true,
        recommendedPlan: null,
        recommendedAssetReinvestment: { a1: true },
      } as unknown as StrategyRecommendation;

      render(
        <StrategySettingsPanel
          params={params} onChangeParams={vi.fn()}
          recommendation={recommendation} recommendationFailed={false}
        />
      );

      expect(screen.queryByRole('button', { name: new RegExp('^투자 전략 ') })).not.toBeInTheDocument();
    });
  });

  // C4: 지금까지 "클릭 → 실제로 어떤 값이 바뀌는가"가 고정된 섹션은 연금 전략뿐이었다.
  // 은퇴 목표·투자 전략은 버튼 활성/비활성만 검증되어 있어, buildAiSectionPatch가 엉뚱한
  // 필드(예: 목표 상속자산, 자산의 monthlyContribution)를 쓰거나 배수를 반대로 적용해도
  // 전부 통과했다. 아래는 적용 결과 params 전체를 그대로 단정해 그 경로를 막는다.
  describe('AI 추천 적용 — 은퇴 목표', () => {
    const withMultiplier = (monthlySpendingMultiplier: number) => ({
      improved: true,
      recommendedPlan: {
        monthlySpendingMultiplier,
        nationalPensionStartAge: 65,
        isaMaturityDestination: 'pension',
      },
      recommendedAssetReinvestment: null,
    } as unknown as StrategyRecommendation);

    test('생활비 배수를 목표 월 생활비에만 곱해 반올림한 값으로 적용한다', () => {
      const onChangeParams = vi.fn();
      render(
        <StrategySettingsPanel
          params={initialParams} onChangeParams={onChangeParams}
          recommendation={withMultiplier(1.1)} recommendationFailed={false}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: '은퇴 목표 AI 추천' }));

      // 350만 × 1.1 = 385만. params 전체를 단정하므로 strategy나 자산을 함께 건드리면 깨진다.
      expect(onChangeParams).toHaveBeenCalledWith({
        ...initialParams,
        userProfile: { ...initialParams.userProfile, targetMonthlySpending: 3850000 },
      });
    });

    test('배수가 1보다 작으면 생활비를 줄이는 방향으로 적용한다', () => {
      // 배수를 나눗셈으로 쓰거나 부호를 뒤집어도 1.1 케이스만으로는 잡히지 않는다.
      const onChangeParams = vi.fn();
      render(
        <StrategySettingsPanel
          params={initialParams} onChangeParams={onChangeParams}
          recommendation={withMultiplier(0.9)} recommendationFailed={false}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: '은퇴 목표 AI 추천' }));

      expect(onChangeParams).toHaveBeenCalledWith({
        ...initialParams,
        userProfile: { ...initialParams.userProfile, targetMonthlySpending: 3150000 },
      });
    });

    test('배수가 1이면 버튼이 나오지 않는다', () => {
      const onChangeParams = vi.fn();
      render(
        <StrategySettingsPanel
          params={initialParams} onChangeParams={onChangeParams}
          recommendation={withMultiplier(1)} recommendationFailed={false}
        />
      );

      expect(screen.queryByRole('button', { name: new RegExp('^은퇴 목표 ') })).not.toBeInTheDocument();
      expect(onChangeParams).not.toHaveBeenCalled();
    });

    test('추천이 아직 없으면(계산 전) 버튼이 나오지 않는다', () => {
      // 추천 도착 전에 눌렸을 때 recommendedPlan이 undefined인 채로 곱하면
      // targetMonthlySpending이 NaN이 되어 저장되고, 디바운스 자동저장이 그 NaN을 남긴다.
      const onChangeParams = vi.fn();
      render(
        <StrategySettingsPanel
          params={initialParams} onChangeParams={onChangeParams} {...noRecommendation}
        />
      );

      expect(screen.queryByRole('button', { name: new RegExp('^은퇴 목표 ') })).not.toBeInTheDocument();
      expect(onChangeParams).not.toHaveBeenCalled();
    });
  });

  // 투자 전략 섹션은 간편 모드에서 렌더되지 않는다(손댈 수 있는 필드가 없다).
  // 이 섹션의 AI 추천 버튼을 검증하려면 표준 모드 이상이어야 한다.
  describe('AI 추천 적용 — 투자 전략', () => {
    const standardParams = withMode('standard');

    // 권장값이 첫 자산에만 있고 값도 현재와 다르다. 두 번째 자산은 권장 대상이 아니다.
    const reinvestRecommendation = {
      improved: true,
      recommendedPlan: null,
      recommendedAssetReinvestment: { 'asset-kodex200': false },
    } as unknown as StrategyRecommendation;

    test('자산별 배당 재투자 권장값을 해당 자산에만 적용한다', () => {
      const onChangeParams = vi.fn();
      render(
        <StrategySettingsPanel
          params={standardParams} onChangeParams={onChangeParams}
          recommendation={reinvestRecommendation} recommendationFailed={false}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: '투자 전략 AI 추천' }));

      // 권장에 없는 자산까지 일괄로 뒤집거나(전역 스위치식 구현), 자산 순서를 흐트러뜨리면 깨진다.
      expect(onChangeParams).toHaveBeenCalledWith({
        ...standardParams,
        assets: [
          { ...standardParams.assets[0], reinvestDividend: false },
          standardParams.assets[1],
        ],
      });
    });

    test('recommendedPlan이 없어도 배당 재투자 권장만으로 적용된다', () => {
      // recommendedPlan 널 체크를 앞에 두면 "인출계획은 개선 없음 + 재투자만 개선" 상태에서
      // 이 섹션 버튼이 조용히 아무 일도 하지 않는다(Phase 3에서 실제로 났던 결함).
      const onChangeParams = vi.fn();
      render(
        <StrategySettingsPanel
          params={standardParams} onChangeParams={onChangeParams}
          recommendation={reinvestRecommendation} recommendationFailed={false}
        />
      );

      expect(screen.getByRole('button', { name: '투자 전략 AI 추천' })).toBeEnabled();

      fireEvent.click(screen.getByRole('button', { name: '투자 전략 AI 추천' }));

      expect(onChangeParams).toHaveBeenCalledTimes(1);
    });

    test('추천이 아직 없으면(계산 전) 버튼이 나오지 않는다', () => {
      const onChangeParams = vi.fn();
      render(
        <StrategySettingsPanel
          params={standardParams} onChangeParams={onChangeParams} {...noRecommendation}
        />
      );

      expect(screen.queryByRole('button', { name: new RegExp('^투자 전략 ') })).not.toBeInTheDocument();
      expect(onChangeParams).not.toHaveBeenCalled();
    });
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

      // 0.8초까지는 유지된다. 강조가 너무 짧으면 어느 섹션이 바뀌었는지 못 보고 놓친다.
      act(() => { vi.advanceTimersByTime(700); });
      expect(container.querySelectorAll('[data-highlighted]')).toHaveLength(1);

      act(() => { vi.advanceTimersByTime(200); });
      expect(container.querySelectorAll('[data-highlighted]')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
