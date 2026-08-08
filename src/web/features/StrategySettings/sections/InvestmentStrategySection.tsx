'use client';

import { FieldRow, RadioCardGroup } from '../../../components/form';
import { resolveStrategy } from '../../../../core/usecases/strategy/compileStrategy';
import { isFieldVisible } from '../fieldVisibility';
import {
  AiRecommendationState, ECONOMIC_SCENARIO_OPTIONS, RISK_PROFILE_OPTIONS, SectionProps,
} from '../strategyOptions';

type Props = SectionProps & { ai: AiRecommendationState };

export function InvestmentStrategySection({ params, onChangeParams, mode, changed, ai }: Props) {
  const strategy = resolveStrategy(params);

  const setStrategy = (patch: Partial<typeof strategy>) => {
    onChangeParams({ ...params, strategy: { ...strategy, ...patch } });
  };

  // AI가 배당 재투자 변경을 권하면 그 사실만 알리고, 어디서 적용하는지 가리킨다.
  // 이 섹션에는 적용 버튼이 없다 — 스위치도 적용 버튼도 「연금 전략」에 있다(그 섹션은
  // 모든 모드에서 보이고, 이 섹션은 간편 모드에서 통째로 사라진다).
  // 리스크 성향과는 무관한 값이라 FieldRow의 aiHint(특정 필드용)에 붙이지 않고 별도 문구로 둔다.
  const reinvestHint = ai.improved && ai.recommendation?.recommendedAssetReinvestment
    ? '배당 재투자 설정 변경을 함께 권장합니다. 「연금 전략」의 추천값 반영 버튼으로 적용할 수 있습니다.'
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
        <p className="text-xs text-primary">추천값 있음: {reinvestHint}</p>
      )}

      {(isFieldVisible(mode, 'strategy.riskProfile')
        || isFieldVisible(mode, 'strategy.economicScenario')) && (
        <p className="text-xs leading-relaxed text-foreground-muted/90 pt-1">
          경제 시나리오는 물가·환율뿐 아니라 보유 자산과 사적연금의 수익률까지 함께 바꿉니다.
          리스크 성향을 &ldquo;입력 수익률 유지&rdquo;가 아닌 값으로 고른 경우에만, 그 수익률을 리스크 성향이 다시 덮어씁니다.
        </p>
      )}
    </>
  );
}
