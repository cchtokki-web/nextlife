import { useEffect, useState } from 'react';
import { StrategyRecommendation } from '../../../../core/entities/types';

export type BeforeAfterMode = 'current' | 'after';

interface UseBeforeAfterToggleInput {
  recommendation?: StrategyRecommendation;
}

interface UseBeforeAfterToggleResult {
  mode: BeforeAfterMode;
  setMode: (mode: BeforeAfterMode) => void;
  toggle: () => void;
  canApply: boolean;
}

// 결과 화면의 Before(현재 전략)/After(추천 전략) 표시 상태. 시뮬레이션 파라미터가 아니라
// 순수 표시 상태이므로 DashboardSection 안에 두고, recommendation이 사라지거나
// improved가 false로 바뀌면 자동으로 'current'로 복귀시켜 존재하지 않는 추천을 계속 보여주지 않는다.
export function useBeforeAfterToggle({ recommendation }: UseBeforeAfterToggleInput): UseBeforeAfterToggleResult {
  const [mode, setMode] = useState<BeforeAfterMode>('current');
  const canApply = !!recommendation?.improved;

  useEffect(() => {
    if (!canApply) setMode('current');
  }, [canApply]);

  return {
    mode: canApply ? mode : 'current',
    setMode,
    toggle: () => setMode((m) => (m === 'current' ? 'after' : 'current')),
    canApply,
  };
}
