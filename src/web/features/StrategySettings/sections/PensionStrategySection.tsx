'use client';

import { FieldRow, RadioCardGroup, SwitchField } from '../../../components/form';
import { DEFAULT_RETIREMENT_STRATEGY } from '../../../../core/usecases/strategy/compileStrategy';
import { isFieldVisible } from '../fieldVisibility';
import {
  NATIONAL_PENSION_OPTIONS, PRIVATE_PENSION_OPTIONS, SectionProps,
} from '../strategyOptions';
import { AiRecommendationState } from '../useAiRecommendation';

type Props = SectionProps & { ai: AiRecommendationState };

export function PensionStrategySection({ params, onChangeParams, mode, changed, ai }: Props) {
  const strategy = { ...DEFAULT_RETIREMENT_STRATEGY, ...(params.strategy ?? {}) };

  const setStrategy = (patch: Partial<typeof strategy>) => {
    onChangeParams({ ...params, strategy: { ...strategy, ...patch } });
  };

  // 배당 재투자 스위치는 "설정"이 아니라 "일괄 적용 버튼"이다. 표시 상태는 자산들에서
  // 파생하고(모두 켜짐 / 모두 꺼짐 / 혼합), 누르면 그 순간 모든 자산을 갱신한다.
  // compileStrategy는 이 값을 건드리지 않으므로 이후 자산별로 고친 값이 그대로 살아남는다.
  const reinvestState: 'all' | 'none' | 'mixed' =
    params.assets.every((a) => a.reinvestDividend) ? 'all'
      : params.assets.every((a) => !a.reinvestDividend) ? 'none'
        : 'mixed';

  const applyReinvestToAllAssets = (next: boolean) => {
    onChangeParams({
      ...params,
      assets: params.assets.map((a) => ({ ...a, reinvestDividend: next })),
    });
  };

  const plan = ai.improved ? ai.recommendation?.recommendedPlan : undefined;
  const nationalHint = plan?.nationalPensionStartAge !== undefined
    ? `${plan.nationalPensionStartAge}세부터 수령`
    : undefined;
  const privateHint = plan?.privatePensionMonthlyTarget !== undefined
    ? `월 ${Math.round(plan.privatePensionMonthlyTarget / 10000).toLocaleString()}만원 인출`
    : undefined;

  return (
    <>
      {isFieldVisible(mode, 'strategy.nationalPensionStrategy') && (
        <FieldRow
          label="국민연금 수령 시작"
          tooltipText="늦게 받을수록 매달 받는 금액이 커집니다. 대신 받는 기간은 짧아집니다."
          changed={changed.has('strategy.nationalPensionStrategy')}
          aiHint={nationalHint}
        >
          <RadioCardGroup
            name="national-pension-strategy" ariaLabel="국민연금 수령 시작" value={strategy.nationalPensionStrategy}
            options={NATIONAL_PENSION_OPTIONS}
            onChange={(v) => setStrategy({ nationalPensionStrategy: v })}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'strategy.privatePensionStrategy') && (
        <FieldRow
          label="사적연금 인출 전략"
          tooltipTerm="irp"
          changed={changed.has('strategy.privatePensionStrategy')}
          aiHint={privateHint}
        >
          <RadioCardGroup
            name="private-pension-strategy" ariaLabel="사적연금 인출 전략" value={strategy.privatePensionStrategy}
            options={PRIVATE_PENSION_OPTIONS}
            onChange={(v) => setStrategy({ privatePensionStrategy: v })}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'strategy.preferIsaFirst') && (
        <SwitchField
          label="ISA 먼저 사용"
          description="ISA 만기 자금을 연금으로 옮기지 않고 생활비로 먼저 씁니다."
          tooltipTerm="isa"
          checked={strategy.preferIsaFirst}
          onChange={(v) => setStrategy({ preferIsaFirst: v })}
          changed={changed.has('strategy.preferIsaFirst')}
        />
      )}

      {isFieldVisible(mode, 'assets.reinvestDividend') && params.assets.length > 0 && (
        <SwitchField
          label="배당금 재투자"
          description={
            reinvestState === 'mixed'
              ? '자산마다 다르게 설정되어 있습니다. 여기서 켜거나 끄면 모든 자산에 한 번에 적용됩니다.'
              : '받은 배당을 쓰지 않고 다시 사들여 복리로 굴립니다. 모든 자산에 한 번에 적용됩니다.'
          }
          checked={reinvestState === 'all'}
          onChange={applyReinvestToAllAssets}
          changed={changed.has('assets.reinvestDividend')}
        />
      )}
    </>
  );
}
