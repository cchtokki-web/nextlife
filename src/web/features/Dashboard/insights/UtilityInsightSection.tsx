import GlassCard from '../../../components/GlassCard';
import { UtilityBreakdown } from '../../../../core/entities/types';
import { UtilityBreakdownBars } from '../expert/UtilityBreakdownBars';
import { CurrentStrategyAnalysis } from '../expert/CurrentStrategyAnalysis';

interface UtilityInsightSectionProps {
  utility: UtilityBreakdown;
  bequestAdequacyExplanation?: string;
}

// "평생 효용 점수 구성"과 "현재 전략 분석"을 ExpertDetailsPanel의 Collapse(기본 닫힘)에서
// 꺼내 기본 화면에 항상 보이도록 승격한 섹션. 계산 로직은 그대로(UtilityBreakdownBars/
// CurrentStrategyAnalysis/explainBequestAdequacy) 재사용하고 배치 위치만 바꾼다.
export function UtilityInsightSection({ utility, bequestAdequacyExplanation }: UtilityInsightSectionProps) {
  return (
    <GlassCard className="mb-6">
      <div className="flex flex-col gap-6">
        <section>
          <h4 className="mb-2 text-sm font-semibold">평생 효용 점수 구성</h4>
          <UtilityBreakdownBars utility={utility} />
          {bequestAdequacyExplanation && (
            <p className="mt-2 text-xs text-foreground-muted">* 상속 자산 적정성: {bequestAdequacyExplanation}</p>
          )}
        </section>

        <section>
          <CurrentStrategyAnalysis utility={utility} />
        </section>
      </div>
    </GlassCard>
  );
}
