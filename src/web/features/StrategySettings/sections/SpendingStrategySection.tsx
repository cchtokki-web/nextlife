'use client';

import { FieldRow, RadioCardGroup } from '../../../components/form';
import { resolveStrategy } from '../../../../core/usecases/strategy/compileStrategy';
import { normalizeGoalDrivenParams } from '../../../../core/usecases/goals/normalizeGoalDrivenParams';
import { describeSpendingCurve, resolveSpendingCurve } from '../../../../core/usecases/spending/spendingCurve';
import { formatValue } from '../../Dashboard/charts/chartFormatters';
import { isFieldVisible } from '../fieldVisibility';
import { SPENDING_SHAPE_OPTIONS, SectionProps } from '../strategyOptions';

// 「생활비 배분」 축의 유일한 편집 경로.
//
// 이 섹션이 없으면 추천의 「생활비 배분」이 계획에 곡선을 넣고도 되돌릴 컨트롤이 화면에
// 하나도 없다 — 화면에 없는 값이 목표 생활비를 나이대별로 움직이던 예전 상태다. 그래서
// compileStrategy가 생활비 모드를 따지지 않게 된 변경과 이 섹션은 함께 움직여야 한다.
//
// 목표 «총액»(월 350만원)은 여기서 정하지 않는다 — 「은퇴 목표」 카드가 유일한 편집
// 경로다. 이 섹션이 정하는 것은 그 총액을 연령대에 어떻게 나눌지뿐이다.
export function SpendingStrategySection({ params, onChangeParams, mode, changed }: SectionProps) {
  const strategy = resolveStrategy(params);

  // 구간을 정규화된 프로필로 계산한다. 저장된 옛 은퇴 나이를 그대로 쓰면 첫 구간이 계산과
  // 다른 나이에서 시작해, 미리보기가 실제 계획을 설명하지 못한다
  // (RetirementInputFlow의 목표 시드가 같은 이유로 같은 함수를 지난다).
  const profile = normalizeGoalDrivenParams(params, strategy).userProfile;
  const bands = describeSpendingCurve(
    resolveSpendingCurve(strategy.spendingShape),
    profile.targetMonthlySpending,
    profile.retirementAge,
    profile.expectancy,
  );

  if (!isFieldVisible(mode, 'strategy.spendingShape')) return null;

  return (
    <>
      <FieldRow
        label="생활비 배분"
        tooltipText="은퇴 후 목표 생활비를 나이대별로 나누는 방식입니다. 총액은 「은퇴 목표」에서 정합니다."
        changed={changed.has('strategy.spendingShape')}
      >
        <RadioCardGroup
          name="spending-shape"
          ariaLabel="생활비 배분"
          value={strategy.spendingShape ?? 'flat'}
          options={SPENDING_SHAPE_OPTIONS}
          onChange={(v) => onChangeParams({ ...params, strategy: { ...strategy, spendingShape: v } })}
          columns={1}
        />
      </FieldRow>

      {/* 고르는 «그 자리»에서 결과를 보여준다. 이 선택은 은퇴 목표 단계에서 입력한 월 생활비의
          뜻을 나이대별로 바꾸므로, 금액이 보이지 않으면 총액을 정한 화면과 이 화면이 서로 다른
          말을 하는 것처럼 읽힌다. */}
      {bands.length > 0 && (
        <div className="pt-1" data-testid="spending-band-preview">
          <p className="text-xs font-semibold text-foreground">이 계획의 월 생활비 목표</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {bands.map((band) => (
              <li key={band.fromAge} className="flex justify-between text-xs text-foreground-muted">
                <span>{band.fromAge}~{band.toAge ?? profile.expectancy}세</span>
                <span className="font-semibold text-foreground">
                  {formatValue(band.monthlyAmount, params.displayCurrency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs leading-relaxed text-foreground-muted/90 pt-1">
        「일정하게 유지」가 아닌 값을 고르면 은퇴 목표의 월 생활비가 나이대별로 달라집니다.
        경계는 70세와 80세이며, 목표 달성 확률도 그렇게 조정된 금액을 기준으로 판정합니다.
      </p>
    </>
  );
}
