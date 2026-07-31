'use client';

import InputField from '../../../components/InputField';
import { FieldRow, RadioCardGroup } from '../../../components/form';
import { isFieldVisible } from '../fieldVisibility';
import {
  BEQUEST_OPTIONS, OBJECTIVE_OPTIONS, SPENDING_STRATEGY_OPTIONS, SectionProps,
} from '../strategyOptions';
import { DEFAULT_RETIREMENT_STRATEGY } from '../../../../core/usecases/strategy/compileStrategy';
import { AiRecommendationState } from '../useAiRecommendation';

type Props = SectionProps & { ai: AiRecommendationState };

function formatManwon(krw: number): string {
  return `${Math.round(krw / 10000).toLocaleString()}만원`;
}

export function RetirementGoalSection({ params, onChangeParams, mode, changed, ai }: Props) {
  const strategy = { ...DEFAULT_RETIREMENT_STRATEGY, ...(params.strategy ?? {}) };
  const spendingChoice = strategy.spendingChoice;

  const setStrategy = (patch: Partial<typeof strategy>) => {
    onChangeParams({ ...params, strategy: { ...strategy, ...patch } });
  };

  const multiplier = ai.improved
    ? ai.recommendation?.recommendedPlan?.monthlySpendingMultiplier
    : undefined;
  const spendingHint = multiplier !== undefined && multiplier !== 1
    ? formatManwon(params.userProfile.targetMonthlySpending * multiplier)
    : undefined;

  return (
    <>
      {isFieldVisible(mode, 'strategy.spendingChoice') && (
        <FieldRow label="생활비 전략" changed={changed.has('strategy.spendingChoice')}>
          <RadioCardGroup
            name="spending-strategy" ariaLabel="생활비 전략" value={spendingChoice}
            options={SPENDING_STRATEGY_OPTIONS}
            onChange={(v) => setStrategy({ spendingChoice: v })}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'userProfile.targetMonthlySpending') && spendingChoice === 'target' && (
        <FieldRow
          label="목표 월 생활비"
          changed={changed.has('userProfile.targetMonthlySpending')}
          aiHint={spendingHint}
        >
          <InputField
            label="" aria-label="목표 월 생활비" type="text"
            suffixText={params.displayCurrency === 'KRW' ? '원' : params.displayCurrency}
            value={params.userProfile.targetMonthlySpending.toLocaleString()}
            onChange={(e) => {
              const raw = e.target.value.replace(/,/g, '');
              if (raw === '' || !isNaN(Number(raw))) {
                onChangeParams({
                  ...params,
                  userProfile: {
                    ...params.userProfile,
                    targetMonthlySpending: raw === '' ? 0 : Number(raw),
                  },
                });
              }
            }}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'strategy.objective') && (
        <FieldRow
          label="목표 우선순위"
          tooltipText="이 선택이 모든 추천의 기준이 됩니다. 무엇을 가장 중요하게 볼지 정하세요."
          changed={changed.has('strategy.objective')}
        >
          <RadioCardGroup
            name="objective" ariaLabel="목표 우선순위" value={strategy.objective}
            options={OBJECTIVE_OPTIONS} onChange={(v) => setStrategy({ objective: v })}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'strategy.bequestStrategy') && (
        <FieldRow label="상속 전략" changed={changed.has('strategy.bequestStrategy')}>
          <RadioCardGroup
            name="bequest-strategy" ariaLabel="상속 전략" value={strategy.bequestStrategy}
            options={BEQUEST_OPTIONS} onChange={(v) => setStrategy({ bequestStrategy: v })}
            columns={2}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'userProfile.targetBequest') && strategy.bequestStrategy === 'target_amount' && (
        <FieldRow label="목표 상속자산" changed={changed.has('userProfile.targetBequest')}>
          <InputField
            label="" aria-label="목표 상속자산" type="text" suffixText="원"
            value={(params.userProfile.targetBequest ?? 0).toLocaleString()}
            onChange={(e) => {
              const raw = e.target.value.replace(/,/g, '');
              if (raw === '' || !isNaN(Number(raw))) {
                onChangeParams({
                  ...params,
                  userProfile: {
                    ...params.userProfile,
                    targetBequest: raw === '' ? 0 : Number(raw),
                  },
                });
              }
            }}
          />
        </FieldRow>
      )}
    </>
  );
}
