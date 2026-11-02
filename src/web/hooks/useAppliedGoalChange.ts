'use client';

import { useCallback, useState } from 'react';
import type { SimulationParams } from '../../core/entities/types';

export function useAppliedGoalChange({ activeParams, activeScenarioId, onChangeParams, onReanalyze }: {
  activeParams: SimulationParams;
  activeScenarioId: string | null;
  onChangeParams: (params: SimulationParams) => void;
  onReanalyze: (params: SimulationParams) => void;
}) {
  const [record, setRecord] = useState<{ scenarioId: string; previous: SimulationParams; applied: SimulationParams } | null>(null);
  const canUndo = !!record && record.scenarioId === activeScenarioId && record.applied === activeParams;
  const apply = useCallback((next: SimulationParams) => {
    if (!activeScenarioId) return;
    setRecord((previous) => ({ scenarioId: activeScenarioId,
      previous: previous?.scenarioId === activeScenarioId && previous.applied === activeParams ? previous.previous : activeParams,
      applied: next }));
    onChangeParams(next);
    onReanalyze(next);
  }, [activeScenarioId, activeParams, onChangeParams, onReanalyze]);
  const undo = useCallback(() => {
    if (!canUndo || !record) return;
    onChangeParams(record.previous);
    onReanalyze(record.previous);
    setRecord(null);
  }, [canUndo, record, onChangeParams, onReanalyze]);
  const confirm = useCallback(() => {
    if (canUndo) setRecord(null);
  }, [canUndo]);
  return { canUndo, apply, undo, confirm };
}
