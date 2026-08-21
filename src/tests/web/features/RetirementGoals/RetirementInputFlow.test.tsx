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
    // 사유는 «보여야» 한다. title만으로는 터치 기기·스크린리더에 도달하지 않는다.
    expect(screen.getByText(/바뀐 설정이 없습니다/)).toBeInTheDocument();

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
    expect(screen.getByText(/목표를 1개 이상/)).toBeInTheDocument();
    // 사유 문단과 버튼이 실제로 연결되어야 보조기술이 함께 읽는다.
    expect(startButton).toHaveAttribute('aria-describedby', 'analysis-blocked-reason');
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
    expect(screen.getByText(/목표값을 입력/)).toBeInTheDocument();
  });

  // 카드 시드가 «정규화된» 프로필에서 와야 한다. 저장된 옛 은퇴 나이를 그대로 시드하면
  // 「빠른 은퇴」를 처음 고른 순간 카드에는 58세가 찍히는데 계산은 65세로 돌고 있어,
  // 카드가 계산을 설명하지 못한다.
  test('「빠른 은퇴」를 처음 고르면 계산에 쓰이는 은퇴 나이가 시드된다', () => {
    const onChangeParams = vi.fn();
    render(
      <RetirementInputFlow
        params={{
          ...initialParams,
          userProfile: { ...initialParams.userProfile, retirementAge: 58 },
          retirementGoals: [
            { type: 'ASSET_SURVIVAL' as const, priority: 1, constraintType: 'HARD' as const },
          ],
        }}
        onChangeParams={onChangeParams}
        onStartAnalysis={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '3. 은퇴 목표' }));
    fireEvent.click(screen.getByRole('button', { name: /빠른 은퇴/ }));

    const next = onChangeParams.mock.calls[0][0];
    expect(next.retirementGoals.find((goal: { type: string }) => goal.type === 'EARLY_RETIREMENT'))
      .toMatchObject({ targetValue: 65 });
  });

  // 현재 나이·기대수명은 이 단계가 «유일한» 편집 경로다. 고급/전문가 설정 패널에 같은
  // 입력을 되살리면 같은 값을 두 화면이 각자 편집하던 상태로 돌아간다
  // (fieldVisibility.ts의 SECTION_FIELDS 주석, fieldVisibility.test.ts의 INPUT_FLOW_FIELDS).
  //
  // 아래 가드는 삭제한 BasicInfoSection.test.tsx에서 옮겨 왔다. 나이 입력은 디바운스
  // 자동저장(useScenarios)과 겹치므로, 값을 지운 상태(Number('') === 0)가 저장되면 E2EE
  // 저장소에 0이 영구히 남고 currentAge 0은 엔진 가드를 통과해 전혀 다른 기간을 계산한다.
  describe('개인정보 단계의 나이 입력', () => {
    const renderFlow = (onChangeParams = vi.fn()) => {
      render(
        <RetirementInputFlow
          params={initialParams}
          onChangeParams={onChangeParams}
          onStartAnalysis={vi.fn()}
        />
      );
      return onChangeParams;
    };

    test('현재 나이와 기대수명을 표시한다', () => {
      renderFlow();

      expect(screen.getByLabelText('현재 나이')).toHaveValue(50);
      expect(screen.getByLabelText('기대수명')).toHaveValue(85);
    });

    // 은퇴 나이는 「은퇴 목표」의 «빠른 은퇴» 카드가 유일한 편집 경로다.
    test('은퇴 나이는 이 단계에서 편집하지 않는다', () => {
      renderFlow();

      expect(screen.queryByLabelText('목표 은퇴 나이')).toBeNull();
      expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
    });

    test('현재 나이를 바꾸면 userProfile.currentAge만 바뀐 params로 호출된다', () => {
      const onChangeParams = renderFlow();

      fireEvent.change(screen.getByLabelText('현재 나이'), { target: { value: '48' } });

      expect(onChangeParams).toHaveBeenCalledWith({
        ...initialParams,
        userProfile: { ...initialParams.userProfile, currentAge: 48 },
      });
    });

    test.each([
      ['현재 나이'],
      ['기대수명'],
    ])('%s를 비우면 아무것도 저장하지 않는다', (label) => {
      const onChangeParams = renderFlow();

      fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });

      expect(onChangeParams).not.toHaveBeenCalled();
    });

    // 지운 상태를 «저장»하지 않는 것과 «화면에 보여 주지» 않는 것은 다른 문제다. 제어
    // 입력이라 저장을 건너뛰면 다음 렌더가 옛 값을 그대로 되돌려 놓고, 그러면 사용자는
    // 첫 자리를 지울 수 없다 — 값이 1이면 뒤에 덧붙이는 것 말고는 아무 편집도 못 한다.
    test.each([
      ['현재 나이'],
      ['기대수명'],
    ])('%s를 비우면 저장은 건너뛰되 화면은 빈 칸으로 남는다', (label) => {
      const onChangeParams = renderFlow();
      const input = screen.getByLabelText(label);

      fireEvent.change(input, { target: { value: '' } });

      expect(input).toHaveValue(null);
      expect(onChangeParams).not.toHaveBeenCalled();
    });

    test('비운 뒤 새로 입력한 나이가 그대로 저장된다', () => {
      const onChangeParams = renderFlow();
      const input = screen.getByLabelText('현재 나이');

      fireEvent.change(input, { target: { value: '' } });
      fireEvent.change(input, { target: { value: '4' } });
      fireEvent.change(input, { target: { value: '45' } });

      expect(input).toHaveValue(45);
      expect(onChangeParams).toHaveBeenLastCalledWith({
        ...initialParams,
        userProfile: { ...initialParams.userProfile, currentAge: 45 },
      });
    });

    // 빈 칸으로 두고 떠나면 저장된 값이 다시 보여야 한다. 빈 칸이 남으면 화면과 실제
    // 계산에 쓰이는 값이 어긋난 채로 다음 단계로 넘어간다.
    test('비운 채로 포커스를 잃으면 저장된 나이로 되돌아간다', () => {
      renderFlow();
      const input = screen.getByLabelText('현재 나이');

      fireEvent.change(input, { target: { value: '' } });
      fireEvent.blur(input);

      expect(input).toHaveValue(50);
    });


    test('나이 입력에 min/max 범위가 걸려 있다', () => {
      renderFlow();

      expect(screen.getByLabelText('현재 나이')).toHaveAttribute('min', '1');
      expect(screen.getByLabelText('현재 나이')).toHaveAttribute('max', '120');
      expect(screen.getByLabelText('기대수명')).toHaveAttribute('max', '130');
    });

    test('범위를 벗어난 값은 클램프해서 저장한다', () => {
      const onChangeParams = renderFlow();

      fireEvent.change(screen.getByLabelText('기대수명'), { target: { value: '9999' } });

      expect(onChangeParams).toHaveBeenCalledWith({
        ...initialParams,
        userProfile: { ...initialParams.userProfile, expectancy: 130 },
      });
    });

    // 하한이 0이면 0세가 저장 가능하고, currentAge 0은 SimulationEngine의 totalYears
    // 가드(<= 0)를 통과해 91년짜리 시뮬레이션이 조용히 돈다. 사람 나이의 하한은 1이다.
    test.each([
      ['현재 나이', 'currentAge'],
      ['기대수명', 'expectancy'],
    ] as const)('%s의 음수·0은 1로 클램프한다', (label, key) => {
      const onChangeParams = renderFlow();

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
