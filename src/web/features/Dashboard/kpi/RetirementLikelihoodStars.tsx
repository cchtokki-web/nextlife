import { Star } from 'lucide-react';
import { getRetirementGrade } from '../../../../core/entities/retirementGrade';
import { scoreToStars } from './gradeToStars';

interface RetirementLikelihoodStarsProps {
  score: number;
  maxStars?: number;
}

export function RetirementLikelihoodStars({ score, maxStars = 5 }: RetirementLikelihoodStarsProps) {
  const filled = scoreToStars(score);
  const grade = getRetirementGrade(score);

  return (
    <div className="flex items-center gap-1" aria-label={`${grade} 등급, ${maxStars}점 만점에 ${filled}점`}>
      {Array.from({ length: maxStars }, (_, i) => (
        <Star
          key={i}
          size={18}
          fill={i < filled ? 'var(--warning)' : 'none'}
          stroke="var(--warning)"
          aria-hidden="true"
        />
      ))}
      <span className="ml-1 text-sm text-foreground-muted">{grade}</span>
    </div>
  );
}
