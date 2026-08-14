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

  test('유효한 목표를 선택한 상태에서 분석 시작을 호출한다', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '3. 은퇴 목표' }));
    fireEvent.click(screen.getByRole('button', { name: '분석 시작' }));

    expect(onStartAnalysis).toHaveBeenCalledOnce();
  });

  test('선택한 목표가 없으면 분석을 시작할 수 없다', () => {
    render(
      <RetirementInputFlow
        params={{ ...initialParams, retirementGoals: [] }}
        onChangeParams={vi.fn()}
        onStartAnalysis={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '3. 은퇴 목표' }));

    expect(screen.getByRole('button', { name: '분석 시작' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('목표를 1개 이상 선택');
  });
});
