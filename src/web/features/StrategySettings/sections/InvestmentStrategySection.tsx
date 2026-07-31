'use client';

import { FieldRow, RadioCardGroup } from '../../../components/form';
import { DEFAULT_RETIREMENT_STRATEGY } from '../../../../core/usecases/strategy/compileStrategy';
import { isFieldVisible } from '../fieldVisibility';
import { ECONOMIC_SCENARIO_OPTIONS, RISK_PROFILE_OPTIONS, SectionProps } from '../strategyOptions';
import { AiRecommendationState } from '../useAiRecommendation';

type Props = SectionProps & { ai: AiRecommendationState };

export function InvestmentStrategySection({ params, onChangeParams, mode, changed, ai }: Props) {
  const strategy = { ...DEFAULT_RETIREMENT_STRATEGY, ...(params.strategy ?? {}) };

  const setStrategy = (patch: Partial<typeof strategy>) => {
    onChangeParams({ ...params, strategy: { ...strategy, ...patch } });
  };

  // AI가 배당 재투자 변경을 권하면 그 사실만 알린다(적용은 이 섹션의 AI 추천 버튼으로,
  // 실제 자산별 토글은 ③연금 전략 섹션에 있다). 리스크 성향과는 무관한 값이라 FieldRow의
  // aiHint(특정 필드용)에 붙이지 않고 별도 문구로 둔다.
  const reinvestHint = ai.improved && ai.recommendation?.recommendedAssetReinvestment
    ? '배당 재투자 설정 변경을 함께 권장합니다(연금 전략 섹션에서 확인).'
    : undefined;

  return (
    <>
      {isFieldVisible(mode, 'strategy.riskProfile') && (
        <FieldRow label="리스크 성향" changed={changed.has('strategy.riskProfile')}>
          <RadioCardGroup
            name="risk-profile" ariaLabel="리스크 성향" value={strategy.riskProfile}
            options={RISK_PROFILE_OPTIONS} onChange={(v) => setStrategy({ riskProfile: v })}
            columns={2}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'strategy.economicScenario') && (
        <FieldRow label="경제 시나리오" changed={changed.has('strategy.economicScenario')}>
          <RadioCardGroup
            name="economic-scenario" ariaLabel="경제 시나리오" value={strategy.economicScenario}
            options={ECONOMIC_SCENARIO_OPTIONS}
            onChange={(v) => setStrategy({ economicScenario: v })}
            columns={2}
          />
        </FieldRow>
      )}

      {reinvestHint && (
        <p className="text-xs text-primary">AI 추천: {reinvestHint}</p>
      )}

      <p className="text-xs text-foreground-muted">
        두 설정이 겹칠 때는 시나리오는 물가·환율을, 리스크 성향은 수익률을 결정합니다.
      </p>
    </>
  );
}
