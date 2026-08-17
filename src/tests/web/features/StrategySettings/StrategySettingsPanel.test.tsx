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

const reviewAndApplyRecommendation = (section: '연금 전략') => {
  fireEvent.click(screen.getByRole('button', { name: `${section} 추천값 반영` }));
  expect(screen.getByRole('dialog', { name: '추천값을 반영할까요?' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '추천값 반영' }));
};

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

    // 「기본 정보」·「은퇴 목표」 섹션은 없다 — 현재 나이·기대수명은 「개인정보」 단계가,
    // 은퇴 나이·목표 생활비·상속 목표는 「은퇴 목표」 카드가 유일한 편집 경로다.
    test('전문가 모드에서는 4개 섹션이 모두 보인다', () => {
      const has = renderIn('expert');

      expect(has('기본 정보')).toBe(false);
      expect(has('은퇴 목표')).toBe(false);
      for (const title of ['연금 전략', '투자 전략', '경제 가정', '고급 설정']) {
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
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'defer_max' as const },
    };

    render(<StrategySettingsPanel params={params} onChangeParams={vi.fn()} {...noRecommendation} />);

    expect(screen.getByText('1개 변경')).toBeInTheDocument();
  });

  // 나이를 바꿔도 이 패널은 아무것도 세지 않는다. 세는 순간 「개인정보」 단계에서만
  // 되돌릴 수 있는 배지가 패널에 붙어, 펼쳐도 지울 방법이 없는 상태가 된다.
  test('개인정보 단계가 소유한 나이는 이 패널에 배지를 만들지 않는다', () => {
    const params = {
      ...initialParams,
      userProfile: { ...initialParams.userProfile, currentAge: 42, expectancy: 95 },
    };

    render(<StrategySettingsPanel params={params} onChangeParams={vi.fn()} {...noRecommendation} />);

    expect(screen.queryByText(/개 변경/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('hidden-section-notice')).not.toBeInTheDocument();
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

    // 보이는 섹션 안의 숨은 필드(간편 모드에서 렌더되지 않는 'ISA 만기 자금')는 섹션 헤더가
    // 아니라 요약이 책임진다. 헤더에 합산하면 "1개 변경"이 떠 있는데 펼쳐도 되돌릴 항목이
    // 하나도 없는 상태가 된다 — 사용자가 찾을 수 없는 개수를 세는 셈이다.
    test('보이는 섹션의 숨은 필드는 섹션 헤더가 아니라 요약이 센다', () => {
      const params = {
        ...initialParams,
        strategy: { ...DEFAULT_RETIREMENT_STRATEGY, preferIsaFirst: 'isa_first' as const },
      };

      render(<StrategySettingsPanel params={params} onChangeParams={vi.fn()} {...noRecommendation} />);

      expect(screen.queryByText('1개 변경')).not.toBeInTheDocument();
      expect(notice()).toHaveTextContent('숨겨진 사용자 설정 1개');
    });

    // 한 섹션에 보이는 변경과 숨은 변경이 함께 있으면 각자 제 자리에서 보고된다.
    // '국민연금 수령 시작'(간편 모드에서 보임) → 섹션 배지 1개,
    // 'ISA 만기 자금'(간편 모드에서 숨김) → 요약 1개.
    test('보이는 변경은 섹션 배지가, 숨은 변경은 요약이 각각 센다', () => {
      const params = {
        ...initialParams,
        strategy: {
          ...DEFAULT_RETIREMENT_STRATEGY,
          nationalPensionStrategy: 'defer_max' as const,
          preferIsaFirst: 'isa_first' as const,
        },
      };

      render(<StrategySettingsPanel params={params} onChangeParams={vi.fn()} {...noRecommendation} />);

      expect(screen.getByText('1개 변경')).toBeInTheDocument();
      expect(notice()).toHaveTextContent('숨겨진 사용자 설정 1개');
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

    reviewAndApplyRecommendation('연금 전략');

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: {
        ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'early', preferIsaFirst: 'pension_first',
      },
    });
  });

  // page.tsx가 이미 recommendStrategy를 돌린다. 패널이 또 돌리면 이 앱에서 가장 무거운
  // 계산(최대 218개 후보 시뮬레이션)이 params 변경마다 두 번 실행된다.
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

  test('자동 반영값과 아직 반영할 수 있는 추천을 한곳에서 요약한다', () => {
    const recommendation = {
      improved: true,
      recommendedPlan: {
        nationalPensionStartAge: 70,
        isaMaturityDestination: 'asset',
        monthlySpendingMultiplier: 1.1,
      },
      recommendedAssetReinvestment: null,
    } as unknown as StrategyRecommendation;

    render(
      <StrategySettingsPanel
        params={initialParams} onChangeParams={vi.fn()}
        recommendation={recommendation} recommendationFailed={false}
        sentinels={{
          compiled: {} as never,
          appliedFields: ['nationalPensionStartAge', 'isaMaturityDestination'],
          appliedValues: { nationalPensionStartAge: 70, isaMaturityDestination: 'asset' },
        }}
      />
    );

    expect(screen.getByText('추천 설정 현황')).toBeInTheDocument();
    // 생활비 배수는 더 이상 이 패널이 적용하지 않는다(목표 월 생활비는 「은퇴 목표」 카드의 값이다).
    // 연금 축은 센티널이 이미 같은 값을 반영 중이라 남는 추천이 없다.
    expect(screen.getByText(/자동 반영 중 2개 · 반영 가능한 추천 0개/)).toBeInTheDocument();
    expect(screen.getByText('현재 계산값 · 국민연금: 70세부터 수령')).toBeInTheDocument();
    expect(screen.getByText('현재 계산값 · ISA 만기 자금: 일반 자산으로')).toBeInTheDocument();
  });

  test('추천값 반영 전 변경 내용을 보여주고 취소하면 설정을 바꾸지 않는다', () => {
    const onChangeParams = vi.fn();
    const recommendation = {
      improved: true,
      recommendedPlan: {
        nationalPensionStartAge: 70,
        isaMaturityDestination: 'asset',
      },
      recommendedAssetReinvestment: null,
    } as unknown as StrategyRecommendation;

    render(
      <StrategySettingsPanel
        params={initialParams} onChangeParams={onChangeParams}
        recommendation={recommendation} recommendationFailed={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '연금 전략 추천값 반영' }));
    expect(screen.getByText('국민연금 수령 시작 65세 → 70세')).toBeInTheDocument();
    expect(onChangeParams).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChangeParams).not.toHaveBeenCalled();
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

    test('AI 센티널이 이미 추천 나이를 채워 넣었으면 연금 전략 버튼을 내지 않는다', () => {
      // 센티널 사용자('ai_optimized')는 전략 enum이 nearest('defer_max')와 항상 달라서,
      // enum으로 판정하면 버튼이 계속 열린다. 눌러도 컴파일 결과가 같아 대시보드 숫자는
      // 하나도 움직이지 않고 배지만 '적용'에서 '추천'으로 내려간다.
      const deferRecommendation = {
        improved: true,
        recommendedPlan: {
          nationalPensionStartAge: 70, isaMaturityDestination: 'pension',
          monthlySpendingMultiplier: 1,
        },
        recommendedAssetReinvestment: null,
      } as unknown as StrategyRecommendation;

      const sentinelParams = {
        ...initialParams,
        strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'ai_optimized' as const },
      };

      render(
        <StrategySettingsPanel
          params={sentinelParams}
          onChangeParams={vi.fn()}
          recommendation={deferRecommendation}
          recommendationFailed={false}
          sentinels={{
            compiled: {} as never,
            appliedFields: ['nationalPensionStartAge'],
            appliedValues: { nationalPensionStartAge: 70 },
          }}
        />
      );

      expect(screen.queryByRole('button', { name: new RegExp('^연금 전략 ') })).not.toBeInTheDocument();
    });

    test('센티널이 걸러 채우지 않았으면 연금 전략 버튼은 그대로 나온다', () => {
      // 자동 채움이 악화를 이유로 채우지 않은 경우. 엔진은 65세로 돌고 있으므로
      // 사용자가 직접 70세를 고를 여지가 남아 있다.
      const deferRecommendation = {
        improved: true,
        recommendedPlan: {
          nationalPensionStartAge: 70, isaMaturityDestination: 'pension',
          monthlySpendingMultiplier: 1,
        },
        recommendedAssetReinvestment: null,
      } as unknown as StrategyRecommendation;

      const sentinelParams = {
        ...initialParams,
        strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'ai_optimized' as const },
      };

      render(
        <StrategySettingsPanel
          params={sentinelParams}
          onChangeParams={vi.fn()}
          recommendation={deferRecommendation}
          recommendationFailed={false}
          sentinels={{ compiled: {} as never, appliedFields: [], appliedValues: {} }}
        />
      );

      expect(screen.getByRole('button', { name: '연금 전략 추천값 반영' })).toBeEnabled();
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

      expect(screen.getByRole('button', { name: '연금 전략 추천값 반영' })).toBeEnabled();
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

  // 생활비 배수를 적용하던 「은퇴 목표」 섹션은 사라졌다. AI가 권하는 목표 생활비를 이 패널이
  // 바꿀 수 없다는 사실 자체를 고정한다 — 되살리면 화면에 없는 필드를 바꾸는 버튼이 된다.
  describe('AI 추천 적용 — 목표 월 생활비는 이 패널이 바꾸지 않는다', () => {
    const withMultiplier = (monthlySpendingMultiplier: number) => ({
      improved: true,
      recommendedPlan: {
        monthlySpendingMultiplier,
        nationalPensionStartAge: 65,
        isaMaturityDestination: 'pension',
      },
      recommendedAssetReinvestment: null,
    } as unknown as StrategyRecommendation);

    test('생활비 배수가 있어도 적용 버튼을 내지 않는다', () => {
      const onChangeParams = vi.fn();
      render(
        <StrategySettingsPanel
          params={initialParams} onChangeParams={onChangeParams}
          recommendation={withMultiplier(1.1)} recommendationFailed={false}
        />
      );

      expect(screen.queryByRole('button', { name: new RegExp('^은퇴 목표 ') })).not.toBeInTheDocument();
      // 「연금 전략」은 이미 추천과 같은 상태라 여기서도 누를 것이 없어야 한다.
      expect(screen.queryByRole('button', { name: '연금 전략 추천값 반영' })).not.toBeInTheDocument();
      expect(onChangeParams).not.toHaveBeenCalled();
    });
  });

  // 배당 재투자는 「연금 전략」 섹션의 스위치가 실제 컨트롤이고, 그 섹션은 모든 모드에서
  // 보인다. 적용 버튼도 같은 섹션에 있어야 한다 — 예전에는 「투자 전략」 헤더에 있었는데,
  // 그 섹션이 간편 모드에서 통째로 사라지면서 기본 모드 사용자에게 적용 경로가 0개가 됐다.
  describe('AI 추천 적용 — 배당 재투자', () => {
    const reinvestOnly = {
      improved: true,
      recommendedPlan: null,
      recommendedAssetReinvestment: { 'asset-kodex200': false },
    } as unknown as StrategyRecommendation;

    test('간편 모드에서도 배당 재투자 추천을 적용할 수 있다', () => {
      const onChangeParams = vi.fn();
      const simpleParams = withMode('simple');

      render(
        <StrategySettingsPanel
          params={simpleParams} onChangeParams={onChangeParams}
          recommendation={reinvestOnly} recommendationFailed={false}
        />
      );

      // 대시보드는 간편 모드에서도 "배당을 재투자로 전환합니다"를 제시한다.
      // 그 지시를 실행할 컨트롤이 화면에 있어야 한다.
      reviewAndApplyRecommendation('연금 전략');

      expect(onChangeParams).toHaveBeenCalledWith({
        ...simpleParams,
        assets: [
          { ...simpleParams.assets[0], reinvestDividend: false },
          simpleParams.assets[1],
        ],
      });
    });

    test('간편 모드에서도 「연금 전략」을 펼치면 배당 재투자 스위치가 있다', () => {
      render(
        <StrategySettingsPanel
          params={withMode('simple')} onChangeParams={vi.fn()}
          recommendation={reinvestOnly} recommendationFailed={false}
        />
      );

      // 섹션은 접힌 채 마운트되므로 펼쳐야 본문이 렌더된다. 제목 텍스트로 조회하면 동명의
      // AI 추천 버튼에 걸리므로 토글 버튼(aria-expanded)으로 찾는다.
      const toggles = screen.getAllByRole('button', { expanded: false });
      const pensionToggle = toggles.find((b) => b.textContent?.includes('연금 전략'));
      fireEvent.click(pensionToggle!);

      expect(screen.getByText('배당금 재투자')).toBeInTheDocument();
    });
  });

  // 배당 재투자 적용은 「연금 전략」 헤더 버튼이 담당한다(실제 스위치가 그 섹션에 있다).
  describe('AI 추천 적용 — 배당 재투자 세부', () => {
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

      reviewAndApplyRecommendation('연금 전략');

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

      expect(screen.getByRole('button', { name: '연금 전략 추천값 반영' })).toBeEnabled();

      reviewAndApplyRecommendation('연금 전략');

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
      expect(screen.getByRole('button', { expanded: false, name: /투자 전략/ })).toBeInTheDocument();
    });
  });

  test('섹션에서 값을 바꾸면 그 섹션이 잠깐 강조되고 시간이 지나면 해제된다', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <StrategySettingsPanel params={initialParams} onChangeParams={vi.fn()} {...noRecommendation} />
      );

      fireEvent.click(screen.getByRole('button', { name: /연금 전략/ }));
      fireEvent.click(screen.getByRole('radio', { name: /최대 연기/ }));

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

  // 배지의 '적용/추천' 판정은 패널이 계산해 섹션에 내려준다. PensionStrategySection 테스트는
  // 그 값을 직접 주입하므로 컴포넌트 계약만 검증하고 이 배선은 덮지 못한다.
  describe('AI 배지 판정 배선', () => {
    const deferRecommendation = {
      improved: true,
      recommendedPlan: { nationalPensionStartAge: 70, isaMaturityDestination: 'pension', monthlySpendingMultiplier: 1 },
      recommendedAssetReinvestment: null,
    } as unknown as StrategyRecommendation;

    const expandPension = () => {
      const toggles = screen.getAllByRole('button', { expanded: false });
      fireEvent.click(toggles.find((b) => b.textContent?.includes('연금 전략'))!);
    };

    test("확정 전략을 고르면 자동 채움이 없어도 '적용'으로 표시한다", () => {
      // 사용자가 「AI 추천」 버튼으로 defer_max(70세)를 고른 직후의 상태다. 센티널은 더 이상
      // 개입하지 않지만 엔진은 70세로 돈다 — 방금 적용한 값을 '추천'이라 부르면 안 된다.
      render(
        <StrategySettingsPanel
          params={{ ...initialParams, strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'defer_max' } }}
          onChangeParams={vi.fn()}
          recommendation={deferRecommendation}
          recommendationFailed={false}
          sentinels={{ compiled: {} as never, appliedFields: [], appliedValues: {} }}
        />
      );
      expandPension();

      expect(screen.getByText('자동 반영 중: 70세부터 수령')).toBeInTheDocument();
    });

    test("센티널이 걸러 baseline으로 돌면 '추천'으로 표시한다", () => {
      // 'ai_optimized'인데 자동 채움이 악화를 이유로 채우지 않은 경우. 엔진은 65세로 돈다.
      render(
        <StrategySettingsPanel
          params={{ ...initialParams, strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'ai_optimized' } }}
          onChangeParams={vi.fn()}
          recommendation={deferRecommendation}
          recommendationFailed={false}
          sentinels={{ compiled: {} as never, appliedFields: [], appliedValues: {} }}
        />
      );
      expandPension();

      expect(screen.getByText('추천값 있음: 70세부터 수령')).toBeInTheDocument();
    });

    test('자동 채움이 일어나면 그 값으로 판정한다', () => {
      render(
        <StrategySettingsPanel
          params={{ ...initialParams, strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'ai_optimized' } }}
          onChangeParams={vi.fn()}
          recommendation={deferRecommendation}
          recommendationFailed={false}
          sentinels={{ compiled: {} as never, appliedFields: ['nationalPensionStartAge'], appliedValues: { nationalPensionStartAge: 70 } }}
        />
      );
      expandPension();

      expect(screen.getByText('자동 반영 중: 70세부터 수령')).toBeInTheDocument();
    });
  });
});
