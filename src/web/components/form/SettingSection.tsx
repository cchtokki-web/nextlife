'use client';

import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Sparkles } from 'lucide-react';

interface SettingSectionProps {
  icon: ReactNode;
  title: string;
  // 접혀 있을 때 헤더에 보여줄 한 줄 요약 (예: "60세 은퇴 · 기대수명 85세").
  summary?: string;
  changedCount?: number;
  // 현재 모드에서 숨겨져 있지만 기본값과 다른 필드 수. 안 보이는 값이 결과에
  // 영향을 준다는 사실을 숨기지 않기 위해 표시한다.
  hiddenChangedCount?: number;
  defaultOpen?: boolean;
  // 방금 값이 바뀐 섹션이면 true. 테두리를 잠깐 강조해 "무엇이 결과를 바꿨는지"를 알린다.
  highlighted?: boolean;
  onAiRecommend?: () => void;
  aiDisabled?: boolean;
  aiLabel?: string;
  children: ReactNode;
}

// 6개 전략 섹션이 공유하는 아코디언 셸.
// ui/Collapse를 쓰지 않는 이유: 헤더 안에 별도 클릭 대상(AI 추천 버튼)이 필요한데
// Collapse는 헤더 전체가 하나의 <button>이라 버튼 중첩이 된다.
export function SettingSection({
  icon, title, summary, changedCount = 0, hiddenChangedCount = 0,
  defaultOpen = false, highlighted = false,
  onAiRecommend, aiDisabled = false, aiLabel = 'AI 추천', children,
}: SettingSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div
      data-highlighted={highlighted || undefined}
      className={`rounded-2xl border transition-colors duration-300 ${
        highlighted ? 'border-primary bg-primary/5' : 'border-card-border'
      }`}
    >
      <div className="flex items-center gap-2 px-3">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={() => setIsOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 py-3 text-left"
        >
          <span className="shrink-0 text-primary" aria-hidden="true">{icon}</span>
          <span className="flex min-w-0 flex-col">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold text-foreground">{title}</span>
              {changedCount > 0 && (
                <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {changedCount}개 변경
                </span>
              )}
              {hiddenChangedCount > 0 && (
                <span className="rounded-full border border-card-border px-1.5 py-0.5 text-[10px] text-foreground-muted">
                  숨겨진 사용자 설정 {hiddenChangedCount}개
                </span>
              )}
            </span>
            {!isOpen && summary && (
              <span className="truncate text-xs text-foreground-muted">{summary}</span>
            )}
          </span>
        </button>

        {onAiRecommend && (
          <button
            type="button"
            onClick={onAiRecommend}
            disabled={aiDisabled}
            // 화면에는 aiLabel("AI 추천")만 보이지만, 접근성 이름에는 섹션 제목을 덧붙인다.
            // 6개 섹션 중 셋(연금·투자 등)이 모두 같은 aiLabel을 쓰므로, 이 이름이 없으면
            // 스크린리더 사용자가 role+name으로 이동할 때 버튼을 구분할 수 없다.
            aria-label={`${title} ${aiLabel}`}
            className="flex shrink-0 items-center gap-1 rounded-full border border-primary/40 px-2.5 py-1 text-xs font-semibold text-primary transition disabled:cursor-not-allowed disabled:border-card-border disabled:text-foreground-muted"
          >
            <Sparkles size={12} aria-hidden="true" />
            {aiLabel}
          </button>
        )}

        <motion.span
          className="shrink-0 text-foreground-muted"
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          aria-hidden="true"
        >
          <ChevronDown size={16} />
        </motion.span>
      </div>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={contentId}
            role="region"
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex flex-col gap-4 px-3 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
