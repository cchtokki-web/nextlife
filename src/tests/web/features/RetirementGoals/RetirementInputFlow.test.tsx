import { useState } from 'react';
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

  // HARD는 강도와 «기준»을 모두 확정해야 성립한다(known-issues 14번).
  //
  // 예전의 관문은 `targetValue > 0`만 봤다. 씨앗은 언제나 그것을 만족하므로, 사용자는
  // 금액을 한 번도 보지 않고 강도만 「반드시 지키기」로 바꾼 뒤 «강제되지 않는» 계획을
  // 「준비 완료」로 확인받을 수 있었다. 말없이 구속하지 않는 HARD는 시끄럽게 탈락시키는
  // 것보다 나쁜 실패 방식이다.
  describe('「반드시 지키기」로 고른 목표의 금액 확정', () => {
    const withGoals = (goals: unknown[]) =>
      ({ ...initialParams, retirementGoals: goals }) as typeof initialParams;

    // 저장된 시나리오가 그대로 도착하는 모양이다 — 금액은 있고 출처 표시는 없다.
    // 마이그레이션으로 확정 승격을 «하지 않는» 것이 원칙이므로, 이 계획은 그대로 열리되
    // 다음 단계로 넘어갈 때 확인을 요구받는다.
    const storedHardSeed = [{
      type: 'LIVING_EXPENSE_STABILITY' as const, priority: 1,
      constraintType: 'HARD' as const, targetValue: 3_500_000,
    }];

    function ConfirmationHarness({ initial }: { initial: unknown[] }) {
      const [params, setParams] = useState(withGoals(initial));
      return (
        <RetirementInputFlow
          params={params}
          onChangeParams={(next) => setParams(
            (typeof next === 'function' ? next(params) : next) as typeof initialParams,
          )}
          onStartAnalysis={vi.fn()}
        />
      );
    }

    test('금액이 씨앗 그대로면 분석을 시작할 수 없다', () => {
      render(<ConfirmationHarness initial={storedHardSeed} />);

      expect(screen.getByRole('button', { name: '분석 시작' })).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent(
        '「반드시 지키기」로 고른 「생활비 안정」의 금액이 아직 제안 상태입니다. '
        + '금액을 확인하고 확정해 주세요.',
      );
    });

    // 막는 것만으로는 부족하다. 사유는 버튼 옆에 뜨고 목표 카드는 «다른 단계»에 있어,
    // 사용자가 둘을 함께 볼 보장이 없다 — 고칠 곳을 가리켜야 한다.
    test('사유가 그 목표의 확정 버튼으로 데려간다', () => {
      render(<ConfirmationHarness initial={storedHardSeed} />);
      expect(screen.getByRole('button', { name: '1. 개인정보' })).toHaveAttribute('aria-current', 'step');

      fireEvent.click(screen.getByRole('button', { name: '생활비 안정 금액 확인하러 가기' }));

      expect(screen.getByRole('button', { name: '3. 은퇴 목표' })).toHaveAttribute('aria-current', 'step');
      expect(document.activeElement)
        .toBe(screen.getByRole('button', { name: '생활비 안정 목표를 이 금액으로 확정' }));
    });

    test('제안 금액을 그대로 확정하면 분석을 시작할 수 있다', () => {
      render(<ConfirmationHarness initial={storedHardSeed} />);
      fireEvent.click(screen.getByRole('button', { name: '생활비 안정 금액 확인하러 가기' }));

      fireEvent.click(screen.getByRole('button', { name: '생활비 안정 목표를 이 금액으로 확정' }));

      expect(screen.getByRole('button', { name: '분석 시작' })).toBeEnabled();
    });

    test('금액을 고쳐서 확정해도 분석을 시작할 수 있다', () => {
      render(<ConfirmationHarness initial={storedHardSeed} />);
      fireEvent.click(screen.getByRole('button', { name: '생활비 안정 금액 확인하러 가기' }));

      fireEvent.change(screen.getByLabelText('목표 월 생활비'), { target: { value: '4,000,000' } });
      fireEvent.click(screen.getByRole('button', { name: '생활비 안정 목표를 이 금액으로 확정' }));

      expect(screen.getByRole('button', { name: '분석 시작' })).toBeEnabled();
    });

    // 여기가 요점이다. 타이핑은 「변경」이지 「확인」이 아니다.
    test('금액을 고치기만 하고 확정하지 않으면 여전히 막힌다', () => {
      render(<ConfirmationHarness initial={storedHardSeed} />);
      fireEvent.click(screen.getByRole('button', { name: '생활비 안정 금액 확인하러 가기' }));

      fireEvent.change(screen.getByLabelText('목표 월 생활비'), { target: { value: '4,000,000' } });

      expect(screen.getByRole('button', { name: '분석 시작' })).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent('금액을 확인하고 확정해 주세요.');
    });

    // 여러 목표가 동시에 확인을 기다리면, 사유는 둘을 다 부르고 «버튼마다» 자기 목표로
    // 데려가야 한다. 카드 id가 유형별이라 구조적으로는 맞지만, 한 목표만 기다리는 경우로
    // 고정해 두면 둘째 버튼이 첫째 카드로 데려가도 초록으로 남는다.
    test('여러 목표가 기다리면 각 버튼이 «자기» 목표로 데려간다', () => {
      render(<ConfirmationHarness initial={[
        storedHardSeed[0],
        {
          type: 'INHERITANCE' as const, priority: 2,
          constraintType: 'HARD' as const, targetValue: 84_000_000,
        },
      ]} />);

      expect(screen.getByRole('status')).toHaveTextContent(
        '「생활비 안정」·「상속 자산 확보」의 금액이 아직 제안 상태입니다.',
      );

      fireEvent.click(screen.getByRole('button', { name: '상속 자산 확보 금액 확인하러 가기' }));

      expect(document.activeElement)
        .toBe(screen.getByRole('button', { name: '상속 자산 확보 목표를 이 금액으로 확정' }));
    });

    // 사유와 그 버튼은 «모든» 단계에 떠 있으므로, 이미 목표 단계에 있는 사용자가 같은
    // 버튼을 다시 누를 수 있다. 요청이 목표 «유형»만 담거나 같은 유형이면 이전 요청을
    // 재사용하면, 그때 상태가 바뀌지 않아 effect가 돌지 않는다 — 버튼이 죽은 것처럼 보인다.
    // 단계를 «떠나지 않고» 두 번 누르는 것이 이 회귀를 잡는 유일한 모양이다.
    test('같은 단계에 머문 채 같은 버튼을 다시 눌러도 다시 데려간다', () => {
      render(<ConfirmationHarness initial={storedHardSeed} />);
      const pointer = () => screen.getByRole('button', { name: '생활비 안정 금액 확인하러 가기' });

      fireEvent.click(pointer());
      expect(screen.getByRole('button', { name: '3. 은퇴 목표' })).toHaveAttribute('aria-current', 'step');
      (document.activeElement as HTMLElement | null)?.blur();
      expect(document.activeElement).not.toBe(
        screen.getByRole('button', { name: '생활비 안정 목표를 이 금액으로 확정' }));

      fireEvent.click(pointer());

      expect(document.activeElement)
        .toBe(screen.getByRole('button', { name: '생활비 안정 목표를 이 금액으로 확정' }));
    });

    // 가리키기는 «한 번» 소비된다. 요청이 남아 있으면 사용자가 나중에 스스로 목표 단계로
    // 돌아올 때 카드가 다시 마운트되며 옛 요청이 되살아나, 부르지도 않은 카드로 화면이
    // 스크롤된다.
    test('스스로 목표 단계로 돌아올 때는 옛 요청이 되살아나지 않는다', () => {
      const scrollIntoView = vi.fn();
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrollIntoView;
      try {
        render(<ConfirmationHarness initial={storedHardSeed} />);
        fireEvent.click(screen.getByRole('button', { name: '생활비 안정 금액 확인하러 가기' }));
        expect(scrollIntoView).toHaveBeenCalledOnce();

        fireEvent.click(screen.getByRole('button', { name: '1. 개인정보' }));
        fireEvent.click(screen.getByRole('button', { name: '3. 은퇴 목표' }));

        expect(scrollIntoView).toHaveBeenCalledOnce();
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });

    test('SOFT 목표는 씨앗 그대로도 막지 않는다', () => {
      render(<ConfirmationHarness initial={[{ ...storedHardSeed[0], constraintType: 'SOFT' }]} />);

      expect(screen.getByRole('button', { name: '분석 시작' })).toBeEnabled();
    });

    // 이 둘의 기준은 씨앗이 아니라 사용자가 1단계에서 «직접 입력한» 값이다(은퇴 나이·
    // 기대수명). 확인이 해결할 문제가 애초에 없으므로 관문을 세우지 않는다.
    test.each([
      [{ type: 'EARLY_RETIREMENT', priority: 1, constraintType: 'HARD', targetValue: 60 }],
      [{ type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' }],
    ])('%o는 HARD여도 막지 않는다', (goal) => {
      render(<ConfirmationHarness initial={[goal]} />);

      expect(screen.getByRole('button', { name: '분석 시작' })).toBeEnabled();
    });
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
