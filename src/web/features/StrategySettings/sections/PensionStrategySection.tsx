'use client';

import { FieldRow, RadioCardGroup } from '../../../components/form';
import { resolveStrategy } from '../../../../core/usecases/strategy/compileStrategy';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../../../../core/usecases/pension/nationalPensionRules';
import { explainNationalPension, NationalPensionExplanation } from '../../../../core/usecases/pension/explainNationalPension';
import { formatManwon } from '../../../../core/usecases/utility/utilityAnalysis';
import { isFieldVisible } from '../fieldVisibility';
import {
  AiRecommendationState, DIVIDEND_OPTIONS, ISA_FIRST_OPTIONS, NATIONAL_PENSION_OPTIONS, PRIVATE_PENSION_OPTIONS,
  SectionProps,
} from '../strategyOptions';

type Props = SectionProps & {
  ai: AiRecommendationState;
  // 엔진에 실제로 들어간 국민연금 개시 나이. AI 배지의 '적용/추천' 판정에 쓴다.
  effectiveNationalPensionStartAge?: number;
  // 자동 채움이 이번 계산에서 배당 축을 실제로 채웠는가(sentinels.appliedFields).
  // 국민연금과 같은 이유로 화면이 스스로 판정하지 않는다 — 「AI 최적화」로 두어도 개선이
  // 확인되지 않으면 채우지 않으므로, 전략 값만 보고 '적용됨'이라 말하면 거짓이 된다.
  dividendAutoApplied?: boolean;
};

export function PensionStrategySection({
  params, onChangeParams, mode, changed, ai, effectiveNationalPensionStartAge, dividendAutoApplied,
}: Props) {
  const strategy = resolveStrategy(params);

  const setStrategy = (patch: Partial<typeof strategy>) => {
    onChangeParams({ ...params, strategy: { ...strategy, ...patch } });
  };

  // 「자동으로 선택」일 때 자산별로 저장된 값이 갈려 있으면 그 사실을 말해 준다. 그 값들은
  // 지워지지 않고 AI가 개선을 확인하지 못한 자산에서 그대로 계산에 쓰이므로, 화면이 아무
  // 말도 하지 않으면 "자동인데 왜 자산마다 다르지"를 확인할 방법이 없다.
  const perAssetMixed =
    params.assets.length > 0
    && !params.assets.every((a) => a.reinvestDividend === params.assets[0].reinvestDividend);

  const dividendRecommendedCount = ai.improved
    ? Object.keys(ai.recommendation?.recommendedAssetReinvestment ?? {}).length
    : 0;

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
          {/* 설정액이 실제 수령액이 되기까지의 단계. 없으면 사용자는 "월 200만원으로
              설정했는데 표에는 135만원"이라는 차이를 계산 오류로 읽는다. */}
          <NationalPensionBreakdown
            explanation={explainNationalPension(params, effectiveNationalPensionStartAge)}
          />
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
        <FieldRow
          label="ISA 만기 자금"
          tooltipTerm="isa"
          changed={changed.has('strategy.preferIsaFirst')}
        >
          <RadioCardGroup
            name="isa-first-choice" ariaLabel="ISA 만기 자금 행선지" value={strategy.preferIsaFirst}
            options={ISA_FIRST_OPTIONS}
            onChange={(v) => setStrategy({ preferIsaFirst: v })}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'strategy.dividendStrategy') && params.assets.length > 0 && (
        <FieldRow
          label="배당금 재투자"
          tooltipText="배당을 다시 사들이면 복리로 불어나지만 생활비로 쓰려면 자산을 팔아야 하고, 현금으로 받으면 그해 생활비가 되는 대신 복리가 멈춥니다."
          changed={changed.has('strategy.dividendStrategy')}
          aiHint={dividendRecommendedCount > 0 ? `자산 ${dividendRecommendedCount}개를 바꾸면 유리` : undefined}
          aiHintApplied={dividendAutoApplied}
        >
          <RadioCardGroup
            name="dividend-strategy" ariaLabel="배당금 재투자" value={strategy.dividendStrategy ?? 'ai_optimized'}
            options={DIVIDEND_OPTIONS}
            onChange={(v) => setStrategy({ dividendStrategy: v })}
          />
          {strategy.dividendStrategy === 'ai_optimized' && perAssetMixed && (
            <p className="text-xs text-foreground-muted">
              자산마다 저장된 설정이 다릅니다. 그 값이 기준선이 되고, 바꾸는 편이 나은 자산만 계산에서 뒤집힙니다.
              {mode === 'expert' ? ' 자산별 설정은 「내 자산」에서 바꿉니다.' : ''}
            </p>
          )}
        </FieldRow>
      )}
    </>
  );
}

// 설정한 국민연금 수령액이 실제 수령액이 되기까지의 단계를 그대로 펼친다.
//
// 조기수령 감액도 세금도 없으면(정상 개시 + 과세 없음) 렌더링하지 않는다 — 그때는
// 설정액과 수령액이 같아서 표가 아무것도 설명하지 않는다.
function NationalPensionBreakdown({ explanation }: { explanation: NationalPensionExplanation | null }) {
  if (!explanation || explanation.isPlain) return null;

  return (
    <div className="mt-2 rounded-lg border border-card-border/60 p-3 text-xs">
      <dl className="flex flex-col gap-1">
        {explanation.steps.map((step) => (
          <div
            key={step.label}
            className={`flex items-baseline justify-between gap-3 ${
              step.isTotal ? 'mt-1 border-t border-card-border/60 pt-1.5 font-semibold' : ''
            }`}
          >
            <dt className="text-foreground-muted">{step.label}</dt>
            <dd className={step.amount < 0 && !step.isTotal ? 'text-danger' : ''}>
              월 {step.amount < 0 && !step.isTotal ? '−' : ''}
              {formatManwon(Math.abs(step.amount))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] leading-snug text-foreground-muted">
        차트·표의 국민연금 금액은 이 실질 수령액입니다. {explanation.inflationNote} 건강보험료는
        여기서 차감하지 않고 별도로 부과됩니다.
      </p>
    </div>
  );
}
