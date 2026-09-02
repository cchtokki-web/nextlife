import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import {
  RETIREMENT_GOAL_LABELS,
  RETIREMENT_GOAL_TYPES,
  type RetirementGoal,
  type RetirementGoalType,
} from '@/core/entities/retirementGoal';
import {
  isQuantitativelyJudgedGoal,
  resolveGoalSuccessConditions,
} from '@/core/usecases/goals/goalSuccessConditions';
import { initialParams } from '@/infrastructure/storage/localStore';
import { retirementGoalDefinition } from '@/web/features/RetirementGoals/goalCatalog';
import { RetirementGoalSelector } from '@/web/features/RetirementGoals/RetirementGoalSelector';

function SelectorHarness({
  initial = [], onGoals,
}: { initial?: RetirementGoal[]; onGoals?: (goals: RetirementGoal[]) => void }) {
  const [goals, setGoals] = useState(initial);
  return (
    <RetirementGoalSelector
      goals={goals}
      displayCurrency="KRW"
      retirementAge={60}
      targetMonthlySpending={3500000}
      onChange={(next) => { onGoals?.(next); setGoals(next); }}
    />
  );
}

function SelectorHarnessWithBequest() {
  const [goals, setGoals] = useState<RetirementGoal[]>([]);
  return (
    <RetirementGoalSelector
      goals={goals}
      displayCurrency="KRW"
      retirementAge={60}
      targetMonthlySpending={3500000}
      targetBequest={100_000_000}
      onChange={setGoals}
    />
  );
}

describe('RetirementGoalSelector', () => {
  test('10개의 목표 후보를 제공한다', () => {
    render(<SelectorHarness />);

    for (const label of [
      '생활비 안정', '빠른 은퇴', '자산 고갈 방지', '여유 있는 소비', '주거 안정',
      '연금 최대 활용', '세금 최소화', '투자 위험 최소화', '상속 자산 확보', '자산 성장',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  test('5개를 선택하면 나머지 목표 선택을 비활성화한다', () => {
    render(<SelectorHarness />);

    for (const label of ['생활비 안정', '빠른 은퇴', '자산 고갈 방지', '여유 있는 소비', '주거 안정']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
    }

    expect(screen.getByText('5/5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /연금 최대 활용/ })).toBeDisabled();
  });

  // 시드 규칙은 삭제된 「은퇴 목표」 섹션이 지키던 것이다. 상속 목표는 금액을 입력받는데,
  // 처음 고른 순간 비어 있으면 사용자가 0을 넣거나 빈 칸으로 두게 되고 그 값이 그대로
  // 계산에 들어간다. 그래서 엔진이 쓰던 추정치(월 생활비 × 24개월)를 출발점으로 준다.
  test('상속 목표를 처음 고르면 2년치 생활비를 목표 금액으로 시드한다', () => {
    render(<SelectorHarness />);

    fireEvent.click(screen.getByRole('button', { name: /상속 자산 확보/ }));

    expect(screen.getByLabelText('남기고 싶은 최소 자산'))
      .toHaveValue((3500000 * 24).toLocaleString());
  });

  test('이미 입력한 목표 상속자산이 있으면 시드가 덮어쓰지 않는다', () => {
    render(<SelectorHarnessWithBequest />);

    fireEvent.click(screen.getByRole('button', { name: /상속 자산 확보/ }));

    expect(screen.getByLabelText('남기고 싶은 최소 자산')).toHaveValue((100_000_000).toLocaleString());
  });

  // 금액 입력은 자동저장과 겹친다. 숫자가 아닌 값이 통과하면 NaN이 저장되고, 그 시나리오는
  // 다시 열어도 고칠 수 없다.
  test('목표값 입력은 숫자만 받고 비우면 미입력으로 둔다', () => {
    render(<SelectorHarness />);
    fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));
    const input = screen.getByLabelText('목표 월 생활비');

    fireEvent.change(input, { target: { value: 'abc' } });
    expect(input).toHaveValue((3500000).toLocaleString());

    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
  });

  test('목표 카드에서 target 값과 HARD/SOFT 조건을 최소 입력으로 수정한다', () => {
    render(<SelectorHarness />);
    fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));

    const target = screen.getByLabelText('목표 월 생활비');
    expect(target).toHaveValue('3,500,000');
    fireEvent.change(target, { target: { value: '4,000,000' } });
    expect(target).toHaveValue('4,000,000');

    const constraint = screen.getByLabelText('생활비 안정 조건 강도');
    fireEvent.change(constraint, { target: { value: 'HARD' } });
    expect(constraint).toHaveValue('HARD');
  });

  // 강도의 «행동» 차이는 생활비 목표에서만 참이다. 「반드시 지키기」가 계좌 순서·월 인출
  // 목표·세제 최적화를 깨는 것은 인출 시점의 규칙이고, 은퇴 나이나 기말자산의 HARD는
  // 후보를 거르는 조건일 뿐이다. 같은 문구를 모든 목표에 붙이면 거짓 설명이 된다.
  test('강도 안내는 생활비 목표에만 붙는다', () => {
    render(<SelectorHarness />);

    fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));
    expect(screen.getByText(/계좌 순서·월 인출 목표·세제 최적화보다 생활비 충당을 우선합니다/))
      .toBeInTheDocument();
    expect(screen.getByText(/세금이나 인출 순서를 강제로 깨지 않습니다/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /여유 있는 소비/ }));
    expect(screen.getAllByText(/생활비 충당을 우선합니다/)).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /빠른 은퇴/ }));
    expect(screen.getAllByText(/생활비 충당을 우선합니다/)).toHaveLength(2);
  });

  // 씨앗과 사용자 확정값을 «화면에서» 가른다.
  //
  // 미확정 금액은 부족분·HARD/SOFT 판정에 참가하지 않는다(confirmedTargetValue). 그 사실을
  // 숨기면 「반드시 지키기」를 골라 둔 사용자가 자기 금액이 강제되지 않는다는 것을 알 수 없고,
  // 이 수정이 목표를 조용히 약화시킨 것으로 나타난다.
  describe('목표금액의 출처', () => {
    test('목표를 고를 때 깔리는 금액에는 출처 표시가 붙지 않는다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);

      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));

      expect(seen.at(-1)).toEqual([{
        type: 'LIVING_EXPENSE_STABILITY', priority: 1,
        targetValue: 3500000, constraintType: 'SOFT',
      }]);
      expect(seen.at(-1)![0].targetValueSource).toBeUndefined();
    });

    // 타이핑은 「변경」이지 「확인」이 아니다. 고치다 만 금액을 확정으로 읽으면 표시가
    // 다시 뜻을 잃는다 — 사용자가 확인한 적 없는 숫자가 판정 기준이 된다.
    test('입력창에 써넣기만 해서는 확정되지 않는다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));

      fireEvent.change(screen.getByLabelText('목표 월 생활비'), { target: { value: '4,000,000' } });

      expect(seen.at(-1)).toEqual([{
        type: 'LIVING_EXPENSE_STABILITY', priority: 1,
        targetValue: 4_000_000, constraintType: 'SOFT',
      }]);
      expect(seen.at(-1)![0].targetValueSource).toBeUndefined();
    });

    test('사용자가 확정 버튼을 누른 금액에만 출처 표시가 붙는다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));

      fireEvent.change(screen.getByLabelText('목표 월 생활비'), { target: { value: '4,000,000' } });
      fireEvent.click(screen.getByRole('button', { name: '생활비 안정 목표를 이 금액으로 확정' }));

      expect(seen.at(-1)).toEqual([{
        type: 'LIVING_EXPENSE_STABILITY', priority: 1,
        targetValue: 4_000_000, targetValueSource: 'user', constraintType: 'SOFT',
      }]);
    });

    test('강도만 바꾸는 것으로는 제안이 확정되지 않는다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));

      fireEvent.change(screen.getByLabelText('생활비 안정 조건 강도'), { target: { value: 'HARD' } });

      expect(seen.at(-1)![0].constraintType).toBe('HARD');
      expect(seen.at(-1)![0].targetValueSource).toBeUndefined();
      expect(screen.getByText(/아직 제안 금액입니다/)).toBeInTheDocument();
    });

    test('제안 상태에는 「아직 제안 금액입니다」와 확정 방법이 함께 뜬다', () => {
      render(<SelectorHarness />);

      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));
      // 문구를 «문장 그대로» 고정한다. 부분 일치로 두면 다른 뜻으로 바뀌어도 통과한다.
      expect(screen.getByText(/아직 제안 금액입니다/).parentElement).toHaveTextContent(
        '아직 제안 금액입니다 — 지금 값은 입력하신 계획에서 가져온 것이라 달성·미달 판정에 '
        + '쓰지 않습니다. 금액을 직접 고치거나 아래에서 확정하면 목표 금액이 됩니다.',
      );

      fireEvent.change(screen.getByLabelText('목표 월 생활비'), { target: { value: '4,000,000' } });
      // «고치는 도중»은 여전히 미확정이다 — 안내는 남고, 확정 버튼이 새 금액을 가리킨다.
      expect(screen.getByText(/아직 제안 금액입니다/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: '생활비 안정 목표를 이 금액으로 확정' }));
      expect(screen.queryByText(/아직 제안 금액입니다/)).not.toBeInTheDocument();
    });

    // 사용자가 «스스로 적어 넣은» 숫자는 그 자체가 진술이다. 같은 말을 버튼으로 한 번 더
    // 시키지 않는다. 확인이 필요한 것은 사용자가 건드린 적 없는 씨앗뿐이다.
    test('금액을 직접 고치고 입력을 끝내면 그대로 확정된다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));

      const input = screen.getByLabelText('목표 월 생활비');
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '4,000,000' } });
      fireEvent.blur(input);

      expect(seen.at(-1)![0]).toMatchObject({ targetValue: 4_000_000, targetValueSource: 'user' });
      expect(screen.queryByText(/아직 제안 금액입니다/)).not.toBeInTheDocument();
    });

    test('Enter로 입력을 끝내도 확정된다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));

      const input = screen.getByLabelText('목표 월 생활비');
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '4,000,000' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(seen.at(-1)![0]).toMatchObject({ targetValue: 4_000_000, targetValueSource: 'user' });
    });

    // 확정을 «커밋 시점»으로 미루는 이유. 350만원을 치는 도중의 3·35·350이 차례로
    // 확정값이 되면 「고치다 만 금액」이 판정 기준이 된다.
    test('고치는 도중(키 입력 중간값)은 확정되지 않는다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));

      const input = screen.getByLabelText('목표 월 생활비');
      fireEvent.focus(input);
      for (const value of ['3', '35', '350']) {
        fireEvent.change(input, { target: { value } });
        expect(seen.at(-1)![0].targetValueSource).toBeUndefined();
      }

      fireEvent.blur(input);
      expect(seen.at(-1)![0]).toMatchObject({ targetValue: 350, targetValueSource: 'user' });
    });

    // 「금액 수정」으로 칸에 들어갔다가 아무것도 고치지 않고 나오는 것은 진술이 아니다.
    // 이 경우까지 확정으로 읽으면 씨앗이 클릭 한 번으로 승격되는 예전 문제로 돌아간다.
    test('입력칸을 스쳐 지나기만 하면 확정되지 않는다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));
      const countAfterSelect = seen.length;

      const input = screen.getByLabelText('목표 월 생활비');
      fireEvent.focus(input);
      fireEvent.blur(input);

      expect(seen.length).toBe(countAfterSelect);
      expect(screen.getByText(/아직 제안 금액입니다/)).toBeInTheDocument();
    });

    // 빈 칸에는 확정할 값이 없다. 출처 표시만 붙으면 「사용자가 확정한 undefined」라는
    // 상태가 생긴다.
    test('금액을 지우고 나가면 확정되지 않는다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));

      const input = screen.getByLabelText('목표 월 생활비');
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.blur(input);

      expect(seen.at(-1)![0].targetValue).toBeUndefined();
      expect(seen.at(-1)![0].targetValueSource).toBeUndefined();
    });

    // 확정한 뒤 다시 고치면 미확정으로 돌아가고, 다 친 시점에 새 금액으로 다시 확정된다.
    test('확정된 금액을 다시 고치면 새 금액으로 다시 확정된다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));
      fireEvent.click(screen.getByRole('button', { name: '생활비 안정 목표를 이 금액으로 확정' }));

      const input = screen.getByLabelText('목표 월 생활비');
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '5,000,000' } });
      expect(seen.at(-1)![0].targetValueSource).toBeUndefined();

      fireEvent.blur(input);
      expect(seen.at(-1)![0]).toMatchObject({ targetValue: 5_000_000, targetValueSource: 'user' });
    });

    // 커밋 시점에 목표를 다시 «찾기» 때문에, 그 사이 goals prop이 통째로 갈리면 내가
    // 친 적 없는 새 씨앗이 blur 한 번으로 확정될 수 있었다(포커스를 쥔 채 다른 시나리오가
    // 늦게 도착하는 경우). editedTargets가 «값»을 함께 들고 대조해 그것을 막는다.
    test('입력 중에 목표 금액이 밖에서 갈리면 blur는 아무것도 확정하지 않는다', () => {
      const seen: RetirementGoal[][] = [];
      function RaceHarness() {
        const [goals, setGoals] = useState<RetirementGoal[]>([]);
        return (
          <>
            <RetirementGoalSelector
              goals={goals}
              displayCurrency="KRW"
              retirementAge={60}
              targetMonthlySpending={3500000}
              onChange={(next) => { seen.push(next); setGoals(next); }}
            />
            <button
              type="button"
              onClick={() => setGoals((prev) =>
                prev.map((goal) => ({ ...goal, targetValue: 9_999_999 })))}
            >
              밖에서 시나리오 교체
            </button>
          </>
        );
      }
      render(<RaceHarness />);
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));

      const input = screen.getByLabelText('목표 월 생활비');
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '4,000,000' } });
      // 아직 blur 전에 바깥에서 목표 금액이 다른 값으로 갈린다(선택기를 거치지 않으므로
      // seen에는 남지 않는다 — 실제 시나리오 교체 경로와 같다).
      fireEvent.click(screen.getByRole('button', { name: '밖에서 시나리오 교체' }));
      expect(input).toHaveValue('9,999,999');
      const countBeforeBlur = seen.length;

      fireEvent.blur(input);

      // 사용자가 친 적 없는 9,999,999가 확정되어서는 «안 된다» — 확정은 emit이므로
      // 아무 일도 일어나지 않았다는 것이 곧 「승격하지 않았다」다.
      expect(seen.length).toBe(countBeforeBlur);
      expect(screen.getByText(/아직 제안 금액입니다/)).toBeInTheDocument();
    });

    // 표식은 목표 «유형별»로 따로 선다. 하나로 합치면 한 번의 blur가 씨앗을 가진 모든
    // 금액 목표를 한꺼번에 확정한다.
    test('한 목표를 고치고 나가도 다른 목표는 미확정으로 남는다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));
      fireEvent.click(screen.getByRole('button', { name: /여유 있는 소비/ }));

      const input = screen.getByLabelText('목표 월 생활비');
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '4,000,000' } });
      fireEvent.blur(input);

      const goals = seen.at(-1)!;
      expect(goals.find((goal) => goal.type === 'LIVING_EXPENSE_STABILITY')!.targetValueSource).toBe('user');
      expect(goals.find((goal) => goal.type === 'COMFORTABLE_SPENDING')!.targetValueSource).toBeUndefined();
    });

    // 고친 적 없이 Enter만 누르는 것도 진술이 아니다. blur 쪽만 막고 Enter를 열어 두면
    // 같은 승격이 다른 문으로 들어온다.
    test('고치지 않고 Enter만 눌러도 확정되지 않는다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));
      const countAfterSelect = seen.length;

      const input = screen.getByLabelText('목표 월 생활비');
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(seen.length).toBe(countAfterSelect);
      expect(screen.getByText(/아직 제안 금액입니다/)).toBeInTheDocument();
    });

    // 제품 결과를 가진 표시는 확정 패널이 아니라 HARD 관문 문구다 — 이것이 남아 있으면
    // 흐름이 「준비 완료」로 읽지 않는다. 버튼 경로에만 걸려 있던 확인을 커밋 경로에도 건다.
    test('직접 고쳐 확정하면 HARD 확인 요구 문구도 사라진다', () => {
      render(<SelectorHarness onGoals={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));
      fireEvent.change(screen.getByLabelText('조건 강도'), { target: { value: 'HARD' } });
      expect(screen.getByText('반드시 지킬 최소 생활비를 확인해 주세요.')).toBeInTheDocument();

      const input = screen.getByLabelText('목표 월 생활비');
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '4,000,000' } });
      fireEvent.blur(input);

      expect(screen.queryByText('반드시 지킬 최소 생활비를 확인해 주세요.')).not.toBeInTheDocument();
    });

    // 나이 목표는 애초에 확정을 묻지 않는다(isSuggestedTargetValue에서 걸러진다).
    // 고쳤다고 해서 없던 출처 표시가 생기면 저장 데이터의 모양이 조용히 바뀐다.
    test('희망 은퇴 나이를 고쳐도 출처 표시는 붙지 않는다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);
      fireEvent.click(screen.getByRole('button', { name: /빠른 은퇴/ }));

      const input = screen.getByLabelText('희망 은퇴 나이');
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '55' } });
      fireEvent.blur(input);

      expect(seen.at(-1)![0]).toMatchObject({ targetValue: 55 });
      expect(seen.at(-1)![0].targetValueSource).toBeUndefined();
    });

    test('상속 목표의 씨앗도 제안으로 표시된다', () => {
      render(<SelectorHarness />);

      fireEvent.click(screen.getByRole('button', { name: /상속 자산 확보/ }));

      expect(screen.getByText(/아직 제안 금액입니다/)).toBeInTheDocument();
    });

    // 나이는 금액이 아니고, 그 씨앗은 사용자가 1단계에서 «직접 입력한» 은퇴 나이다.
    // 제안이라 부르면 사용자가 이미 말한 것을 말한 적 없다고 하는 셈이 된다.
    test('희망 은퇴 나이에는 제안 문구를 붙이지 않는다', () => {
      render(<SelectorHarness />);

      fireEvent.click(screen.getByRole('button', { name: /빠른 은퇴/ }));

      expect(screen.queryByText(/아직 제안 금액입니다/)).not.toBeInTheDocument();
    });
  });

  // HARD는 강도와 «기준»을 모두 확정해야 성립한다(known-issues 14번). 강도만 「반드시
  // 지키기」로 고르고 금액은 씨앗 그대로면 두 가지 중 어느 쪽도 하지 않는다 — 그 금액을
  // 강제하지도 않고, 아무것도 구속하지 않는 HARD를 통과시키지도 않는다. 사용자에게 그
  // 금액을 확인하거나 고치도록 «요구»한다.
  describe('HARD 목표의 기준 확정', () => {
    const seeded = (type: RetirementGoal['type'], constraintType: RetirementGoal['constraintType']) =>
      [{ type, priority: 1, constraintType, targetValue: 3_500_000 }] as RetirementGoal[];

    test('「반드시 지키기」로 고른 생활비 목표는 금액 확인을 요구한다', () => {
      render(<SelectorHarness initial={seeded('LIVING_EXPENSE_STABILITY', 'HARD')} />);

      expect(screen.getByText('반드시 지킬 최소 생활비를 확인해 주세요.')).toBeInTheDocument();
      // 무엇을 확정하는지가 버튼 옆에 있어야 한다. 단위 변환도 반올림도 하지 않는다 —
      // 저장된 값과 다르게 보이는 숫자를 확정시키는 것이 이 화면이 막으려는 일이다.
      expect(screen.getByText('월 3,500,000원')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '생활비 안정 목표 금액 수정' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '생활비 안정 목표를 이 금액으로 확정' }))
        .toHaveTextContent('이 금액으로 확정');
    });

    test('「반드시 지키기」로 고른 상속 목표는 남길 자산의 확인을 요구한다', () => {
      render(<SelectorHarness initial={seeded('INHERITANCE', 'HARD')} />);

      expect(screen.getByText('반드시 남길 최소 자산을 확인해 주세요.')).toBeInTheDocument();
      expect(screen.getByText('3,500,000원')).toBeInTheDocument();
    });

    // SOFT에는 마찰을 더하지 않는다. 확정 문구는 「반드시 지키기」의 뜻이고, SOFT 목표에
    // 붙이면 하지 않아도 되는 일을 요구하는 것으로 읽힌다.
    test('SOFT 목표에는 「반드시 지킬」 확인 요구를 붙이지 않는다', () => {
      render(<SelectorHarness initial={seeded('LIVING_EXPENSE_STABILITY', 'SOFT')} />);

      expect(screen.queryByText(/반드시 지킬 최소 생활비를 확인해 주세요./)).toBeNull();
      // 다만 확정할 «길»은 남는다 — 타이핑이 더 이상 확정이 아니므로, 이것마저 없으면
      // SOFT 사용자는 자기 금액을 판정에 넣을 방법을 잃는다.
      expect(screen.getByRole('button', { name: '생활비 안정 목표를 이 금액으로 확정' }))
        .toBeInTheDocument();
    });

    test('「금액 수정」은 목표금액 입력창으로 데려간다', () => {
      render(<SelectorHarness initial={seeded('LIVING_EXPENSE_STABILITY', 'HARD')} />);

      fireEvent.click(screen.getByRole('button', { name: '생활비 안정 목표 금액 수정' }));

      expect(document.activeElement).toBe(screen.getByLabelText('목표 월 생활비'));
    });

    // 두 갈래 모두 확정으로 끝난다 — 제안된 금액을 그대로 받는 것도 사용자의 행위다.
    test('제안 금액을 그대로 확정하면 확인 요구가 사라진다', () => {
      const seen: RetirementGoal[][] = [];
      render(
        <SelectorHarness
          initial={seeded('LIVING_EXPENSE_STABILITY', 'HARD')}
          onGoals={(goals) => seen.push(goals)}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: '생활비 안정 목표를 이 금액으로 확정' }));

      expect(seen.at(-1)![0]).toMatchObject({ targetValue: 3_500_000, targetValueSource: 'user' });
      expect(screen.queryByText('반드시 지킬 최소 생활비를 확인해 주세요.')).toBeNull();
    });

    // 확정한 뒤 고친 금액을 여전히 확정으로 읽으면, 사용자가 확인한 적 없는 숫자가 다시
    // 판정 기준이 된다.
    test('확정한 금액을 다시 고치면 미확정으로 돌아간다', () => {
      const seen: RetirementGoal[][] = [];
      render(
        <SelectorHarness
          initial={seeded('LIVING_EXPENSE_STABILITY', 'HARD')}
          onGoals={(goals) => seen.push(goals)}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: '생활비 안정 목표를 이 금액으로 확정' }));

      fireEvent.change(screen.getByLabelText('목표 월 생활비'), { target: { value: '4,000,000' } });

      expect(seen.at(-1)![0].targetValueSource).toBeUndefined();
      expect('targetValueSource' in seen.at(-1)![0]).toBe(false);
      expect(screen.getByText('반드시 지킬 최소 생활비를 확인해 주세요.')).toBeInTheDocument();
    });

    // 이 두 목표의 기준은 씨앗이 아니라 사용자가 1단계에서 «직접 입력한» 값이다(은퇴
    // 나이·기대수명). 확인 요구의 목적은 「사용자가 말한 적 없는 숫자로 실패를 선언하지
    // 않는다」이고, 이미 사용자가 말한 숫자에는 그 문제가 없다.
    test.each([
      ['EARLY_RETIREMENT', '빠른 은퇴'],
      ['ASSET_SURVIVAL', '자산 고갈 방지'],
    ] as const)('%s는 HARD여도 확인을 요구하지 않는다', (type, label) => {
      render(
        <SelectorHarness
          initial={[{ type, priority: 1, constraintType: 'HARD', targetValue: 60 }]}
        />,
      );

      expect(screen.queryByText(/확인해 주세요./)).toBeNull();
      expect(screen.queryByRole('button', { name: `${label} 목표를 이 금액으로 확정` })).toBeNull();
    });
  });

  // 달성·미달을 잴 정량 기준이 «없는» 목표들이 있다. 그런 목표에 「반드시 지키기」를
  // 고르게 두면 사용자는 계산이 지키지 않는 조건을 못박은 것으로 믿는다(known-issues 1번).
  //
  // 유형을 «여기서» 나열하지 않는다. 목록을 테스트가 따로 들면 화면이 옛 목록을 그대로
  // 들고 있어도 통과하게 되고, 이 테스트가 막으려는 것이 정확히 그 어긋남이다.
  describe('정량 판정 대상이 아닌 목표', () => {
    const hardOption = (label: string) =>
      within(screen.getByLabelText(`${label} 조건 강도`)).getByRole('option', { name: '반드시 지키기' });

    // 「이 목표를 HARD로 고를 수 있는가」는 «유형»만으로 정해지지 않는다. 목표 금액을 비워
    // 둘 수 있는 유형(goalCatalog의 optional)은 그 금액을 «확정했을 때만» HARD가 성립한다 —
    // 확정되지 않은 금액은 어떤 HARD 축도 켜지 못하기 때문이다. 그 조합이 실제로 존재한다 —
    // 「자산 성장」이다. 아래 「엔진이 켜지 못하는 축」 테스트가 그 사실 자체를 엔진에서
    // «독립적으로» 확인한다.
    //
    // 아래 순회는 모두 «금액 없는» 목표를 그리므로, 선택 입력을 가진 유형은 전부 잠긴 쪽이다.
    const canSelectHard = (type: RetirementGoalType) =>
      isQuantitativelyJudgedGoal(type)
      && retirementGoalDefinition(type).target?.optional !== true;

    // 「정량 판정 대상 아님」이 붙는 조건은 canSelectHard와 «다르다». 금액을 비워 둔 자산
    // 성장은 판정을 못 하는 상태가 아니다 — 은퇴 시점 자산과 견주어 채점한다. 못 하는 것은
    // 그 기준을 못박는 일뿐이므로, 그 카드에는 다른 문구가 붙는다(아래 전용 테스트).
    test('엔진이 판정하지 않는 목표에만 「정량 판정 대상 아님」이 붙는다', () => {
      for (const type of RETIREMENT_GOAL_TYPES) {
        const { unmount } = render(
          <SelectorHarness initial={[{ type, priority: 1, constraintType: 'SOFT' }]} />,
        );

        const note = screen.queryByText(/정량 판정 대상 아님/);
        if (isQuantitativelyJudgedGoal(type)) {
          expect(note, `${RETIREMENT_GOAL_LABELS[type]}은 판정 대상이다`).toBeNull();
        } else {
          expect(note, `${RETIREMENT_GOAL_LABELS[type]}은 판정 대상이 아니다`).toBeInTheDocument();
        }
        unmount();
      }
    });

    test('엔진이 판정하지 않는 목표는 「반드시 지키기」를 고를 수 없다', () => {
      for (const type of RETIREMENT_GOAL_TYPES) {
        const label = RETIREMENT_GOAL_LABELS[type];
        const { unmount } = render(
          <SelectorHarness initial={[{ type, priority: 1, constraintType: 'SOFT' }]} />,
        );

        if (canSelectHard(type)) {
          expect(hardOption(label), label).not.toBeDisabled();
        } else {
          // 고를 수 없다 = 선택지가 아예 없다. SOFT 하나만 남는다.
          expect(
            within(screen.getByLabelText(`${label} 조건 강도`)).getAllByRole('option').map((o) => o.textContent),
            label,
          ).toEqual(['가능하면 달성']);
        }
        unmount();
      }
    });

    // **오라클이 구현을 되풀이하지 않도록 붙드는 자리.** 위 canSelectHard는 화면 규칙을
    // 옮겨 적은 것이라, 그것만으로는 「자산 성장에 HARD를 열어 주면 안 된다」를 증명하지
    // 못한다 — 화면과 테스트가 함께 틀려도 통과한다. 그 사실의 근거는 엔진에 있다.
    test('금액 없는 자산 성장은 HARD로 저장해도 엔진이 어떤 HARD 축도 켜지 못한다', () => {
      // 화면이 «실제로 만들 수 있는» 상태다. 목표 금액은 선택 입력이라 비워 둘 수 있고,
      // 비어 있으면 사용자 확정으로 올릴 값 자체가 없다.
      const params = {
        ...structuredClone(initialParams),
        retirementGoals: [{ type: 'ASSET_GROWTH' as const, priority: 1, constraintType: 'HARD' as const }],
      };

      expect(resolveGoalSuccessConditions(params).hardRequirements).toEqual({
        spendingTarget: false, assetSurvival: false, terminalAsset: false,
      });
    });

    // **위 테스트의 «짝».** 「축이 안 켜진다」만 확인하면 축을 영영 켜지 못하게 만들어도
    // 통과한다 — 이 커밋이 더한 기능이 통째로 죽어도 초록이라는 뜻이다. 확정하면 실제로
    // 켜진다는 사실이 나란히 있어야 두 테스트가 함께 뜻을 갖는다.
    test('금액을 확정한 자산 성장은 기말자산 축을 HARD로 켠다', () => {
      const params = {
        ...structuredClone(initialParams),
        retirementGoals: [{
          type: 'ASSET_GROWTH' as const,
          priority: 1,
          constraintType: 'HARD' as const,
          targetValue: 500_000_000,
          targetValueSource: 'user' as const,
        }],
      };

      const conditions = resolveGoalSuccessConditions(params);
      expect(conditions.hardRequirements).toEqual({
        spendingTarget: false, assetSurvival: false, terminalAsset: true,
      });
      expect(conditions.terminalAssetGoal).toBe(500_000_000);
      expect(conditions.hardRequirementGoals.terminalAsset).toEqual(['ASSET_GROWTH']);
    });

    test('그래서 화면은 금액이 비어 있는 동안만 「반드시 지키기」를 잠근다', () => {
      render(
        <SelectorHarness initial={[{ type: 'ASSET_GROWTH', priority: 1, constraintType: 'SOFT' }]} />,
      );

      expect(
        within(screen.getByLabelText('자산 성장 조건 강도')).getAllByRole('option').map((o) => o.textContent),
      ).toEqual(['가능하면 달성']);
      // 사유가 「판정을 못 한다」가 아니다 — 채점은 하되 «못박을» 금액이 없을 뿐이다.
      // 문구가 fragment로 쪼개져 텍스트 노드가 «자기 요소»를 갖지 않으므로 문단 전체에서
      // 확인한다.
      const note = screen.getByText(/금액을 확정해야 열립니다/).closest('p');
      expect(note?.textContent).toContain('유지하고 싶은 최소 자산');
      expect(note?.textContent).toContain('비워 두어도 목표는 채점됩니다');
      expect(screen.queryByText(/정량 판정 대상 아님/)).toBeNull();
    });

    test('금액을 입력하고 확정하면 「반드시 지키기」가 열린다', () => {
      const seen: RetirementGoal[][] = [];
      render(
        <SelectorHarness
          initial={[{ type: 'ASSET_GROWTH', priority: 1, constraintType: 'SOFT' }]}
          onGoals={(goals) => seen.push(goals)}
        />,
      );

      const input = screen.getByLabelText('유지하고 싶은 최소 자산');
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '500000000' } });
      fireEvent.blur(input);

      expect(seen.at(-1)![0]).toMatchObject({
        targetValue: 500_000_000, targetValueSource: 'user',
      });
      expect(
        within(screen.getByLabelText('자산 성장 조건 강도')).getAllByRole('option').map((o) => o.textContent),
      ).toEqual(['반드시 지키기', '가능하면 달성']);
      expect(within(screen.getByLabelText('자산 성장 조건 강도'))
        .getByRole('option', { name: '반드시 지키기' })).not.toBeDisabled();
      expect(screen.queryByText(/금액을 확정해야 열립니다/)).toBeNull();
    });

    // 씨앗을 깔지 «않는» 것이 계약이다. 이 목표의 자연스러운 기준선(은퇴 시점 자산)은
    // 시뮬레이션을 돌려야 나오고, 대신 아무 숫자나 깔면 사용자가 목표로 말한 적 없는 금액이
    // 카드에 찍힌다. 빈 칸이면 confirmedTargetValue가 undefined라 종전 계산이 그대로다.
    test('자산 성장을 새로 고르면 금액은 비어 있다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);

      fireEvent.click(screen.getByRole('button', { name: /자산 성장/ }));

      expect(seen.at(-1)![0].targetValue).toBeUndefined();
      expect(screen.getByLabelText('유지하고 싶은 최소 자산')).toHaveValue('');
    });

    // 기본값이 HARD로 남아 있으면 «고를 수 없는» 값이 자동으로 박힌다 — 잠그는 것보다
    // 나쁜 상태다. 판정 대상 목표의 기본값은 건드리지 않는다.
    test('판정 대상이 아닌 목표를 새로 고르면 언제나 SOFT로 시작한다', () => {
      for (const type of RETIREMENT_GOAL_TYPES) {
        if (canSelectHard(type)) continue;
        const seen: RetirementGoal[][] = [];
        const { unmount } = render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);

        fireEvent.click(screen.getByRole('button', { name: new RegExp(RETIREMENT_GOAL_LABELS[type]) }));

        expect(seen.at(-1)![0].constraintType, type).toBe('SOFT');
        unmount();
      }
    });

    test('판정 대상 목표의 기본 강도는 그대로다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);

      fireEvent.click(screen.getByRole('button', { name: /자산 고갈 방지/ }));
      expect(seen.at(-1)![0].constraintType).toBe('HARD');
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));
      expect(seen.at(-1)![1].constraintType).toBe('SOFT');
    });

    // 이미 HARD로 저장된 시나리오를 조용히 SOFT로 고쳐 쓰지 않는다 — 사용자가 저장한
    // 데이터를 말없이 바꾸는 것은 별개의 결정이다. 보여 주되 다시 고를 수는 없다.
    test('이미 저장된 HARD는 그대로 보여 주되 다시 고를 수 없게 잠근다', () => {
      const seen: RetirementGoal[][] = [];
      render(
        <SelectorHarness
          initial={[{ type: 'HOUSING_STABILITY', priority: 1, constraintType: 'HARD' }]}
          onGoals={(goals) => seen.push(goals)}
        />,
      );

      const constraint = screen.getByLabelText('주거 안정 조건 강도');
      expect(constraint).toHaveValue('HARD');
      expect(hardOption('주거 안정')).toBeDisabled();
      expect(screen.getByText(/이전에 저장된 「반드시 지키기」는 그대로 두었지만/))
        .toBeInTheDocument();
      // 화면을 여는 것만으로 저장값이 바뀌지 않는다.
      expect(seen).toEqual([]);

      // SOFT로 내려가면 잠긴 선택지는 사라진다 — 되돌아갈 길은 없다.
      fireEvent.change(constraint, { target: { value: 'SOFT' } });
      expect(seen.at(-1)![0].constraintType).toBe('SOFT');
      expect(within(constraint).queryByRole('option', { name: '반드시 지키기' })).toBeNull();
    });

    // 점수 «산식»이 있는 정성 목표. 잠근 이유와 「그래도 반영된다」를 함께 말하는 종전 문구가
    // 그대로 참이다 — 세금 최소화는 taxEfficiency에서 점수를 유도해 후보를 실제로 변별한다.
    test('문구가 잠근 이유와 그래도 반영되는 것을 함께 말한다', () => {
      render(<SelectorHarness />);

      fireEvent.click(screen.getByRole('button', { name: /세금 최소화/ }));

      expect(screen.getByText(/정량 기준이 아직 없어 「반드시 지키기」로 지정할 수 없습니다/))
        .toBeInTheDocument();
      expect(screen.getByText(/선택과 우선순위는 추천 전략을 고르는 기준에 그대로 반영됩니다/))
        .toBeInTheDocument();
    });

    // 「주거 안정」만 점수 산식이 없어 평가가 상수 0을 돌려준다. 위 문장을 그대로 쓰면
    // 「반영된다」가 「0으로 반영된다」를 감추고, 사용자는 그 0을 목표 실패로 읽는다
    // (known-issues 15번). 계산은 그대로 두고 화면이 그 사실을 말하게 한다.
    test('점수 산식이 없는 목표에는 0점이 실패가 아님을 밝힌다', () => {
      render(<SelectorHarness />);

      fireEvent.click(screen.getByRole('button', { name: /주거 안정/ }));

      expect(screen.getByText(/정량 기준이 아직 없어 「반드시 지키기」로 지정할 수 없습니다/))
        .toBeInTheDocument();
      expect(screen.getByText(/점수 산정 대상도 아닙니다/)).toBeInTheDocument();
      expect(screen.getByText(/0점은 목표 실패가 아니라 «판정하지 않음»을 뜻합니다/))
        .toBeInTheDocument();
      // 종전 문장을 «대신» 쓰는 것이지 덧붙이는 것이 아니다. 둘이 함께 뜨면 화면이
      // 「그대로 반영된다」와 「점수를 계산하지 않는다」를 동시에 말하게 된다.
      expect(screen.queryByText(/선택과 우선순위는 추천 전략을 고르는 기준에 그대로 반영됩니다/))
        .toBeNull();
    });
  });

  test('우선순위 이동 버튼으로 선택 순서를 바꾼다', () => {
    render(<SelectorHarness />);
    fireEvent.click(screen.getByRole('button', { name: /빠른 은퇴/ }));
    fireEvent.click(screen.getByRole('button', { name: /자산 고갈 방지/ }));
    fireEvent.click(screen.getByRole('button', { name: '자산 고갈 방지 우선순위 올리기' }));

    const priorities = screen.getAllByText(/^[12]$/).map((item) => item.textContent);
    expect(priorities).toEqual(['1', '2']);
    expect(screen.getByRole('button', { name: '자산 고갈 방지 우선순위 올리기' })).toBeDisabled();
  });
});
