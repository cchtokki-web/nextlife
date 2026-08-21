import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PensionStrategySection } from '@/web/features/StrategySettings/sections/PensionStrategySection';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';
import { NationalPensionStrategy } from '@/core/entities/types';

const noAi = { recommendation: null, error: null, improved: false };

describe('PensionStrategySection', () => {
  test('국민연금 전략 6개(조기수령 포함)와 사적연금 전략 5개를 렌더링한다', () => {
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    // 두 그룹 모두 '자동으로 선택' 옵션을 가지므로 그룹으로 좁혀 찾는다.
    const national = within(screen.getByRole('radiogroup', { name: '국민연금 수령 시작' }));
    for (const label of [/조기 수령/, /예상 수령/, /1년 연기/, /2년 연기/, /최대 연기/, /자동으로 선택/]) {
      expect(national.getByRole('radio', { name: label })).toBeInTheDocument();
    }

    const priv = within(screen.getByRole('radiogroup', { name: '사적연금 인출 전략' }));
    for (const label of [/절세 우선/, /생활비 우선/, /자산 성장 우선/, /최소 인출/, /자동으로 선택/]) {
      expect(priv.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  test('국민연금 전략을 고르면 strategy에 반영된다', () => {
    const onChangeParams = vi.fn();
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '국민연금 수령 시작' }))
        .getByRole('radio', { name: /최대 연기/ })
    );

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'defer_max' },
    });
  });

  test('ISA 만기 행선지 3택과 배당 재투자 3택을 렌더링한다', () => {
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    // 예전에는 boolean 스위치였다. boolean에는 "미정"을 담을 자리가 없어 이 축만
    // AI 자동 채움에서 통째로 빠져 있었다.
    const isa = within(screen.getByRole('radiogroup', { name: 'ISA 만기 자금 행선지' }));
    for (const label of [/연금 계좌로/, /일반 자산으로/, /자동으로 선택/]) {
      expect(isa.getByRole('radio', { name: label })).toBeInTheDocument();
    }
    // 배당 재투자도 같은 이유로 스위치에서 3택이 됐다. boolean에는 「AI에게 맡김」을 담을
    // 자리가 없어, 사용자가 한 번도 고른 적 없는데도 항상 켬/끔 중 하나를 명시적으로
    // 고른 것처럼 취급됐다.
    const dividend = within(screen.getByRole('radiogroup', { name: '배당금 재투자' }));
    for (const label of [/자동으로 선택/, /전부 재투자/, /전부 현금 수령/]) {
      expect(dividend.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  // 자산 배열을 직접 갈아치우지 않는다. 저장된 자산별 값은 「자동으로 선택」에서 기준선으로
  // 쓰이므로, 축을 바꿨다고 지워 버리면 되돌릴 방법이 없다. 실체화는 compileStrategy가 한다.
  test('「전부 현금 수령」을 고르면 전략 축만 바뀌고 자산은 그대로다', () => {
    const onChangeParams = vi.fn();
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '배당금 재투자' }))
        .getByRole('radio', { name: /전부 현금 수령/ })
    );

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, dividendStrategy: 'cash_all' },
    });
  });

  test('「자동으로 선택」인데 자산별 설정이 갈리면 그 사실을 안내한다', () => {
    const mixed = {
      ...initialParams,
      assets: [
        { ...initialParams.assets[0], reinvestDividend: true },
        { ...initialParams.assets[1], reinvestDividend: false },
      ],
    };

    render(
      <PensionStrategySection
        params={mixed} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    expect(
      within(screen.getByRole('radiogroup', { name: '배당금 재투자' }))
        .getByRole('radio', { name: /자동으로 선택/ })
    ).toBeChecked();
    expect(screen.getByText(/자산마다 저장된 설정이 다릅니다/)).toBeInTheDocument();
  });

  test('AI가 연기 수령을 추천하면 힌트를 표시한다', () => {
    const ai = {
      recommendation: { improved: true, recommendedPlan: { nationalPensionStartAge: 70 } } as never,
      error: null, improved: true,
    };

    render(
      <PensionStrategySection
        // 엔진에 실제로 들어간 나이가 추천 나이와 같으므로 "제안"이 아니라 "적용"이다.
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={ai}
        effectiveNationalPensionStartAge={70}
      />
    );

    expect(screen.getByText('자동 반영 중: 70세부터 수령')).toBeInTheDocument();
  });

  // B2: 사적연금 월 인출 목표는 적용되지 않을 뿐 아니라 이 화면의 선택지로는 표현조차 되지
  // 않는다. 후보 격자는 targetMonthlySpending × {0.8, 1.0, 1.3}이고 표현 가능한 값은
  // privatePensionLimit/12 × {1, 0.5, 0.25}라 교집합이 없다. 적용할 수 없는 값을 "AI 추천"으로
  // 보여주면 사용자는 추천을 따르려고 눌렀다가 아무 일도 일어나지 않는 것을 보게 된다.
  test('적용할 수 없는 사적연금 월 인출 목표는 힌트로 보여주지 않는다', () => {
    const ai = {
      recommendation: {
        improved: true,
        recommendedPlan: { nationalPensionStartAge: 70, privatePensionMonthlyTarget: 2800000 },
      } as never,
      error: null, improved: true,
    };

    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={ai}
      />
    );

    expect(screen.queryByText(/만원 인출/)).not.toBeInTheDocument();
  });

  test('간편 모드에서도 국민연금/사적연금 전략은 보인다', () => {
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="simple" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.getByRole('radio', { name: /최대 연기/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /절세 우선/ })).toBeInTheDocument();
  });

  test('간편 모드에서는 ISA 스위치가 숨겨진다', () => {
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="simple" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.queryByRole('switch', { name: /ISA 먼저 사용/ })).not.toBeInTheDocument();
  });

  describe('국민연금 AI 힌트', () => {
    // 이 컴포넌트가 recommendedPlan에서 읽는 필드는 nationalPensionStartAge 하나뿐이라,
    // 기존 'AI가 연기 수령을 추천하면 힌트를 표시한다' 테스트(99행)와 같은 방식으로
    // 필요한 필드만 채우고 나머지는 as never로 넘긴다.
    const aiWithAge = (nationalPensionStartAge: number) => ({
      recommendation: { improved: true, recommendedPlan: { nationalPensionStartAge } } as never,
      error: null, improved: true,
    });

    const paramsWith = (nationalPensionStrategy: NationalPensionStrategy) => ({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy },
    });

    // 판정 기준은 전략 enum이 아니라 "엔진에 실제로 들어간 나이"다. enum으로 판정하면
    // 자동 채움이 개선을 확인하지 못해 채우지 않은 경우에도 '적용'이라 말하고, 반대로
    // 사용자가 「AI 추천」 버튼으로 확정 전략을 고른 직후에는 그 값이 실제로 계산에
    // 들어가는데도 '추천'으로 내려간다.
    test("추천 나이가 실제로 계산에 들어가 있으면 '적용'으로 표시한다", () => {
      render(
        <PensionStrategySection
          params={paramsWith('ai_optimized')} onChangeParams={vi.fn()}
          mode="standard" changed={new Set()} ai={aiWithAge(68)}
          effectiveNationalPensionStartAge={68}
        />
      );

      expect(screen.getByText('자동 반영 중: 68세부터 수령')).toBeInTheDocument();
    });

    test("센티널이어도 자동 채움이 걸러 baseline으로 돌면 '추천'으로 표시한다", () => {
      // 나이 축만 떼어 내면 악화되는 추천은 applyAiSentinels가 채우지 않는다.
      // 그때 엔진은 65세로 돌고 있으므로 68세는 아직 제안일 뿐이다.
      render(
        <PensionStrategySection
          params={paramsWith('ai_optimized')} onChangeParams={vi.fn()}
          mode="standard" changed={new Set()} ai={aiWithAge(68)}
          effectiveNationalPensionStartAge={65}
        />
      );

      expect(screen.getByText('추천값 있음: 68세부터 수령')).toBeInTheDocument();
    });

    test("확정 전략이라도 그 값이 추천과 같으면 '적용'으로 표시한다", () => {
      // 「AI 추천」 버튼을 눌러 defer_max(70세)로 바꾼 직후의 상태. 방금 적용했는데
      // 배지가 '추천'으로 내려가면 사용자 멘탈 모델의 정반대다.
      render(
        <PensionStrategySection
          params={paramsWith('defer_max')} onChangeParams={vi.fn()}
          mode="standard" changed={new Set()} ai={aiWithAge(70)}
          effectiveNationalPensionStartAge={70}
        />
      );

      expect(screen.getByText('자동 반영 중: 70세부터 수령')).toBeInTheDocument();
    });

    test('확정 전략이 추천과 다르면 "추천" 문구로 표시한다', () => {
      render(
        <PensionStrategySection
          params={paramsWith('defer_max')} onChangeParams={vi.fn()}
          mode="standard" changed={new Set()} ai={aiWithAge(68)}
          effectiveNationalPensionStartAge={70}
        />
      );

      expect(screen.getByText('추천값 있음: 68세부터 수령')).toBeInTheDocument();
    });

    test('추천이 없으면 힌트를 표시하지 않는다', () => {
      render(
        <PensionStrategySection
          params={paramsWith('ai_optimized')} onChangeParams={vi.fn()}
          mode="standard" changed={new Set()} ai={noAi}
        />
      );

      expect(screen.queryByText(/68세부터 수령/)).not.toBeInTheDocument();
    });
  });

  // 추천 계산이 실패하면 '자동으로 선택'는 채워질 값이 없어 baseline으로 계산된다. 그 사실을
  // 말하지 않으면 정상적으로 "개선 여지 없음"이 나온 경우와 화면이 픽셀 단위로 같아진다.
  describe('추천 계산 실패 안내', () => {
    const failed = { recommendation: null, error: '추천을 계산하지 못했습니다.', improved: false } as never;

    test("'자동으로 선택' 상태에서 추천이 실패하면 기본값으로 계산했다고 알린다", () => {
      render(
        <PensionStrategySection
          params={{ ...initialParams, strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'ai_optimized' } }}
          onChangeParams={vi.fn()}
          mode="standard" changed={new Set()} ai={failed}
        />
      );

      expect(screen.getByText(/기본값\(65세\)으로 계산했습니다/)).toBeInTheDocument();
    });

    test('확정 전략을 고른 상태면 추천이 실패해도 안내하지 않는다', () => {
      // 사용자가 직접 고른 나이로 도는 중이라 알릴 것이 없다.
      render(
        <PensionStrategySection
          params={{ ...initialParams, strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'defer_max' } }}
          onChangeParams={vi.fn()}
          mode="standard" changed={new Set()} ai={failed}
        />
      );

      // '기본값'만으로 찾으면 사적연금 선택지 설명("…엔진 기본값을 그대로 따릅니다")에 걸린다.
      expect(screen.queryByText(/계산했습니다/)).not.toBeInTheDocument();
    });
  });
});
