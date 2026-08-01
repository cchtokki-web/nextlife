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

      expect(screen.getByLabelText('현재 나이')).toHaveAttribute('min', '1');
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

    // A3: 하한이 0이면 0세가 저장 가능하고, currentAge 0은 SimulationEngine의
    // totalYears 가드(<= 0)를 통과해 91년짜리 시뮬레이션이 조용히 돈다. 사람 나이의
    // 하한은 1이다(0세 기대수명·0세 은퇴는 어느 것도 의미가 없다).
    test.each([
      ['현재 나이', 'currentAge'],
      ['목표 은퇴 나이', 'retirementAge'],
      ['기대수명', 'expectancy'],
    ] as const)('%s의 음수·0은 1로 클램프한다', (label, key) => {
      const onChangeParams = renderSection();

      fireEvent.change(screen.getByLabelText(label), { target: { value: '-5' } });
      fireEvent.change(screen.getByLabelText(label), { target: { value: '0' } });

      expect(onChangeParams).toHaveBeenCalledTimes(2);
      expect(onChangeParams).toHaveBeenNthCalledWith(1, {
        ...initialParams,
        userProfile: { ...initialParams.userProfile, [key]: 1 },
      });
      expect(onChangeParams).toHaveBeenNthCalledWith(2, {
        ...initialParams,
        userProfile: { ...initialParams.userProfile, [key]: 1 },
      });
    });

    test('배우자 나이·기대수명의 0도 1로 클램프한다', () => {
      const params = { ...initialParams, spouse: { ...DEFAULT_SPOUSE, enabled: true } };
      const onChangeParams = vi.fn();
      render(
        <BasicInfoSection params={params} onChangeParams={onChangeParams} mode="standard" changed={new Set()} />
      );

      fireEvent.change(screen.getByLabelText('배우자 나이'), { target: { value: '0' } });

      expect(onChangeParams).toHaveBeenCalledWith({
        ...params,
        spouse: { ...DEFAULT_SPOUSE, enabled: true, currentAge: 1 },
      });
    });

    // A4: HTML min/max는 Number('')가 상태에 도달하는 것을 막지 못한다. 지우면 0이
    // 저장되어(resolveSpouse가 계산 시 클램프하더라도) 저장값이 조용히 바뀐다.
    test('배우자 수령 개시 나이를 비우면 아무것도 저장하지 않는다', () => {
      const params = { ...initialParams, spouse: { ...DEFAULT_SPOUSE, enabled: true } };
      const onChangeParams = vi.fn();
      render(
        <BasicInfoSection params={params} onChangeParams={onChangeParams} mode="standard" changed={new Set()} />
      );

      fireEvent.change(screen.getByLabelText('배우자 수령 개시 나이'), { target: { value: '' } });

      expect(onChangeParams).not.toHaveBeenCalled();
    });

    test('배우자 수령 개시 나이는 연기 상한(70세)으로 클램프한다', () => {
      const params = { ...initialParams, spouse: { ...DEFAULT_SPOUSE, enabled: true } };
      const onChangeParams = vi.fn();
      render(
        <BasicInfoSection params={params} onChangeParams={onChangeParams} mode="standard" changed={new Set()} />
      );

      fireEvent.change(screen.getByLabelText('배우자 수령 개시 나이'), { target: { value: '99' } });

      expect(onChangeParams).toHaveBeenCalledWith({
        ...params,
        spouse: { ...DEFAULT_SPOUSE, enabled: true, nationalPensionStartAge: 70 },
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
