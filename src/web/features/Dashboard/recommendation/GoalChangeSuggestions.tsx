'use client';

import { useEffect, useRef, useState } from 'react';
import type { SimulationParams } from '../../../../core/entities/types';
import type { GoalSuccessConditions } from '../../../../core/usecases/goals/goalSuccessConditions';
import { describeGoalSuccessCriteria } from '../../../../core/usecases/goals/goalSuccessConditions';
import { formatConfidenceInterval, wilsonIntervalFromRate } from '../../../../core/usecases/montecarlo/confidenceInterval';
import { retirementGoalDefinition } from '../../RetirementGoals/goalCatalog';
import type { GoalChangeProposal } from '../../../../core/usecases/goals/goalChangeProposals';
import GlassCard from '../../../components/GlassCard';
import styles from '../Dashboard.module.css';

type Proposal = GoalChangeProposal & { probability: number; conditions?: GoalSuccessConditions };
type State = { kind: 'idle' | 'running' } | { kind: 'error'; message: string }
  | { kind: 'done'; baselineProbability: number; baselineConditions?: GoalSuccessConditions; trials: number; proposals: Proposal[] };

export function GoalChangeSuggestions({ params, onApply, onUndo, canUndo }: {
  params: SimulationParams;
  onApply: (params: SimulationParams) => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const worker = useRef<Worker | null>(null);
  const key = JSON.stringify(params);
  const formatAmount = (value: number) => `${Math.round(value).toLocaleString()}${params.displayCurrency === 'USD' ? '달러' : '원'}`;
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, [key]);

  function run() {
    worker.current?.terminate();
    try {
      const next = new Worker(new URL('../../../workers/goalChange.worker.ts', import.meta.url), { type: 'module' });
      worker.current = next;
      setState({ kind: 'running' });
      next.onmessage = (event: MessageEvent<State>) => {
        if (worker.current !== next) return;
        setState(event.data);
        next.terminate();
        worker.current = null;
      };
      next.onerror = () => {
        if (worker.current !== next) return;
        next.terminate(); worker.current = null;
        setState({ kind: 'error', message: '비교 계산을 완료하지 못했습니다. 다시 시도해 주세요.' });
      };
      next.onmessageerror = () => {
        if (worker.current !== next) return;
        next.terminate(); worker.current = null;
        setState({ kind: 'error', message: '비교 결과를 전달받지 못했습니다. 다시 시도해 주세요.' });
      };
      next.postMessage({ params });
    } catch {
      worker.current?.terminate(); worker.current = null;
      setState({ kind: 'error', message: '이 브라우저에서 비교 계산을 실행하지 못했습니다.' });
    }
  }

  return <GlassCard className="text-sm text-foreground-muted">
    <h3 className="font-semibold text-foreground">은퇴 목표 변경안 비교</h3>
    {canUndo && <div className={styles.goalChangeGrid}>
      <article className={styles.goalChangeCard} aria-label="이전 목표로 복구">
        <header className={styles.goalChangeCardHeader}>
          <span className={styles.goalChangeCategory}>기존 목표</span>
          <h4>목표 변경 전으로 복구</h4>
        </header>
        <div className={styles.goalChangeConditions}>
          <p>복구는 이 화면에서만 가능합니다. 설정이나 자동 시세가 변경되거나 새로고침하면 복구할 수 없습니다.</p>
        </div>
        <button type="button" className={styles.goalChangeUndoButton} onClick={onUndo}>목표 변경 전으로 복구</button>
      </article>
    </div>}
    <p className="mt-2">은퇴 시점과 확정된 생활비 목표의 변경안을 별도로 계산합니다. 필수 목표도 선택한 경우에만 바뀝니다.</p>
    <p>생활비나 은퇴 목표를 바꾸면 성공의 기준이 달라지므로, 높아진 확률은 기존 목표를 더 잘 달성한다는 뜻이 아닙니다.</p>
    <button type="button" className="mt-3 rounded-lg border border-primary px-3 py-2 text-primary" disabled={state.kind === 'running'} onClick={run}>
      {state.kind === 'running' ? '변경안 계산 중…' : '목표 변경안 계산'}
    </button>
    {state.kind === 'running' && <p role="status">각 변경안을 검증하므로 시간이 걸릴 수 있습니다.</p>}
    {state.kind === 'error' && <p role="alert">{state.message}</p>}
    {state.kind === 'done' && <div className="mt-3">
      <p>현재 목표 {Math.round(state.baselineProbability * 100)}% · {formatConfidenceInterval(wilsonIntervalFromRate(state.baselineProbability, state.trials))} · 각 {state.trials.toLocaleString()}회 시뮬레이션</p>
      {state.baselineConditions && <p>현재 목표 판정 조건: {describeGoalSuccessCriteria(state.baselineConditions, params.userProfile.expectancy, formatAmount) || '없음'}</p>}
      <p>신뢰구간은 시행 횟수에 따른 오차입니다. 작은 차이는 표본오차로 달라질 수 있으며 미래의 실제 결과를 보장하지 않습니다.</p>
      {state.proposals.length === 0 ? <p>검토한 변경안 중 필수 목표를 검증하고 확률이 높아진 안을 찾지 못했습니다.</p> : <ul className={styles.goalChangeGrid} aria-label="검증된 목표 변경안">
        {state.proposals.map((proposal) => {
          const change = proposal.kind === 'retirement'
            ? `은퇴 ${proposal.before}세 → ${proposal.after}세`
            : `월 생활비 ${formatAmount(proposal.before)} → ${formatAmount(proposal.after)}`;
          return <li key={proposal.id} className={styles.goalChangeCard}>
            <div className={styles.goalChangeCardHeader}>
              <span className={styles.goalChangeCategory}>{proposal.kind === 'retirement' ? '은퇴 시점' : '생활비 목표'}</span>
              <h4>{change}</h4>
            </div>
            <dl className={`${styles.strategyMetrics} ${styles.goalChangeMetrics}`}>
              <div><dt>변경된 목표의 달성 확률</dt><dd>{Math.round(proposal.probability * 100)}%</dd></div>
            </dl>
            <p className={styles.goalChangeConfidence}>{formatConfidenceInterval(wilsonIntervalFromRate(proposal.probability, state.trials))}</p>
            <div className={styles.goalChangeConditions}>
              {proposal.conditions && <p>판정 조건: {describeGoalSuccessCriteria(proposal.conditions, proposal.params.userProfile.expectancy, formatAmount) || '없음'}</p>}
              {!!proposal.conditions?.unmeasuredGoals.length && <p>확률로 판정하지 않은 목표: {proposal.conditions.unmeasuredGoals.map((goal) => retirementGoalDefinition(goal).label).join(', ')}</p>}
            </div>
            <button type="button" className={styles.goalChangeApply} aria-label={`${change} 적용`} onClick={() => { onApply(proposal.params); setState({ kind: 'idle' }); }}>이 목표 변경 적용</button>
          </li>;
        })}
      </ul>}
    </div>}
  </GlassCard>;
}
