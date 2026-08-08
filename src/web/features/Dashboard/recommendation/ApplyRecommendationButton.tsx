'use client';

import { Sparkles } from 'lucide-react';
import { BeforeAfterMode } from '../hooks/useBeforeAfterToggle';

interface ApplyRecommendationButtonProps {
  mode: BeforeAfterMode;
  onToggle: () => void;
  disabled?: boolean;
}

export function ApplyRecommendationButton({
  mode,
  onToggle,
  disabled = false,
}: ApplyRecommendationButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      style={{ padding: '10px 32px' }}
      className="inline-flex items-center gap-2.5 rounded-full border border-primary bg-primary/10 px-8 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Sparkles size={14} aria-hidden="true" />
      {mode === 'after' ? '현재 설정 결과 보기' : '추천안 결과 보기'}
    </button>
  );
}
