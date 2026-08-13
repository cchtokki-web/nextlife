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

  test('관리 버튼을 누르면 시나리오 작업 목록을 펼친다', () => {
    render(<ScenarioManager scenarioState={makeScenarioState()} />);

    fireEvent.click(screen.getByRole('button', { name: /관리/ }));

    expect(screen.getByRole('button', { name: /관리/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('비교하거나 복제하고, 이름과 파일을 관리할 수 있습니다.')).toBeInTheDocument();
    expect(screen.getAllByText('조기 은퇴안')).toHaveLength(2);
  });
});
