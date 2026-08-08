'use client';

import InputField from '../../../components/InputField';
import { FieldRow, RadioCardGroup } from '../../../components/form';
import { currencySuffix } from '../currencySuffix';
import { isFieldVisible } from '../fieldVisibility';
import {
  AiRecommendationState, BEQUEST_OPTIONS, OBJECTIVE_OPTIONS, SPENDING_SHAPE_OPTIONS,
  SPENDING_STRATEGY_OPTIONS, SectionProps,
} from '../strategyOptions';
import { resolveStrategy } from '../../../../core/usecases/strategy/compileStrategy';
import { DEFAULT_UTILITY_CONFIG } from '../../../../core/usecases/utility/utilityWeights';
import { BequestStrategy } from '../../../../core/entities/types';

type Props = SectionProps & { ai: AiRecommendationState };

function formatManwon(krw: number): string {
  return `${Math.round(krw / 10000).toLocaleString()}만원`;
}

export function RetirementGoalSection({ params, onChangeParams, mode, changed, ai }: Props) {
  const strategy = resolveStrategy(params);
  const spendingChoice = strategy.spendingChoice;

  // 엔진이 인출액을 다른 규칙(배당액 / 역산된 최대 생활비)으로 정하는 전략. 이때도 목표
  // 월 생활비는 채점의 분모로 계속 쓰이므로, 입력은 보여주되 역할이 달라졌음을 알린다.
  const spendingUsedForScoringOnly =
    spendingChoice === 'dividend_only' || spendingChoice === 'max_sustainable';

  const setStrategy = (patch: Partial<typeof strategy>) => {
    onChangeParams({ ...params, strategy: { ...strategy, ...patch } });
  };

  // '목표 금액 유지'는 사용자가 넣은 금액이 있어야만 의미가 있다. 미설정인 채로 두면 입력은
  // `?? 0` 폴백 때문에 "0원"을 보여주는데, compileStrategy의 resolveTargetBequest는 undefined를
  // 돌려주고 그 키를 지워버려 엔진은 '최대 상속'과 완전히 동일하게 동작한다(UtilityEngine이
  // 월 생활비 × appropriateBequestMonths를 적정선으로 추정). 화면은 0원, 엔진은 8,400만원인
  // 상태가 조용히 만들어진다. 그래서 고르는 순간 엔진이 쓰던 바로 그 추정치를 시드로 채워
  // 화면과 엔진을 일치시키고, 사용자에게는 조정할 출발점을 준다.
  const handleBequestStrategyChange = (v: BequestStrategy) => {
    if (v === 'target_amount' && params.userProfile.targetBequest === undefined) {
      onChangeParams({
        ...params,
        strategy: { ...strategy, bequestStrategy: v },
        userProfile: {
          ...params.userProfile,
          targetBequest:
            params.userProfile.targetMonthlySpending * DEFAULT_UTILITY_CONFIG.appropriateBequestMonths,
        },
      });
      return;
    }
    setStrategy({ bequestStrategy: v });
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

      {/*
        네 선택지 모두에서 이 입력을 보여준다.

        'target'/'ai': compileStrategy의 resolveSpendingStrategy가 'ai'를 baseline인 'target'으로
        내리므로 엔진은 이 금액을 그대로 인출 목표로 쓴다. 게다가 AI 제안값(aiHint)이 붙어 있는
        곳이 바로 이 행이라, 제안을 받으려고 고른 선택지에서 정작 제안이 사라지는 모순도 생긴다.

        'dividend_only'/'max_sustainable': 인출액은 이 금액이 정하지 않지만,
        UtilityEngine.targetAnnualSpendingForYear가 **모든** 전략에서 이 값을 소비 만족도의
        분모(= 충족해야 할 "필요")로 쓴다. 숨기면 사용자가 볼 수도 고칠 수도 없는 값이 점수를
        좌우한다 — C2와 정확히 같은 결함이다. 'max_sustainable'의 계산 결과
        (result.calculatedTargetSpending)를 분모로 대신 쓰면 비율이 항상 1이 되어 월 50만원짜리
        계획과 월 500만원짜리 계획이 같은 점수를 받으므로, 분모는 사용자가 말한 "필요"여야 한다.
      */}
      {isFieldVisible(mode, 'userProfile.targetMonthlySpending') && (
        <FieldRow
          label="목표 월 생활비"
          tooltipText={spendingChoice === 'ai'
            ? '생활비 제안을 받아도 계산은 이 금액을 인출 목표로 사용합니다. 옆의 추천값을 확인한 뒤 직접 조정하거나 섹션의 추천값 반영 버튼을 누르세요.'
            : undefined}
          changed={changed.has('userProfile.targetMonthlySpending')}
          aiHint={spendingHint}
        >
          <InputField
            label="" aria-label="목표 월 생활비" type="text"
            suffixText={currencySuffix(params.displayCurrency)}
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
          {spendingUsedForScoringOnly && (
            <p className="text-xs leading-relaxed text-foreground-muted/90 pt-1">
              이 전략에서는 인출액을 이 금액으로 정하지 않습니다. 다만 소비 만족도 점수를 매길 때
              &ldquo;필요 생활비&rdquo; 기준으로 쓰이므로, 실제로 필요한 금액을 넣어 주세요.
            </p>
          )}
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
            options={BEQUEST_OPTIONS} onChange={handleBequestStrategyChange}
            columns={2}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'userProfile.targetBequest') && strategy.bequestStrategy === 'target_amount' && (
        <FieldRow label="목표 상속자산" changed={changed.has('userProfile.targetBequest')}>
          <InputField
            label="" aria-label="목표 상속자산" type="text"
            suffixText={currencySuffix(params.displayCurrency)}
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

      {/*
        아래 셋은 「평생 소비 최적화」에서만 보인다. 다른 전략에서는 인출액을 목표 생활비나
        배당액이 정하므로 "연령대별 배분"과 "역산 결과가 너무 낮은가"라는 질문 자체가
        성립하지 않는다. 상속 안전마진도 지켜야 할 금액(목표 상속자산)이 있어야 의미가 있다.
      */}
      {isFieldVisible(mode, 'strategy.spendingShape') && spendingChoice === 'max_sustainable' && (
        <FieldRow
          label="소비 성향"
          tooltipText="연령대별로 생활비를 어떻게 나눌지 정합니다. 금액이 아니라 배분 모양을 고르는 것이며, 실제 금액은 자산에서 역산됩니다."
          changed={changed.has('strategy.spendingShape')}
        >
          <RadioCardGroup
            name="spending-shape" ariaLabel="소비 성향"
            value={strategy.spendingShape ?? 'flat'}
            options={SPENDING_SHAPE_OPTIONS}
            onChange={(v) => setStrategy({ spendingShape: v })}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'strategy.minMonthlySpending') && spendingChoice === 'max_sustainable' && (
        <FieldRow
          label="최소 생활비"
          tooltipText="역산된 금액이 이 값에 못 미치면 결과 화면에서 알려줍니다. 계산 자체를 바꾸지는 않습니다."
          changed={changed.has('strategy.minMonthlySpending')}
        >
          <InputField
            label="" aria-label="최소 생활비" type="text"
            suffixText={currencySuffix(params.displayCurrency)}
            value={(strategy.minMonthlySpending ?? 0).toLocaleString()}
            onChange={(e) => {
              const raw = e.target.value.replace(/,/g, '');
              if (raw === '' || !isNaN(Number(raw))) {
                setStrategy({ minMonthlySpending: raw === '' ? 0 : Number(raw) });
              }
            }}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'strategy.bequestSafetyMarginRate')
        && spendingChoice === 'max_sustainable'
        && strategy.bequestStrategy === 'target_amount' && (
        <FieldRow
          label="자산 안전마진"
          tooltipText="목표 상속자산 위에 얹는 여유분입니다. 시장이 예상만큼 따라주지 않을 경우를 대비해 그만큼 덜 쓰도록 계산합니다. 상속 목표 금액 자체는 바뀌지 않습니다."
          changed={changed.has('strategy.bequestSafetyMarginRate')}
        >
          <InputField
            label="" aria-label="자산 안전마진" type="number" suffixText="%"
            value={String(strategy.bequestSafetyMarginRate ?? 0)}
            onChange={(e) => {
              const raw = e.target.value;
              const parsed = Number(raw);
              if (raw === '' || !isNaN(parsed)) {
                setStrategy({ bequestSafetyMarginRate: raw === '' ? 0 : Math.max(0, parsed) });
              }
            }}
          />
        </FieldRow>
      )}
    </>
  );
}
