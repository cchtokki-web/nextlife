import { useState } from 'react';
import { StrategyRecommendation } from '../../../../core/entities/types';

export type BeforeAfterMode = 'current' | 'after';

interface UseBeforeAfterToggleInput {
  recommendation?: StrategyRecommendation;
  // 사용자가 입력창을 편집할 때마다 참조가 바뀌는 값(예: DashboardSection의 params). after
  // 모드에서 recommendation.recommendedResult는 사용자가 방금 편집한 값이 아니라 AI가 자체
  // 탐색한 후보 기준으로 그려지므로, 이 값이 바뀌면 current로 되돌려 방금 편집한 내용이 실제로
  // 반영된 화면(현재 전략)을 보여준다.
  params?: unknown;
  // 지금 화면이 보여주는 효용 점수(result.utility.score). 자동 채움이 이미 반영된 값이다.
  currentUtilityScore?: number;
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
export function useBeforeAfterToggle({
  recommendation, params, currentUtilityScore,
}: UseBeforeAfterToggleInput): UseBeforeAfterToggleResult {
  const [mode, setMode] = useState<BeforeAfterMode>('current');
  // improved만 보면 안 된다. 그 값은 센티널 미적용 baseline 대비 판정이라, 자동 채움이 이미
  // 개선분을 반영한 뒤에도 true로 남는다. 그 상태에서 토글을 열어 두면 "추천 적용하기"가
  // 지금보다 나쁜 결과를 보여줄 수 있다 — After(recommendedResult)는 baseline 위에서
  // 계산된 값이고, baseline + 나이 조합은 후보 격자에 없던 조합이라 그것을 넘어설 수 있다.
  const canApply = !!recommendation?.improved
    && (currentUtilityScore === undefined
      || recommendation.recommendedUtility.score > currentUtilityScore);

  // 이펙트가 아니라 렌더 중에 조정한다.
  //
  // 이펙트로 되돌리면 "옛 모드로 한 번 커밋 → 이펙트 → 다시 커밋"이 되어 사용자가 옛 화면을
  // 한 프레임 본다. 렌더 중 setState는 React가 커밋 전에 즉시 다시 렌더하므로 그 깜빡임이
  // 없고, React Compiler도 이 형태를 권장한다("props가 바뀔 때 state 조정하기").
  //
  // params가 바뀌면 current로 되돌리는 이유: after 모드의 recommendedResult는 사용자가 방금
  // 편집한 값이 아니라 AI가 자체 탐색한 후보 기준이라, 편집 직후에는 방금 바꾼 내용이 실제로
  // 반영된 화면을 보여줘야 한다.
  const [prevParams, setPrevParams] = useState(params);
  if (params !== prevParams) {
    setPrevParams(params);
    setMode('current');
  }
  // 추천이 사라지거나 더 나을 게 없어지면 존재하지 않는 추천을 계속 보여주지 않는다.
  if (!canApply && mode !== 'current') {
    setMode('current');
  }

  return {
    mode: canApply ? mode : 'current',
    setMode,
    toggle: () => setMode((m) => (m === 'current' ? 'after' : 'current')),
    canApply,
  };
}
