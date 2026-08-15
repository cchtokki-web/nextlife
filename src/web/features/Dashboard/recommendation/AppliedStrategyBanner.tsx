import { Undo2 } from 'lucide-react';
import type { AppliedStrategySnapshot } from '../../../hooks/useAppliedStrategy';
import styles from '../Dashboard.module.css';

interface AppliedStrategyBannerProps {
  snapshot: AppliedStrategySnapshot;
  onUndo: () => void;
}

/**
 * 추천 전략을 시나리오에 반영한 뒤, 되돌릴 수 있는 동안 계속 떠 있는 안내.
 *
 * **대시보드 안이 아니라 바깥에 둔다.** 설정이 바뀌면 결과가 stale이 되어 대시보드가
 * 통째로 사라지는데(page.tsx의 analysisIsCurrent), 배너가 그 안에 있으면 적용하자마자
 * 되돌리기 버튼까지 함께 사라진다.
 */
export function AppliedStrategyBanner({ snapshot, onUndo }: AppliedStrategyBannerProps) {
  return (
    <div className={styles.appliedStrategyBanner} role="status">
      <div>
        <p className={styles.appliedStrategyTitle}>
          <strong>{snapshot.label}</strong> 전략을 현재 시나리오에 적용했습니다.
        </p>
        {snapshot.appliedLabels.length > 0 && (
          <p className={styles.appliedStrategyDetail}>
            바뀐 설정 · {snapshot.appliedLabels.join(', ')}
          </p>
        )}
        {/* 반영하지 못한 축을 숨기면 "전략 전체 적용"이 거짓말이 된다. */}
        {snapshot.skippedLabels.length > 0 && (
          <p className={styles.appliedStrategySkipped}>
            {snapshot.skippedLabels.join(', ')}은(는) 현재 계획 구조상 반영하지 못했습니다.
          </p>
        )}
        {/* 스냅샷은 이 세션의 메모리에만 있다. 저장은 자동으로 되지만 되돌리기는 아니다. */}
        <p className={styles.appliedStrategyDetail}>
          새로고침하면 원래 설정으로 되돌릴 수 없습니다.
        </p>
      </div>
      <button type="button" onClick={onUndo} className={styles.undoStrategyButton}>
        <Undo2 size={14} aria-hidden="true" />
        원래 설정으로 되돌리기
      </button>
    </div>
  );
}
