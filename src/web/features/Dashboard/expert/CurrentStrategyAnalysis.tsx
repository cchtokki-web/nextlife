import { UtilityBreakdown } from '../../../../core/entities/types';
import { analyzeCurrentStrategy } from '../../../../core/usecases/utility/utilityAnalysis';

interface CurrentStrategyAnalysisProps {
  utility: UtilityBreakdown;
}

// UtilityCard.tsx에 있던 "현재 전략 분석"(강점/약점) 블록을 그대로 이관.
export function CurrentStrategyAnalysis({ utility }: CurrentStrategyAnalysisProps) {
  const { strengths, weaknesses } = analyzeCurrentStrategy(utility);

  return (
    <div>
      <span className="text-sm font-semibold">📋 현재 전략 분석</span>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <span className="text-xs font-semibold text-success">장점</span>
          <ul className="mt-1 flex flex-col gap-1 pl-4 text-xs text-foreground-muted">
            {strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
        <div>
          <span className="text-xs font-semibold text-warning">단점</span>
          <ul className="mt-1 flex flex-col gap-1 pl-4 text-xs text-foreground-muted">
            {weaknesses.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
