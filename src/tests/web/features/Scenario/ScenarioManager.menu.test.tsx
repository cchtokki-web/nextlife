import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ScenarioManager } from '@/web/features/Scenario/ScenarioManager';
import { initialParams } from '@/infrastructure/storage/localStore';

type ScenarioState = React.ComponentProps<typeof ScenarioManager>['scenarioState'];

const makeScenarioState = () => ({
  scenarios: [
    {
      id: 'default',
      name: '기본 시나리오',
      isDefault: true,
      data: initialParams,
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    },
    {
      id: 'alternative',
      name: '조기 은퇴안',
      isDefault: false,
      data: initialParams,
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    },
  ],
  activeScenarioId: 'default',
  setActiveScenarioId: vi.fn(),
  compareScenarioIds: [],
  toggleCompareScenario: vi.fn(),
  handleDuplicateScenario: vi.fn(),
  handleDeleteScenario: vi.fn(),
  handleRenameScenario: vi.fn(),
  handleUpdateScenarioData: vi.fn(),
}) as unknown as ScenarioState;

describe('ScenarioManager 설정 메뉴', () => {
  test('현재 시나리오 선택을 먼저 보여주고 관리 목록은 기본으로 접는다', () => {
    const state = makeScenarioState();
    render(<ScenarioManager scenarioState={state} />);

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

  test('분석한 시나리오에는 분석 완료 상태를 표시한다', () => {
    const state = makeScenarioState();
    state.scenarios[1].analyzedAt = '2026-08-29T00:00:00.000Z';
    render(<ScenarioManager scenarioState={state} />);

    fireEvent.click(screen.getByRole('button', { name: /관리/ }));

    expect(screen.getByText('분석 완료')).toBeInTheDocument();
    expect(screen.getByText('분석 필요')).toBeInTheDocument();
  });

  test('활성 시나리오의 설정이 분석 결과와 달라지면 재분석 필요를 표시한다', () => {
    const state = makeScenarioState();
    state.scenarios[0].analyzedAt = '2026-08-29T00:00:00.000Z';
    render(<ScenarioManager scenarioState={state} analysisIsCurrent={false} />);

    fireEvent.click(screen.getByRole('button', { name: /관리/ }));

    expect(screen.getByText('재분석 필요')).toBeInTheDocument();
  });

  test('관리 버튼을 누르면 시나리오 작업 목록을 펼친다', () => {
    render(<ScenarioManager scenarioState={makeScenarioState()} />);

    fireEvent.click(screen.getByRole('button', { name: /관리/ }));

    expect(screen.getByRole('button', { name: /관리/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('비교하거나 복제하고, 이름과 파일을 관리할 수 있습니다.')).toBeInTheDocument();
    expect(screen.getAllByText('조기 은퇴안')).toHaveLength(2);
    expect(screen.getAllByText('분석 필요')).toHaveLength(2);
  });

  test('목적별 비교안은 변경 내용을 확인한 뒤 실제 설정을 바꿔 복제한다', () => {
    const state = makeScenarioState();
    render(<ScenarioManager scenarioState={state} />);

    fireEvent.click(screen.getByRole('button', { name: /관리/ }));
    fireEvent.click(screen.getByRole('button', { name: '목적별 비교안 만들기' }));
    fireEvent.click(screen.getByRole('button', { name: '장기 침체 가정' }));
    expect(screen.getByRole('dialog', { name: '장기 침체 가정을 만들까요?' })).toHaveTextContent('경제 시나리오: 장기 침체');
    expect(screen.getByRole('dialog')).toHaveTextContent('예상되는 영향');
    expect(screen.getByRole('dialog')).toHaveTextContent('물가·환율');
    expect(state.handleDuplicateScenario).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '비교안 만들기' }));

    expect(state.handleDuplicateScenario).toHaveBeenCalledWith(
      'default', '장기 침체 가정',
      expect.objectContaining({ strategy: expect.objectContaining({ economicScenario: 'recession' }) })
    );
  });

  test('빠른 은퇴 비교안은 선택한 기간만큼 기존 목표의 나이를 앞당긴다', () => {
    const state = makeScenarioState();
    state.scenarios[0].data = {
      ...initialParams,
      retirementGoals: [{
        type: 'EARLY_RETIREMENT', priority: 1, targetValue: 65, constraintType: 'SOFT',
      }],
    } as never;
    render(<ScenarioManager scenarioState={state} />);

    fireEvent.click(screen.getByRole('button', { name: /관리/ }));
    fireEvent.click(screen.getByRole('button', { name: '목적별 비교안 만들기' }));
    fireEvent.click(screen.getByRole('button', { name: '빠른 은퇴 비교' }));

    fireEvent.change(screen.getByLabelText('직접 입력 (최대 14년)'), { target: { value: '5' } });
    expect(screen.getByRole('dialog')).toHaveTextContent('희망 은퇴 나이: 65세 → 60세');
    fireEvent.click(screen.getByRole('button', { name: '비교안 만들기' }));

    expect(state.handleDuplicateScenario).toHaveBeenCalledWith(
      'default', '빠른 은퇴 비교',
      expect.objectContaining({
        retirementGoals: [expect.objectContaining({ type: 'EARLY_RETIREMENT', targetValue: 60 })],
      })
    );
  });

  test('빠른 은퇴 목표가 없으면 확인 후 목표를 새로 추가한다', () => {
    const state = makeScenarioState();
    render(<ScenarioManager scenarioState={state} />);

    fireEvent.click(screen.getByRole('button', { name: /관리/ }));
    fireEvent.click(screen.getByRole('button', { name: '목적별 비교안 만들기' }));
    fireEvent.click(screen.getByRole('button', { name: '빠른 은퇴 비교' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('빠른 은퇴 목표 추가');
    expect(state.handleDuplicateScenario).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '비교안 만들기' }));

    expect(state.handleDuplicateScenario).toHaveBeenCalledWith(
      'default', '빠른 은퇴 비교',
      expect.objectContaining({
        retirementGoals: [expect.objectContaining({ type: 'EARLY_RETIREMENT' })],
      })
    );
  });

  test('생성된 비교안이 활성화되면 분석 콜백을 호출한다', () => {
    const state = makeScenarioState();
    const onScenarioCreated = vi.fn();
    const { rerender } = render(
      <ScenarioManager scenarioState={state} onScenarioCreated={onScenarioCreated} />
    );

    fireEvent.click(screen.getByRole('button', { name: /관리/ }));
    fireEvent.click(screen.getByRole('button', { name: '목적별 비교안 만들기' }));
    fireEvent.click(screen.getByRole('button', { name: '장기 침체 가정' }));
    fireEvent.click(screen.getByRole('button', { name: '비교안 만들기' }));

    expect(onScenarioCreated).not.toHaveBeenCalled();
    const created = { ...state.scenarios[0], id: 'created', name: '장기 침체 가정' };
    rerender(<ScenarioManager scenarioState={{ ...state, scenarios: [created, ...state.scenarios], activeScenarioId: 'created' } as ScenarioState} onScenarioCreated={onScenarioCreated} />);

    expect(onScenarioCreated).toHaveBeenCalledWith(created);
  });
});
