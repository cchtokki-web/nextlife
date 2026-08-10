import { type ReactNode } from 'react';
import { Star } from 'lucide-react';
import { getRetirementGrade } from '../../../../core/entities/retirementGrade';
import { scoreToStars } from './gradeToStars';

interface RetirementLikelihoodStarsProps {
  score: number;
  maxStars?: number;
  // 등급 텍스트 오른쪽에 덧붙일 내용(예: "71점"). 별이 아니라 등급과 같은 줄에 놓인다.
  suffix?: ReactNode;
  // 점수에서 유도한 등급 대신 쓸 라벨. 시장 변동성을 반영한 판정(PlanConfidenceBand)이
  // 있을 때 쓴다 — 그 판정은 성공률에서 직접 나오므로 점수로는 유도할 수 없다.
  gradeLabel?: string;
}

export function RetirementLikelihoodStars({
  score, maxStars = 5, suffix, gradeLabel,
}: RetirementLikelihoodStarsProps) {
  const filled = scoreToStars(score);
  const grade = gradeLabel ?? getRetirementGrade(score);

  // 등급 텍스트는 별 아래 줄에 둔다. KPI 카드는 4열 그리드라 폭이 좁은데, 별 5개와
  // 텍스트를 한 줄에 욱여넣으면 "매우 안정"이 글자 단위로 세로로 쪼개진다.
  return (
    <div className="flex flex-col items-start gap-1">
      <div
        className="flex shrink-0 items-center gap-1"
        aria-label={`${grade} 등급, ${maxStars}점 만점에 ${filled}점`}
      >
        {Array.from({ length: maxStars }, (_, i) => (
          <Star
            key={i}
            size={18}
            fill={i < filled ? 'var(--warning)' : 'none'}
            stroke="var(--warning)"
            aria-hidden="true"
          />
        ))}
      </div>
      {/* 등급과 접미사는 각각 통째로 유지하고, 자리가 없으면 **줄 단위로** 넘긴다.
          예전에는 wrap 없이 한 줄에 밀어 넣어서 좁은 카드에서 "매우/위험", "38점 · 시장/변동 37%"
          처럼 어절 한가운데가 잘렸다. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-foreground-muted">
        {/* 등급은 위 aria-label이 이미 읽어 주므로 여기서는 시각 표시 전용이다.
            숨기지 않으면 스크린리더가 같은 등급을 두 번 말한다. */}
        <span className="whitespace-nowrap" aria-hidden="true">{grade}</span>
        {suffix}
      </div>
    </div>
  );
}
