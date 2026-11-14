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
  const confirm = vi.fn();
  const { rerender } = render(<GoalChangeSuggestions params={initialParams} onApply={apply} onUndo={undo} onConfirm={confirm} canUndo={false} />);
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '목표 변경안 계산' }));
  expect(WorkerStub.last.postMessage).toHaveBeenCalledWith({ params: initialParams });
  act(() => WorkerStub.last.onmessage?.({ data: { kind: 'done', baselineProbability: 0.7, trials: 2000,
    proposals: [{ id: 'retirement-62', kind: 'retirement', before: 60, after: 62, params: changed, probability: 0.8 }] } } as MessageEvent));
  expect(screen.getByText('은퇴 60세 → 62세')).toBeInTheDocument();
  expect(screen.getByText('변경된 목표의 달성 확률')).toBeInTheDocument();
  expect(screen.getByText('80%')).toBeInTheDocument();
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '은퇴 60세 → 62세 적용' }));
  expect(apply).toHaveBeenCalledWith(changed);
  rerender(<GoalChangeSuggestions params={changed} onApply={apply} onUndo={undo} onConfirm={confirm} canUndo />);
  expect(screen.queryByRole('button', { name: '목표 변경안 계산' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '목표 변경안 확정' }));
  expect(confirm).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '목표 변경 전으로 복구' }));
  expect(undo).toHaveBeenCalledOnce();
});

test('검증된 변경안을 각각의 카드로 구분하고 선택한 안만 적용한다', () => {
  vi.stubGlobal('Worker', WorkerStub);
  const apply = vi.fn();
  const proposals = [
    { id: 'retirement-61', kind: 'retirement', before: 60, after: 61, probability: 0.8 },
    { id: 'retirement-62', kind: 'retirement', before: 60, after: 62, probability: 0.9 },
    { id: 'spending-2700000', kind: 'spending', before: 3_000_000, after: 2_700_000, probability: 0.85 },
    { id: 'spending-2400000', kind: 'spending', before: 3_000_000, after: 2_400_000, probability: 0.95 },
  ].map((proposal) => ({ ...proposal, params: { ...initialParams, userProfile: { ...initialParams.userProfile, retirementAge: proposal.after } } }));
  render(<GoalChangeSuggestions params={initialParams} onApply={apply} onUndo={vi.fn()} onConfirm={vi.fn()} canUndo={false} />);
  fireEvent.click(screen.getByRole('button', { name: '목표 변경안 계산' }));
  act(() => WorkerStub.last.onmessage?.({ data: { kind: 'done', baselineProbability: 0.7, trials: 2000, proposals } } as MessageEvent));
  expect(screen.getByRole('list', { name: '검증된 목표 변경안' }).querySelectorAll('li')).toHaveLength(4);
  expect(screen.getByText('월 생활비 300만원 → 270만원')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '월 생활비 300만원 → 270만원 적용' }));
  expect(apply).toHaveBeenCalledOnce();
  expect(apply).toHaveBeenCalledWith(proposals[2].params);
});

test('만원 미만 금액을 보존하고 달러는 기존 단위로 표시한다', () => {
  vi.stubGlobal('Worker', WorkerStub);
  const props = { onApply: vi.fn(), onUndo: vi.fn(), onConfirm: vi.fn(), canUndo: false };
  const proposal = { id: 'spending', kind: 'spending', before: 2_700_123, after: 2_430_000, probability: 0.9, params: initialParams };
  const { unmount } = render(<GoalChangeSuggestions {...props} params={initialParams} />);
  fireEvent.click(screen.getByRole('button', { name: '목표 변경안 계산' }));
  act(() => WorkerStub.last.onmessage?.({ data: { kind: 'done', baselineProbability: 0.7, trials: 2000, proposals: [proposal] } } as MessageEvent));
  expect(screen.getByText('월 생활비 270.0123만원 → 243만원')).toBeInTheDocument();
  unmount();

  render(<GoalChangeSuggestions {...props} params={{ ...initialParams, displayCurrency: 'USD' }} />);
  fireEvent.click(screen.getByRole('button', { name: '목표 변경안 계산' }));
  act(() => WorkerStub.last.onmessage?.({ data: { kind: 'done', baselineProbability: 0.7, trials: 2000, proposals: [proposal] } } as MessageEvent));
  expect(screen.getByText('월 생활비 2,700,123달러 → 2,430,000달러')).toBeInTheDocument();
});
