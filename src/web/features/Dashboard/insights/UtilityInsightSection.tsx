import GlassCard from '../../../components/GlassCard';
import { BequestStrategy, UtilityBreakdown, UtilityConfig } from '../../../../core/entities/types';
import { PlanAssetStatus } from '../../../../core/usecases/dashboard/resolvePlanAssetStatus';
import { UtilityComponentExplanations } from '../../../../core/usecases/utility/explainUtilityComponents';
import { UtilityBreakdownBars } from '../expert/UtilityBreakdownBars';
import { CurrentStrategyAnalysis } from '../expert/CurrentStrategyAnalysis';

interface UtilityInsightSectionProps {
  utility: UtilityBreakdown;
  // 점수를 실제로 계산한 config. 막대의 분모와 강점/약점 문장의 분모가 같은 출처를
  // 봐야 한 화면 안에서 두 숫자가 어긋나지 않는다.
  utilityConfig: UtilityConfig;
  // 상속 자산 적정성 강점 문구가 '남길 자산이 없어서 만점'이라는 사실을 밝히도록 중계한다.
  planAssetStatus?: PlanAssetStatus;
  // 축별 점수 근거. 막대 아래 한 줄로 항상 노출한다.
  utilityExplanations?: UtilityComponentExplanations;
  bequestAdequacyExplanation?: string;
  // 상속 축의 이름을 정한다 — 「모두 사용」에서는 '자산 소진도'다.
  bequestStrategy?: BequestStrategy;
}

// "평생 효용 점수 구성"과 "현재 전략 분석"을 ExpertDetailsPanel의 Collapse(기본 닫힘)에서
// 꺼내 기본 화면에 항상 보이도록 승격한 섹션. 계산 로직은 그대로(UtilityBreakdownBars/
// CurrentStrategyAnalysis/explainBequestAdequacy) 재사용하고 배치 위치만 바꾼다.
export function UtilityInsightSection({
  utility, utilityConfig, planAssetStatus, utilityExplanations, bequestAdequacyExplanation, bequestStrategy,
}: UtilityInsightSectionProps) {
  return (
    <GlassCard>
      <div className="flex flex-col gap-6">
        <section>
          <h4 className="mb-2 text-sm font-semibold">평생 효용 점수 구성</h4>
          <UtilityBreakdownBars
            utility={utility}
            weights={utilityConfig.weights}
            explanations={utilityExplanations}
            bequestStrategy={bequestStrategy}
          />
          {bequestAdequacyExplanation && (
            <p className="mt-2 text-xs text-foreground-muted">
              * {bequestStrategy === 'spend_all' ? '자산 소진도' : '상속 자산 적정성'}: {bequestAdequacyExplanation}
            </p>
          )}
        </section>

        <section>
          <CurrentStrategyAnalysis utility={utility} cfg={utilityConfig} planAssetStatus={planAssetStatus} />
        </section>
      </div>
    </GlassCard>
  );
}
