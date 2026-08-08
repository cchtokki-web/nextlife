import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BasicInfoSection } from '@/web/features/StrategySettings/sections/BasicInfoSection';
import { createDefaultSpouse } from '@/web/features/StrategySettings/strategyOptions';
import { initialParams } from '@/infrastructure/storage/localStore';

// 기본 시나리오(본인 50세 / 기대수명 85세) 기준 배우자 기본값. 예전 고정값과 같은 50/90이다.
const DEFAULT_SPOUSE = createDefaultSpouse(initialParams.userProfile);

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

  // B3: 고정 기본값(50세/90세)은 65세 사용자가 스위치를 켜는 순간
  // deathAtSelfAge = 65 + (90 - 50) = 105를 만들어 시뮬레이션이 105세까지 돈다.
  // householdEndAge가 depletionAge·endingAssets·depletionSafety를 좌우하므로 파급이 크다.
  describe('배우자 기본값은 본인 값에서 유도한다', () => {
    test('65세 사용자가 스위치를 켜면 배우자 나이가 본인 나이에서 시작한다', () => {
      const params = {
        ...initialParams,
        userProfile: { ...initialParams.userProfile, currentAge: 65, expectancy: 88 },
      };
      const onChangeParams = renderSection(params);

      fireEvent.click(screen.getByRole('switch', { name: /배우자 포함/ }));

      expect(onChangeParams).toHaveBeenCalledWith({
        ...params,
        spouse: {
          enabled: true,
          currentAge: 65,
          expectancy: 93, // 본인 기대수명 + 5년(여성 기대수명이 더 길다는 통계)
        },
      });
    });

    test('기대수명 상한을 넘기지 않는다', () => {
      const params = {
        ...initialParams,
        userProfile: { ...initialParams.userProfile, currentAge: 60, expectancy: 128 },
      };
      const onChangeParams = renderSection(params);

      fireEvent.click(screen.getByRole('switch', { name: /배우자 포함/ }));

      expect(onChangeParams).toHaveBeenCalledWith(
        expect.objectContaining({
          spouse: expect.objectContaining({ expectancy: 130 }),
        })
      );
    });
  });

  // 배우자 명의 국민연금을 다루지 않게 되면서 입력이 다섯 개에서 셋으로 줄었다.
  // 남는 것은 가구 종료 나이·생활비 축소 계수를 정하는 나이 두 개뿐이다.
  test('배우자가 켜져 있으면 나이·기대수명만 보이고 연금 입력은 없다', () => {
    const params = { ...initialParams, spouse: { ...DEFAULT_SPOUSE, enabled: true, currentAge: 48 } };
    render(
      <BasicInfoSection params={params} onChangeParams={vi.fn()} mode="standard" changed={new Set()} />
    );

    expect(screen.getByLabelText('배우자 나이')).toHaveValue(48);
    expect(screen.getByLabelText('배우자 기대수명')).toBeInTheDocument();
    expect(screen.queryByLabelText('배우자 국민연금 예상 월 수령액')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('배우자 수령 개시 나이')).not.toBeInTheDocument();
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

  });
});
