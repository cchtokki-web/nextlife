import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ScenarioManager } from '@/web/features/Scenario/ScenarioManager';
import { initialParams } from '@/infrastructure/storage/localStore';
import { scenarioAnalysisHash } from '@/core/utils/scenarioAnalysisHash';
import type { RetirementGoal } from '@/core/entities/retirementGoal';
import type { ScenarioModel, SimulationParams } from '@/core/entities/types';

type ScenarioState = React.ComponentProps<typeof ScenarioManager>['scenarioState'];

const scenario = (id: string, name: string, isDefault: boolean): ScenarioModel => ({
  id,
  name,
  isDefault,
  data: initialParams,
  analyzedAt: null,
  analyzedParamsHash: null,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
} as ScenarioModel);

// 생성 성공을 «기본»으로 둔다. handleDuplicateScenario는 이제 만들어진 시나리오를 돌려주고
// 화면은 그 반환값으로 다음 단계를 정하므로, undefined를 돌려주는 대역은 실패 경로를 탄다.
const makeScenarioState = (overrides: Partial<ScenarioState> = {}) => ({
  scenarios: [
    scenario('default', '기본 시나리오', true),
    scenario('alternative', '조기 은퇴안', false),
  ],
  activeScenarioId: 'default',
  setActiveScenarioId: vi.fn(),
  compareScenarioIds: [],
  toggleCompareScenario: vi.fn(),
  handleDuplicateScenario: vi.fn(async (_id: string, name?: string, data?: SimulationParams) =>
    ({ ...scenario('created', name ?? '사본', false), data: data ?? initialParams })),
  handleDeleteScenario: vi.fn(),
  handleRenameScenario: vi.fn(),
  handleUpdateScenarioData: vi.fn(),
  ...overrides,
}) as unknown as ScenarioState;

const goal = (
  type: RetirementGoal['type'], priority: number, targetValue?: number,
): RetirementGoal => ({ type, priority, targetValue, constraintType: 'SOFT' });

const withGoals = (goals: RetirementGoal[], currentAge = 50): SimulationParams => ({
  ...initialParams,
  userProfile: { ...initialParams.userProfile, currentAge },
  retirementGoals: goals,
});

// 이미 펼쳐져 있으면 다시 누르지 않는다 — 비교안을 만들고 나면 관리 패널은 열린 채로
// 비교안 메뉴만 닫히므로, 무조건 누르면 두 번째 호출이 패널을 접어 버린다.
const openPresetMenu = () => {
  const manage = screen.getByRole('button', { name: /관리/ });
  if (manage.getAttribute('aria-expanded') !== 'true') fireEvent.click(manage);
  fireEvent.click(screen.getByRole('button', { name: '목적별 비교안 만들기' }));
};

const presetDataOf = (state: ScenarioState): SimulationParams =>
  (state.handleDuplicateScenario as unknown as ReturnType<typeof vi.fn>).mock.calls[0][2];

describe('ScenarioManager 설정 메뉴', () => {
  test('현재 시나리오 선택을 먼저 보여주고 관리 목록은 기본으로 접는다', () => {
    render(<ScenarioManager scenarioState={makeScenarioState()} />);

    expect(screen.getByRole('combobox', { name: '현재 시나리오' })).toHaveValue('default');
    expect(screen.getByRole('button', { name: /관리/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('비교하거나 복제하고, 이름과 파일을 관리할 수 있습니다.')).not.toBeInTheDocument();
  });

  test('시나리오 선택을 바꾸면 활성 시나리오를 변경한다', () => {
    const state = makeScenarioState();
    render(<ScenarioManager scenarioState={state} />);

    fireEvent.change(screen.getByRole('combobox', { name: '현재 시나리오' }), {
      target: { value: 'alternative' },
    });

    expect(state.setActiveScenarioId).toHaveBeenCalledWith('alternative');
  });

  test('관리 버튼을 누르면 시나리오 작업 목록을 펼친다', () => {
    render(<ScenarioManager scenarioState={makeScenarioState()} />);

    fireEvent.click(screen.getByRole('button', { name: /관리/ }));

    expect(screen.getByRole('button', { name: /관리/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('비교하거나 복제하고, 이름과 파일을 관리할 수 있습니다.')).toBeInTheDocument();
    expect(screen.getAllByText('조기 은퇴안')).toHaveLength(2);
    expect(screen.getAllByText('분석 필요')).toHaveLength(2);
  });

  describe('분석 상태 배지', () => {
    test('저장된 해시가 현재 입력과 같으면 분석 완료를 표시한다', () => {
      const state = makeScenarioState();
      state.scenarios[1].analyzedAt = '2026-08-29T00:00:00.000Z';
      state.scenarios[1].analyzedParamsHash = scenarioAnalysisHash(state.scenarios[1].data);
      render(<ScenarioManager scenarioState={state} />);

      fireEvent.click(screen.getByRole('button', { name: /관리/ }));

      expect(screen.getByText('분석 완료')).toBeInTheDocument();
      expect(screen.getByText('분석 필요')).toBeInTheDocument();
    });

    // 이 배지의 존재 이유다. 활성 시나리오가 아니어도 저장된 해시로 낡음을 판정할 수 있어야
    // 한다 — 참조 비교(analysisIsCurrent)는 새로고침을 넘기지 못한다.
    test('활성 시나리오가 아니어도 저장된 해시가 다르면 재분석 필요를 표시한다', () => {
      const state = makeScenarioState();
      state.scenarios[1].analyzedAt = '2026-08-29T00:00:00.000Z';
      state.scenarios[1].analyzedParamsHash = scenarioAnalysisHash({
        ...initialParams,
        userProfile: { ...initialParams.userProfile, currentAge: 41 },
      });
      render(<ScenarioManager scenarioState={state} />);

      fireEvent.click(screen.getByRole('button', { name: /관리/ }));

      expect(screen.getByText('재분석 필요')).toBeInTheDocument();
    });

    // 해시 필드가 생기기 전에 분석한 행. 「분석 완료」라고 단언하면 그 뒤로 아무리 설정을
    // 바꿔도 영원히 초록으로 남는다 — 모르는 것은 모른다고 말한다.
    test('해시가 없는 예전 시나리오는 분석 완료라고 단언하지 않는다', () => {
      const state = makeScenarioState();
      state.scenarios[1].analyzedAt = '2026-08-29T00:00:00.000Z';
      render(<ScenarioManager scenarioState={state} />);

      fireEvent.click(screen.getByRole('button', { name: /관리/ }));

      expect(screen.getByText('분석 시점 확인 불가')).toBeInTheDocument();
      expect(screen.queryByText('분석 완료')).not.toBeInTheDocument();
    });

    test('버전이 다른 해시도 비교하지 않는다', () => {
      const state = makeScenarioState();
      state.scenarios[1].analyzedAt = '2026-08-29T00:00:00.000Z';
      state.scenarios[1].analyzedParamsHash = 'v0:deadbeef';
      render(<ScenarioManager scenarioState={state} />);

      fireEvent.click(screen.getByRole('button', { name: /관리/ }));

      expect(screen.getByText('분석 시점 확인 불가')).toBeInTheDocument();
    });

    // analyzedAt은 「분석 시작」을 누른 순간 기록되므로 실패한 분석도 완료로 읽힌다.
    // 검증이 끝나지 않은 계획을 검증됐다고 말하면 안 된다.
    test('분석이 실패하면 활성 시나리오에 분석 실패를 표시한다', () => {
      const state = makeScenarioState();
      state.scenarios[0].analyzedAt = '2026-08-29T00:00:00.000Z';
      state.scenarios[0].analyzedParamsHash = scenarioAnalysisHash(state.scenarios[0].data);
      render(<ScenarioManager scenarioState={state} analysisIsCurrent analysisFailed />);

      fireEvent.click(screen.getByRole('button', { name: /관리/ }));

      expect(screen.getByText('분석 실패')).toBeInTheDocument();
      expect(screen.queryByText('분석 완료')).not.toBeInTheDocument();
    });

    test('활성 시나리오의 설정이 분석 결과와 달라지면 재분석 필요를 표시한다', () => {
      const state = makeScenarioState();
      state.scenarios[0].analyzedAt = '2026-08-29T00:00:00.000Z';
      render(<ScenarioManager scenarioState={state} analysisIsCurrent={false} />);

      fireEvent.click(screen.getByRole('button', { name: /관리/ }));

      expect(screen.getByText('재분석 필요')).toBeInTheDocument();
    });
  });

  describe('목적별 비교안', () => {
    test('변경 내용을 확인한 뒤 실제 설정을 바꿔 복제한다', async () => {
      const state = makeScenarioState();
      render(<ScenarioManager scenarioState={state} />);

      openPresetMenu();
      fireEvent.click(screen.getByRole('button', { name: '장기 침체 가정' }));
      expect(screen.getByRole('dialog', { name: '장기 침체 가정을 만들까요?' })).toHaveTextContent('경제 시나리오: 장기 침체');
      expect(screen.getByRole('dialog')).toHaveTextContent('예상되는 영향');
      expect(screen.getByRole('dialog')).toHaveTextContent('물가·환율');
      expect(state.handleDuplicateScenario).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '비교안 만들기' }));

      await waitFor(() => expect(state.handleDuplicateScenario).toHaveBeenCalledWith(
        'default', '장기 침체 가정',
        expect.objectContaining({ strategy: expect.objectContaining({ economicScenario: 'recession' }) })
      ));
    });

    test('빠른 은퇴 비교안은 선택한 기간만큼 기존 목표의 나이를 앞당긴다', async () => {
      const state = makeScenarioState();
      state.scenarios[0].data = withGoals([goal('EARLY_RETIREMENT', 1, 65)]);
      render(<ScenarioManager scenarioState={state} />);

      openPresetMenu();
      fireEvent.click(screen.getByRole('button', { name: '빠른 은퇴 비교' }));

      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
      expect(screen.getByRole('dialog')).toHaveTextContent('희망 은퇴 나이: 65세 → 60세');
      fireEvent.click(screen.getByRole('button', { name: '비교안 만들기' }));

      await waitFor(() => expect(state.handleDuplicateScenario).toHaveBeenCalled());
      expect(presetDataOf(state).retirementGoals).toEqual([
        expect.objectContaining({ type: 'EARLY_RETIREMENT', targetValue: 60 }),
      ]);
    });

    test('빠른 은퇴 목표가 없으면 확인 후 목표를 새로 추가한다', async () => {
      const state = makeScenarioState();
      render(<ScenarioManager scenarioState={state} />);

      openPresetMenu();
      fireEvent.click(screen.getByRole('button', { name: '빠른 은퇴 비교' }));

      expect(screen.getByRole('dialog')).toHaveTextContent('빠른 은퇴 목표 추가');
      expect(state.handleDuplicateScenario).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '비교안 만들기' }));

      await waitFor(() => expect(state.handleDuplicateScenario).toHaveBeenCalled());
      expect(presetDataOf(state).retirementGoals).toEqual([
        expect.objectContaining({ type: 'EARLY_RETIREMENT' }),
      ]);
    });

    // 목표는 최대 5개다. 6번째로 밀어 넣으면 normalizeRetirementGoals의 slice가 방금 넣은
    // 목표를 조용히 잘라내고, 원본과 «완전히 똑같은» 시나리오가 「빠른 은퇴 비교」라는
    // 이름으로 만들어진다. 사용자는 그것을 보고 "일찍 은퇴해도 안 바뀌는구나"라고 읽는다.
    test('목표가 이미 5개면 빠른 은퇴 비교안을 만들 수 없다고 말한다', () => {
      const state = makeScenarioState();
      state.scenarios[0].data = withGoals([
        goal('LIVING_EXPENSE_STABILITY', 1),
        goal('ASSET_SURVIVAL', 2),
        goal('COMFORTABLE_SPENDING', 3),
        goal('HOUSING_STABILITY', 4),
        goal('PENSION_OPTIMIZATION', 5),
      ]);
      render(<ScenarioManager scenarioState={state} />);

      openPresetMenu();

      expect(screen.getByRole('button', { name: '빠른 은퇴 비교' })).toBeDisabled();
      expect(screen.getByText(/목표가 이미 5개라/)).toBeInTheDocument();
      // 다른 비교안은 목표를 건드리지 않으므로 그대로 쓸 수 있어야 한다.
      expect(screen.getByRole('button', { name: '장기 침체 가정' })).toBeEnabled();
    });

    // 앞당길 여지가 없는데 최소 1년을 강제하면 현재 나이보다 어린 목표 나이가 만들어진다.
    // normalizeGoalDrivenParams가 그 값을 다시 끌어올리므로 계산 결과는 원본과 같아지고,
    // 달성할 수 없는 목표만 붙은 비교안이 남는다.
    test('이미 희망 은퇴 나이에 도달했으면 빠른 은퇴 비교안을 만들 수 없다고 말한다', () => {
      const state = makeScenarioState();
      state.scenarios[0].data = withGoals([goal('EARLY_RETIREMENT', 1, 65)], 65);
      render(<ScenarioManager scenarioState={state} />);

      openPresetMenu();

      expect(screen.getByRole('button', { name: '빠른 은퇴 비교' })).toBeDisabled();
      expect(screen.getByText(/이미 희망 은퇴 나이에 도달/)).toBeInTheDocument();
    });

    // 「다음 설정만 변경합니다」라는 약속. 예전에는 기존 목표를 빼고 맨 뒤에 다시 붙여서
    // 우선순위가 항상 최하위로 강등됐고, 목표 가중치가 함께 움직여 채점 축까지 바뀌었다.
    test('기존 빠른 은퇴 목표의 우선순위를 강등하지 않는다', async () => {
      const state = makeScenarioState();
      state.scenarios[0].data = withGoals([
        goal('EARLY_RETIREMENT', 1, 65),
        goal('ASSET_SURVIVAL', 2),
        goal('COMFORTABLE_SPENDING', 3),
      ]);
      render(<ScenarioManager scenarioState={state} />);

      openPresetMenu();
      fireEvent.click(screen.getByRole('button', { name: '빠른 은퇴 비교' }));
      fireEvent.click(screen.getByRole('button', { name: '비교안 만들기' }));

      await waitFor(() => expect(state.handleDuplicateScenario).toHaveBeenCalled());
      const goals = presetDataOf(state).retirementGoals!;
      expect(goals).toHaveLength(3);
      expect(goals.find((g) => g.type === 'EARLY_RETIREMENT')!.priority).toBe(1);
      expect(goals.map((g) => g.type)).toEqual([
        'EARLY_RETIREMENT', 'ASSET_SURVIVAL', 'COMFORTABLE_SPENDING',
      ]);
    });

    // 열기 핸들러가 «렌더 시점에» 만들어 둔 객체를 담으면, 5년으로 만들었다가 취소하고 다시
    // 열었을 때 화면은 3년을 가리키는데 실제로는 5년짜리가 생성된다.
    test('취소 후 다시 열면 화면에 보이는 연차와 실제 만들어질 계획이 같다', async () => {
      const state = makeScenarioState();
      state.scenarios[0].data = withGoals([goal('EARLY_RETIREMENT', 1, 65)]);
      render(<ScenarioManager scenarioState={state} />);

      openPresetMenu();
      fireEvent.click(screen.getByRole('button', { name: '빠른 은퇴 비교' }));
      fireEvent.click(screen.getByRole('button', { name: '5년' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('희망 은퇴 나이: 65세 → 60세');
      fireEvent.click(screen.getByRole('button', { name: '취소' }));

      fireEvent.click(screen.getByRole('button', { name: '빠른 은퇴 비교' }));
      expect(screen.getByRole('button', { name: '3년' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: '5년' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('dialog')).toHaveTextContent('희망 은퇴 나이: 65세 → 62세');

      fireEvent.click(screen.getByRole('button', { name: '비교안 만들기' }));
      await waitFor(() => expect(state.handleDuplicateScenario).toHaveBeenCalled());
      expect(presetDataOf(state).retirementGoals).toEqual([
        expect.objectContaining({ type: 'EARLY_RETIREMENT', targetValue: 62 }),
      ]);
    });

    test('Escape로 확인 모달을 닫으면 시나리오를 만들지 않는다', () => {
      const state = makeScenarioState();
      render(<ScenarioManager scenarioState={state} />);

      openPresetMenu();
      fireEvent.click(screen.getByRole('button', { name: '장기 침체 가정' }));
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(state.handleDuplicateScenario).not.toHaveBeenCalled();
    });

    test('생성에 실패하면 모달을 닫지 않고 이유를 말한다', async () => {
      const state = makeScenarioState({
        handleDuplicateScenario: vi.fn(async () => null),
      } as Partial<ScenarioState>);
      const onScenarioCreated = vi.fn();
      render(<ScenarioManager scenarioState={state} onScenarioCreated={onScenarioCreated} />);

      openPresetMenu();
      fireEvent.click(screen.getByRole('button', { name: '장기 침체 가정' }));
      fireEvent.click(screen.getByRole('button', { name: '비교안 만들기' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('비교안을 만들지 못했습니다');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(onScenarioCreated).not.toHaveBeenCalled();
    });
  });

  describe('생성 후 분석 콜백', () => {
    const createdScenario = (id: string) => ({ ...scenario(id, '장기 침체 가정', false) });

    const createPreset = async (state: ScenarioState) => {
      openPresetMenu();
      fireEvent.click(screen.getByRole('button', { name: '장기 침체 가정' }));
      fireEvent.click(screen.getByRole('button', { name: '비교안 만들기' }));
      await waitFor(() => expect(state.handleDuplicateScenario).toHaveBeenCalled());
    };

    test('생성된 비교안이 활성화되면 분석 콜백을 호출한다', async () => {
      const created = createdScenario('created');
      const state = makeScenarioState({ handleDuplicateScenario: vi.fn(async () => created) } as Partial<ScenarioState>);
      const onScenarioCreated = vi.fn();
      const { rerender } = render(
        <ScenarioManager scenarioState={state} onScenarioCreated={onScenarioCreated} />
      );

      await createPreset(state);
      expect(onScenarioCreated).not.toHaveBeenCalled();

      rerender(
        <ScenarioManager
          scenarioState={{ ...state, scenarios: [created, ...state.scenarios], activeScenarioId: 'created' } as ScenarioState}
          onScenarioCreated={onScenarioCreated}
        />
      );

      expect(onScenarioCreated).toHaveBeenCalledWith(created);
    });

    // 프리셋 이름은 고정 리터럴이라 두 번 만들면 이름이 겹친다. 신원을 이름으로 잡으면
    // 두 번째 생성은 래치에 걸려 분석이 아예 시작되지 않는데, 안내 문구는 「분석을
    // 시작합니다」를 그대로 띄운다.
    test('같은 비교안을 두 번 만들어도 두 번째가 분석된다', async () => {
      const first = createdScenario('created-1');
      const second = createdScenario('created-2');
      const handleDuplicateScenario = vi.fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);
      const state = makeScenarioState({ handleDuplicateScenario } as Partial<ScenarioState>);
      const onScenarioCreated = vi.fn();

      const afterFirst = { ...state, scenarios: [first, ...state.scenarios], activeScenarioId: 'created-1' } as ScenarioState;
      const { rerender } = render(
        <ScenarioManager scenarioState={state} onScenarioCreated={onScenarioCreated} />
      );

      await createPreset(state);
      rerender(<ScenarioManager scenarioState={afterFirst} onScenarioCreated={onScenarioCreated} />);
      expect(onScenarioCreated).toHaveBeenCalledWith(first);

      openPresetMenu();
      fireEvent.click(screen.getByRole('button', { name: '장기 침체 가정' }));
      fireEvent.click(screen.getByRole('button', { name: '비교안 만들기' }));
      await waitFor(() => expect(handleDuplicateScenario).toHaveBeenCalledTimes(2));

      rerender(
        <ScenarioManager
          scenarioState={{ ...afterFirst, scenarios: [second, first, ...state.scenarios], activeScenarioId: 'created-2' } as ScenarioState}
          onScenarioCreated={onScenarioCreated}
        />
      );

      expect(onScenarioCreated).toHaveBeenCalledWith(second);
      expect(onScenarioCreated).toHaveBeenCalledTimes(2);
    });

    // 같은 이름의 시나리오가 이미 활성일 때 새로 만들면, 이름으로 좇던 예전 구현은 POST가
    // 끝나기도 전에 «옛» 시나리오로 콜백을 쏘고 그것을 분석했다.
    test('같은 이름의 시나리오가 이미 활성이어도 옛 시나리오를 분석하지 않는다', async () => {
      const existing = createdScenario('existing');
      const created = createdScenario('created');
      const state = makeScenarioState({
        scenarios: [existing, scenario('default', '기본 시나리오', true)],
        activeScenarioId: 'existing',
        handleDuplicateScenario: vi.fn(async () => created),
      } as Partial<ScenarioState>);
      const onScenarioCreated = vi.fn();
      render(<ScenarioManager scenarioState={state} onScenarioCreated={onScenarioCreated} />);

      await createPreset(state);

      expect(onScenarioCreated).not.toHaveBeenCalled();
    });
  });
});
