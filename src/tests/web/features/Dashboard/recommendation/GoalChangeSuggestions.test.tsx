import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { initialParams } from '@/infrastructure/storage/localStore';
import { GoalChangeSuggestions } from '@/web/features/Dashboard/recommendation/GoalChangeSuggestions';

class WorkerStub {
  static last: WorkerStub;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { WorkerStub.last = this; }
}
afterEach(() => vi.unstubAllGlobals());

test('사용자가 계산을 요청하고 변경안을 선택할 때만 적용하며 복구를 호출한다', () => {
  vi.stubGlobal('Worker', WorkerStub);
  const apply = vi.fn();
  const undo = vi.fn();
  const changed = { ...initialParams, userProfile: { ...initialParams.userProfile, retirementAge: 62 } };
  render(<GoalChangeSuggestions params={initialParams} onApply={apply} onUndo={undo} canUndo />);
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '목표 변경안 계산' }));
  expect(WorkerStub.last.postMessage).toHaveBeenCalledWith({ params: initialParams });
  act(() => WorkerStub.last.onmessage?.({ data: { kind: 'done', baselineProbability: 0.7, trials: 2000,
    proposals: [{ id: 'retirement-62', kind: 'retirement', before: 60, after: 62, params: changed, probability: 0.8 }] } } as MessageEvent));
  expect(screen.getByText('은퇴 60세 → 62세')).toBeInTheDocument();
  expect(screen.getByText(/변경된 목표의 달성 확률 80%/)).toBeInTheDocument();
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '이 목표 변경 적용' }));
  expect(apply).toHaveBeenCalledWith(changed);
  fireEvent.click(screen.getByRole('button', { name: '목표 변경 전으로 복구' }));
  expect(undo).toHaveBeenCalledOnce();
});
