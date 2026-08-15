import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { initialParams } from '@/infrastructure/storage/localStore';
import { RetirementInputFlow } from '@/web/features/RetirementGoals/RetirementInputFlow';

describe('RetirementInputFlow', () => {
  test('개인정보 → 자산정보 → 은퇴 목표의 기본 입력 순서를 제공한다', () => {
    render(
      <RetirementInputFlow
        params={initialParams}
        onChangeParams={vi.fn()}
        onStartAnalysis={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '1. 개인정보' })).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: '2. 자산정보' }));
    expect(screen.getByRole('button', { name: '2. 자산정보' })).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: '3. 은퇴 목표' }));
    expect(screen.getByRole('button', { name: '3. 은퇴 목표' })).toHaveAttribute('aria-current', 'step');
  });

  // 「분석 시작」이 마지막 단계 맨 아래에 있던 시절에는 목표 카드를 모두 지나쳐 스크롤해야 눌렀다.
  // 이제는 단계 탭 바로 아래에 상주하므로 첫 단계에서도 바로 눌려야 한다.
  test('목표가 유효하면 첫 단계에서도 바로 분석 시작을 호출한다', () => {
    const onStartAnalysis = vi.fn();
    const params = {
      ...initialParams,
      retirementGoals: [
        { type: 'ASSET_SURVIVAL' as const, priority: 1, constraintType: 'HARD' as const },
      ],
    };
    render(
      <RetirementInputFlow
        params={params}
        onChangeParams={vi.fn()}
        onStartAnalysis={onStartAnalysis}
      />
    );

    expect(screen.getByRole('button', { name: '1. 개인정보' })).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: '분석 시작' }));

    expect(onStartAnalysis).toHaveBeenCalledOnce();
  });

  // 분석이 끝나면 같은 설정으로 다시 눌러 봐야 같은 결과가 나온다. 그때도 버튼이 살아 있으면
  // 사용자는 "아직 반영되지 않은 변경이 남아 있다"는 뜻으로 읽는다.
  test('마지막 분석 이후 바뀐 설정이 없으면 분석을 시작할 수 없다', () => {
    const analyzed = {
      ...initialParams,
      retirementGoals: [
        { type: 'ASSET_SURVIVAL' as const, priority: 1, constraintType: 'HARD' as const },
      ],
    };
    const { rerender } = render(
      <RetirementInputFlow
        params={analyzed}
        onChangeParams={vi.fn()}
        onStartAnalysis={vi.fn()}
        analysisIsCurrent
      />
    );

    const startButton = screen.getByRole('button', { name: '분석 시작' });
    expect(startButton).toBeDisabled();
    expect(startButton).toHaveAttribute('title', expect.stringContaining('바뀐 설정이 없습니다'));

    // 설정을 바꾸면 결과가 더 이상 현재 것이 아니므로 호출자가 false를 내려 준다.
    rerender(
      <RetirementInputFlow
        params={{ ...analyzed, userProfile: { ...analyzed.userProfile, currentAge: 52 } }}
        onChangeParams={vi.fn()}
        onStartAnalysis={vi.fn()}
        analysisIsCurrent={false}
      />
    );

    expect(screen.getByRole('button', { name: '분석 시작' })).toBeEnabled();
  });

  test('선택한 목표가 없으면 분석을 시작할 수 없다', () => {
    render(
      <RetirementInputFlow
        params={{ ...initialParams, retirementGoals: [] }}
        onChangeParams={vi.fn()}
        onStartAnalysis={vi.fn()}
      />
    );

    const startButton = screen.getByRole('button', { name: '분석 시작' });
    expect(startButton).toBeDisabled();
    expect(startButton).toHaveAttribute('title', expect.stringContaining('목표를 1개 이상'));
  });

  // 목표는 골랐지만 목표값이 비어 있는 상태는 "고르기만 하면 된다"와 사유가 다르다.
  test('목표는 골랐지만 목표값이 비어 있으면 분석을 시작할 수 없다', () => {
    render(
      <RetirementInputFlow
        params={{
          ...initialParams,
          retirementGoals: [
            { type: 'EARLY_RETIREMENT' as const, priority: 1, constraintType: 'SOFT' as const },
          ],
        }}
        onChangeParams={vi.fn()}
        onStartAnalysis={vi.fn()}
      />
    );

    const startButton = screen.getByRole('button', { name: '분석 시작' });
    expect(startButton).toBeDisabled();
    expect(startButton).toHaveAttribute('title', expect.stringContaining('목표값을 입력'));
  });

  // 단계 이동은 상단 탭이 전담한다. 하단 이동 버튼이 되살아나면 마우스 동선이 다시 길어진다.
  test('하단 이동 버튼 없이 단계 탭만 제공한다', () => {
    render(
      <RetirementInputFlow
        params={initialParams}
        onChangeParams={vi.fn()}
        onStartAnalysis={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /이전/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /다음/ })).toBeNull();
  });
});
