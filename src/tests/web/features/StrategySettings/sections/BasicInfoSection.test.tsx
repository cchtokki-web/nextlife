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

  // C1: 나이 입력은 디바운스 자동저장(useScenarios)과 겹친다. 값을 지운 상태(Number('') === 0)가
  // 저장되면 E2EE 저장소에 0이 영구히 남고, currentAge 0은 엔진 가드를 통과해 전혀 다른 기간을
  // 계산한다(0~90세 = 91년). 그래서 빈 값은 저장하지 않고 범위 밖 값은 클램프한다.
  describe('나이 입력 가드', () => {
    test.each([
      ['현재 나이'],
      ['목표 은퇴 나이'],
      ['기대수명'],
    ])('%s를 비우면 아무것도 저장하지 않는다', (label) => {
      const onChangeParams = renderSection();

      fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });

      expect(onChangeParams).not.toHaveBeenCalled();
    });

    test('배우자 나이·기대수명을 비워도 아무것도 저장하지 않는다', () => {
      const params = { ...initialParams, spouse: { ...DEFAULT_SPOUSE, enabled: true } };
      const onChangeParams = vi.fn();
      render(
        <BasicInfoSection params={params} onChangeParams={onChangeParams} mode="standard" changed={new Set()} />
      );

      fireEvent.change(screen.getByLabelText('배우자 나이'), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText('배우자 기대수명'), { target: { value: '' } });

      expect(onChangeParams).not.toHaveBeenCalled();
    });

    test('나이 입력에 min/max 범위가 걸려 있다', () => {
      renderSection();

      expect(screen.getByLabelText('현재 나이')).toHaveAttribute('min', '0');
      expect(screen.getByLabelText('현재 나이')).toHaveAttribute('max', '120');
      expect(screen.getByLabelText('목표 은퇴 나이')).toHaveAttribute('max', '120');
      expect(screen.getByLabelText('기대수명')).toHaveAttribute('max', '130');
    });

    test('범위를 벗어난 값은 클램프해서 저장한다', () => {
      const onChangeParams = renderSection();

      fireEvent.change(screen.getByLabelText('기대수명'), { target: { value: '9999' } });

      expect(onChangeParams).toHaveBeenCalledWith({
        ...initialParams,
        userProfile: { ...initialParams.userProfile, expectancy: 130 },
      });
    });

    test('음수는 0으로 클램프한다', () => {
      const onChangeParams = renderSection();

      fireEvent.change(screen.getByLabelText('현재 나이'), { target: { value: '-5' } });

      expect(onChangeParams).toHaveBeenCalledWith({
        ...initialParams,
        userProfile: { ...initialParams.userProfile, currentAge: 0 },
      });
    });
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
