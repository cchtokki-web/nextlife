import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BasicInfoSection } from '@/web/features/StrategySettings/sections/BasicInfoSection';
import { DEFAULT_SPOUSE } from '@/web/features/StrategySettings/strategyOptions';
import { initialParams } from '@/infrastructure/storage/localStore';

const renderSection = (params = initialParams, onChangeParams = vi.fn()) => {
  render(
    <BasicInfoSection
      params={params}
      onChangeParams={onChangeParams}
      mode="standard"
      changed={new Set()}
    />
  );
  return onChangeParams;
};

describe('BasicInfoSection', () => {
  test('현재 나이·은퇴 나이·기대수명을 표시한다', () => {
    renderSection();

    expect(screen.getByLabelText('현재 나이')).toHaveValue(50);
    expect(screen.getByLabelText('목표 은퇴 나이')).toHaveValue(60);
    expect(screen.getByLabelText('기대수명')).toHaveValue(85);
  });

  test('현재 나이를 바꾸면 userProfile.currentAge만 바뀐 params로 호출된다', () => {
    const onChangeParams = renderSection();

    fireEvent.change(screen.getByLabelText('현재 나이'), { target: { value: '48' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      userProfile: { ...initialParams.userProfile, currentAge: 48 },
    });
  });

  test('배우자 스위치가 꺼져 있으면 배우자 입력이 보이지 않는다', () => {
    renderSection();

    expect(screen.queryByLabelText('배우자 나이')).not.toBeInTheDocument();
  });

  test('배우자 스위치를 켜면 기본 배우자 프로필이 저장된다', () => {
    const onChangeParams = renderSection();

    fireEvent.click(screen.getByRole('switch', { name: /배우자 포함/ }));

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      spouse: { ...DEFAULT_SPOUSE, enabled: true },
    });
  });

  test('배우자가 켜져 있으면 나이·기대수명·국민연금 입력이 보인다', () => {
    const params = { ...initialParams, spouse: { ...DEFAULT_SPOUSE, enabled: true, currentAge: 48 } };
    render(
      <BasicInfoSection params={params} onChangeParams={vi.fn()} mode="standard" changed={new Set()} />
    );

    expect(screen.getByLabelText('배우자 나이')).toHaveValue(48);
    expect(screen.getByLabelText('배우자 기대수명')).toBeInTheDocument();
    expect(screen.getByLabelText('배우자 국민연금 예상 월 수령액')).toBeInTheDocument();
  });

  test('배우자 기대수명이 현재 나이보다 작으면 경고를 표시한다', () => {
    const params = {
      ...initialParams,
      spouse: { ...DEFAULT_SPOUSE, enabled: true, currentAge: 60, expectancy: 55 },
    };
    render(
      <BasicInfoSection params={params} onChangeParams={vi.fn()} mode="standard" changed={new Set()} />
    );

    expect(screen.getByText(/기대수명이 현재 나이보다 작습니다/)).toBeInTheDocument();
  });

  test('changed에 포함된 경로는 "사용자 설정" 배지를 받는다', () => {
    render(
      <BasicInfoSection
        params={initialParams}
        onChangeParams={vi.fn()}
        mode="standard"
        changed={new Set(['userProfile.currentAge'])}
      />
    );

    expect(screen.getAllByText('사용자 설정')).toHaveLength(1);
  });
});
