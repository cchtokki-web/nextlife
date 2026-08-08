import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BasicInfoSection } from '@/web/features/StrategySettings/sections/BasicInfoSection';
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

  test('본인 나이 입력 3개 외에는 스위치나 다른 입력을 렌더하지 않는다', () => {
    renderSection();

    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
  });

  test('현재 나이를 바꾸면 userProfile.currentAge만 바뀐 params로 호출된다', () => {
    const onChangeParams = renderSection();

    fireEvent.change(screen.getByLabelText('현재 나이'), { target: { value: '48' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      userProfile: { ...initialParams.userProfile, currentAge: 48 },
    });
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
  });
});
