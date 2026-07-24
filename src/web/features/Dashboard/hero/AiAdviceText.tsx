'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, RefreshCcw } from 'lucide-react';

interface AiAdviceTextProps {
  displayAdvice: string;
  isLoading: boolean;
  error: string | null;
  isRuleBased: boolean;
  isStale: boolean;
  onRetry: () => void;
}

// UtilityCard.tsx에 있던 AI 의견 렌더링 로직(로딩 점 애니메이션/굵게 표시/stale 오버레이)을
// 그대로 이관한 프레젠테이션 컴포넌트. useAiAdvisor 훅의 결과를 그대로 props로 받는다.
export function AiAdviceText({ displayAdvice, isLoading, error, isRuleBased, isStale, onRetry }: AiAdviceTextProps) {
  const lines = displayAdvice.split('\n');

  return (
    <div className="relative">
      {isRuleBased && !isLoading && (
        <span className="mb-2 inline-block rounded-full border border-card-border px-2 py-0.5 text-xs font-semibold text-foreground-muted">
          AI 서버 연결 불가 · 기본 안내 표시 중
        </span>
      )}
      <div
        className="transition-[filter,opacity] duration-300"
        style={{ filter: isStale && !isLoading ? 'blur(2px)' : 'none', opacity: isStale && !isLoading ? 0.6 : 1 }}
      >
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : displayAdvice === '' && isLoading ? (
          <div className="flex items-center gap-1.5 py-1">
            {[0, 0.15, 0.3].map((delay) => (
              <motion.span
                key={delay}
                animate={{ y: [0, -6, 0] }}
                transition={{ repeat: Infinity, duration: 0.8, delay }}
                className="h-1.5 w-1.5 rounded-full bg-primary"
              />
            ))}
            <span className="ml-2 text-sm text-foreground-muted">AI 분석 의견을 작성하고 있습니다...</span>
          </div>
        ) : (
          <p className="whitespace-pre-line text-sm leading-relaxed">
            {lines.map((line, i) => (
              <React.Fragment key={i}>
                {line.split(/(\*\*.*?\*\*)/g).map((part, j) =>
                  part.startsWith('**') && part.endsWith('**') ? (
                    <strong key={j} className="rounded bg-primary/15 px-1 font-bold text-primary">
                      {part.slice(2, -2)}
                    </strong>
                  ) : (
                    <React.Fragment key={j}>{part}</React.Fragment>
                  )
                )}
                {i < lines.length - 1 && <br />}
              </React.Fragment>
            ))}
            {isLoading && <Loader2 size={16} className="ml-2 inline animate-spin text-primary" aria-hidden="true" />}
          </p>
        )}
      </div>

      <AnimatePresence>
        {isStale && !isRuleBased && !isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/5 backdrop-blur-sm"
          >
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-2 rounded-full border border-primary bg-background px-4 py-2 text-sm font-semibold shadow-lg"
            >
              <RefreshCcw size={14} aria-hidden="true" />
              의견 업데이트
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
