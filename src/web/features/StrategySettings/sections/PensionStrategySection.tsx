'use client';

import { FieldRow, RadioCardGroup, SwitchField } from '../../../components/form';
import { resolveStrategy } from '../../../../core/usecases/strategy/compileStrategy';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../../../../core/usecases/pension/nationalPensionRules';
import { isFieldVisible } from '../fieldVisibility';
import {
  AiRecommendationState, NATIONAL_PENSION_OPTIONS, PRIVATE_PENSION_OPTIONS, SectionProps,
} from '../strategyOptions';

type Props = SectionProps & {
  ai: AiRecommendationState;
  // 엔진에 실제로 들어간 국민연금 개시 나이. AI 배지의 '적용/추천' 판정에 쓴다.
  effectiveNationalPensionStartAge?: number;
};

export function PensionStrategySection({
  params, onChangeParams, mode, changed, ai, effectiveNationalPensionStartAge,
}: Props) {
  const strategy = resolveStrategy(params);

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
  // "이 값이 지금 계산에 들어가 있는가"로 판정한다. 전략이 'ai_optimized'인지로 판정하면 안 된다.
  //
  // 두 방향으로 틀린다. (1) 센티널이어도 자동 채움이 개선을 확인하지 못하면 채우지 않으므로
  // 엔진은 65세로 돈다. (2) 사용자가 「AI 추천」 버튼을 눌러 확정 전략으로 바꾸면 그 값이 실제로
  // 계산에 들어가는데도 배지가 '적용'에서 '추천'으로 내려간다 — 방금 적용한 사용자에게
  // 정반대 신호다.
  //
  // effectiveNationalPensionStartAge는 엔진에 실제로 들어간 나이(page.tsx의 effective)라
  // 두 경우 모두 옳게 판정된다.
  const nationalHintApplied =
    plan?.nationalPensionStartAge !== undefined
    && plan.nationalPensionStartAge === effectiveNationalPensionStartAge;

  // 추천 계산이 실패하면 'AI 최적화'는 채워질 값이 없어 baseline(65세)으로 계산된다.
  // 그 사실을 말하지 않으면 화면은 정상적으로 "개선 여지 없음"이 나온 경우와 픽셀 단위로
  // 같아서, 사용자는 AI가 골라 준 나이로 돌고 있다고 믿게 된다.
  const nationalFallbackNotice =
    ai.error && strategy.nationalPensionStrategy === 'ai_optimized'
      ? `${ai.error} 국민연금은 기본값(${NATIONAL_PENSION_NORMAL_START_AGE}세)으로 계산했습니다.`
      : undefined;

  // 사적연금 인출 전략에는 AI 힌트를 붙이지 않는다.
  //
  // 추천이 내놓는 privatePensionMonthlyTarget은 이 화면의 선택지로 표현할 수 없다:
  //   후보 격자   = targetMonthlySpending × {0.8, 1.0, 1.3}   (기본값 기준 280/350/455만원)
  //   표현 가능   = privatePensionLimit/12 × {1, 0.5, 0.25}   (125/62.5/31.25만원)
  // 교집합이 없어 어떤 값으로도 역매핑되지 않고, applyAiToSection도 이 축을 적용하지 않는다.
  // 적용할 수 없는 값을 "AI 추천"으로 보여주면 사용자는 추천을 따르려고 버튼을 눌렀다가
  // 아무 일도 일어나지 않는 것을 보게 된다. 가장 가까운 전략으로 억지 역매핑하는 방식은
  // 택하지 않았다 — 그러면 시뮬레이션한 적 없는 값을 "AI가 계산한 결과"로 제시하게 되고,
  // 이는 이 브랜치가 이미 한 번 제거한 결함 유형이다(시뮬레이션되지 않은 recommendedPlan 조작).

  return (
    <>
      {isFieldVisible(mode, 'strategy.nationalPensionStrategy') && (
        <FieldRow
          label="국민연금 수령 시작"
          tooltipText="늦게 받을수록 매달 받는 금액이 커집니다. 대신 받는 기간은 짧아집니다."
          changed={changed.has('strategy.nationalPensionStrategy')}
          aiHint={nationalHint}
          aiHintApplied={nationalHintApplied}
        >
          <RadioCardGroup
            name="national-pension-strategy" ariaLabel="국민연금 수령 시작" value={strategy.nationalPensionStrategy}
            options={NATIONAL_PENSION_OPTIONS}
            onChange={(v) => setStrategy({ nationalPensionStrategy: v })}
          />
          {nationalFallbackNotice && (
            <p className="text-xs text-warning">{nationalFallbackNotice}</p>
          )}
        </FieldRow>
      )}

      {isFieldVisible(mode, 'strategy.privatePensionStrategy') && (
        <FieldRow
          label="사적연금 인출 전략"
          tooltipTerm="irp"
          changed={changed.has('strategy.privatePensionStrategy')}
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
