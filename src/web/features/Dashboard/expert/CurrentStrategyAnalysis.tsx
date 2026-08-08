import { UtilityBreakdown, UtilityConfig } from '../../../../core/entities/types';
import { analyzeCurrentStrategy } from '../../../../core/usecases/utility/utilityAnalysis';
import { PlanAssetStatus } from '../../../../core/usecases/dashboard/resolvePlanAssetStatus';

interface CurrentStrategyAnalysisProps {
  utility: UtilityBreakdown;
  // 점수를 실제로 계산한 config. 넘기지 않으면 기본 배점이 쓰여, 목표 우선순위를 바꾼
  // 계획에서 "세금 효율이(가) 21/10점으로 우수합니다"처럼 만점을 넘긴 문장이 나온다.
  cfg: UtilityConfig;
  // 투자자산이 없는 계획에서 상속 자산 적정성이 만점인 것은 "잘해서"가 아니다 —
  // 그 사실을 문장이 밝히도록 상태를 함께 넘긴다.
  planAssetStatus?: PlanAssetStatus;
}

// UtilityCard.tsx에 있던 "현재 전략 분석"(강점/약점) 블록을 그대로 이관.
export function CurrentStrategyAnalysis({ utility, cfg, planAssetStatus }: CurrentStrategyAnalysisProps) {
  const { strengths, weaknesses } = analyzeCurrentStrategy(utility, cfg, { planAssetStatus });

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
