'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import type { ScenarioModel, SimulationParams, SimulationResult } from '../../../core/entities/types';
import { LegacySimulationEngine } from '../../../core/simulation/LegacySimulationEngine';
import { computeSequenceRisk } from '../../../core/usecases/montecarlo/sequenceRisk';
import { resolveMonteCarloConfig } from '../../../core/usecases/montecarlo/volatilityPresets';
import { runCompiledScenario } from '../../../core/usecases/strategy/runCompiledScenario';
import { useMonteCarlo } from '../../hooks/useMonteCarlo';
import { type StrategyPipeline, useStrategyPipeline } from '../../hooks/useStrategyPipeline';

export interface AnalysisRequest {
  params: SimulationParams;
  compareScenarios: Array<Pick<ScenarioModel, 'id' | 'name' | 'data'>>;
}

export interface AnalysisRuntimeValue extends StrategyPipeline {
  sourceParams: SimulationParams;
  monteCarlo: ReturnType<typeof useMonteCarlo>['result'];
  monteCarloStatus: ReturnType<typeof useMonteCarlo>['status'];
  sequenceRisk: ReturnType<typeof computeSequenceRisk>;
  compareResults: Array<{ id: string; name: string; result: SimulationResult }>;
}

interface AnalysisRuntimeProps {
  request: AnalysisRequest;
  engine: LegacySimulationEngine;
  children: (analysis: AnalysisRuntimeValue) => ReactNode;
}

interface AnalysisBoundaryProps {
  request: AnalysisRequest | null;
  engine: LegacySimulationEngine;
  children: (analysis: AnalysisRuntimeValue | null) => ReactNode;
}

// 이 컴포넌트는 사용자가 「분석 시작」을 누른 뒤에만 마운트된다. 따라서 아래의 추천 후보
// 탐색·결정론 시뮬레이션·Monte Carlo·시퀀스 리스크·비교 시나리오 계산·분석 이벤트 중 어느
// 것도 기본 입력 단계에서는 실행되지 않는다.
export function AnalysisRuntime({ request, engine, children }: AnalysisRuntimeProps) {
  const pipeline = useStrategyPipeline(request.params, engine);
  const { result: monteCarlo, status: monteCarloStatus } = useMonteCarlo(pipeline.effective.params);
  const sequenceRisk = useMemo(
    () => computeSequenceRisk(
      pipeline.effective.params,
      engine,
      resolveMonteCarloConfig(pipeline.effective.params)
    ),
    [pipeline.effective.params, engine]
  );
  const compareResults = useMemo(() => request.compareScenarios.map((scenario) => ({
    id: scenario.id,
    name: scenario.name,
    result: runCompiledScenario(engine, scenario.data, { applySentinels: true }),
  })), [engine, request.compareScenarios]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const sessionId = sessionStorage.getItem('analytics_session_id');
      fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'SIMULATION_RUN', sessionId }),
      }).catch(err => console.error('Failed to log simulation run', err));
    }, 3000);
    return () => clearTimeout(timer);
  }, [pipeline.result]);

  return children({
    ...pipeline,
    sourceParams: request.params,
    monteCarlo,
    monteCarloStatus,
    sequenceRisk,
    compareResults,
  });
}

export function AnalysisBoundary({ request, engine, children }: AnalysisBoundaryProps) {
  if (!request) return children(null);
  return (
    <AnalysisRuntime request={request} engine={engine}>
      {children}
    </AnalysisRuntime>
  );
}
