'use client';

import { useState } from 'react';
import { BarChart3, UserRound, WalletCards } from 'lucide-react';
import type { SimulationParams } from '../../../core/entities/types';
import { applyRetirementGoals, resolveRetirementGoals } from '../../../core/usecases/goals/retirementGoalAdapter';
import { normalizeGoalDrivenParams } from '../../../core/usecases/goals/normalizeGoalDrivenParams';
import { resolveStrategy } from '../../../core/usecases/strategy/compileStrategy';
import { AssetFormSection } from '../AssetForm/AssetFormSection';
import InputField from '../../components/InputField';
import { AGE_MAX, AGE_MIN, EXPECTANCY_MAX, parseAge } from '../StrategySettings/ageInput';
import { RetirementGoalSelector } from './RetirementGoalSelector';

interface RetirementInputFlowProps {
  params: SimulationParams;
  onChangeParams: (
    params: SimulationParams | ((previous: SimulationParams) => SimulationParams)
  ) => void;
  onStartAnalysis: () => void;
  /**
   * 지금 화면에 서 있는 결과가 «현재» 설정으로 계산된 것인가. true면 다시 눌러도 같은
   * 결과가 나오므로 버튼을 잠근다.
   *
   * 이 컴포넌트는 어떤 params로 분석했는지 모른다 — 판정은 그 둘을 모두 쥔 호출자가 한다
   * (page.tsx의 analysisIsCurrent). 기본값 false라서, 판정을 내려 주지 않는 호출자에게는
   * 예전처럼 언제나 누를 수 있는 버튼이 남는다.
   */
  analysisIsCurrent?: boolean;
}

const STEPS = [
  { label: '개인정보', icon: UserRound },
  { label: '자산정보', icon: WalletCards },
  { label: '은퇴 목표', icon: BarChart3 },
] as const;

export function RetirementInputFlow({
  params, onChangeParams, onStartAnalysis, analysisIsCurrent = false,
}: RetirementInputFlowProps) {
  const [step, setStep] = useState(0);
  const goals = resolveRetirementGoals(params);
  // 목표 카드가 새 목표를 고를 때 쓰는 시드. 엔진이 실제로 계산에 쓰는 값과 같아야 한다.
  const goalSeedProfile = normalizeGoalDrivenParams(params, resolveStrategy(params)).userProfile;
  const goalsAreReady = goals.length > 0 && goals.every((goal) => {
    const needsTarget = goal.type === 'EARLY_RETIREMENT'
      || goal.type === 'LIVING_EXPENSE_STABILITY'
      || goal.type === 'COMFORTABLE_SPENDING'
      || goal.type === 'INHERITANCE';
    return !needsTarget || (goal.targetValue !== undefined && goal.targetValue > 0);
  });
  // 「분석 시작」은 어느 단계에서나 눌릴 수 있으므로, 비활성일 때 왜 못 누르는지를 버튼 자신이 설명해야 한다.
  //
  // 목표 사유를 먼저 본다. 목표를 지우면 설정이 바뀌어 결과가 stale이 되므로 두 사유가
  // 동시에 참일 수 없지만, 순서를 정해 두어야 다음 사유가 늘어도 문구가 흔들리지 않는다.
  const blockedReason = goals.length === 0
    ? '은퇴 목표 단계에서 목표를 1개 이상 선택해 주세요.'
    : !goalsAreReady
      ? '선택한 목표의 목표값을 입력해 주세요.'
      // 같은 설정으로 다시 눌러 봐야 같은 결과가 나온다. 누를 수 있게 두면 사용자는
      // "아직 반영되지 않은 변경이 남아 있다"는 뜻으로 읽는다.
      : analysisIsCurrent
        ? '마지막 분석 이후 바뀐 설정이 없습니다.'
        : undefined;
  const canAnalyze = blockedReason === undefined;

  const setProfileAge = (key: 'currentAge' | 'expectancy', raw: string, max: number) => {
    const age = parseAge(raw, max);
    if (age !== null) {
      onChangeParams({
        ...params,
        userProfile: { ...params.userProfile, [key]: age },
      });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <nav aria-label="시뮬레이션 입력 단계" className="grid grid-cols-3 gap-1.5">
          {STEPS.map(({ label, icon: Icon }, index) => (
            <button
              key={label}
              type="button"
              aria-current={step === index ? 'step' : undefined}
              onClick={() => setStep(index)}
              className={`flex min-w-0 flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-[11px] font-semibold transition sm:text-xs ${
                step === index
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-card-border text-foreground-muted hover:border-primary/40'
              }`}
            >
              <Icon size={16} />
              <span>{index + 1}. {label}</span>
            </button>
          ))}
        </nav>
        <button
          type="button"
          disabled={!canAnalyze}
          title={blockedReason}
          aria-describedby={blockedReason ? 'analysis-blocked-reason' : undefined}
          onClick={onStartAnalysis}
          className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          분석 시작
        </button>
        {/* 사유를 DOM에 «보이게» 렌더한다. title만 두면 터치 기기에서는 아무것도 뜨지 않고,
            disabled 버튼은 포커스 대상이 아니라 스크린리더로도 도달할 수 없다. 사유가 다른
            단계의 조건을 가리킬 때(목표 미선택)는 특히, 보이지 않으면 사용자는 자기가 무엇을
            안 했는지 알 방법이 없다. */}
        {blockedReason && (
          <p id="analysis-blocked-reason" role="status" className="text-xs leading-relaxed text-foreground-muted">
            {blockedReason}
          </p>
        )}
      </div>

      {step === 0 && (
        <section aria-labelledby="personal-info-title" className="flex flex-col gap-4">
          <div>
            <h2 id="personal-info-title" className="text-base font-bold text-foreground">개인정보</h2>
            <p className="mt-1 text-xs leading-relaxed text-foreground-muted">
              분석 기간을 정하는 기본 정보만 입력해 주세요. 은퇴 나이는 목표 단계에서 정합니다.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <InputField
              label="현재 나이" type="number" suffixText="세" min={AGE_MIN} max={AGE_MAX}
              value={params.userProfile.currentAge}
              onChange={(event) => setProfileAge('currentAge', event.target.value, AGE_MAX)}
            />
            <InputField
              label="기대수명" type="number" suffixText="세" min={AGE_MIN} max={EXPECTANCY_MAX}
              value={params.userProfile.expectancy}
              onChange={(event) => setProfileAge('expectancy', event.target.value, EXPECTANCY_MAX)}
            />
          </div>
        </section>
      )}

      {step === 1 && (
        <section aria-label="자산정보">
          <AssetFormSection params={params} onChangeParams={onChangeParams} />
        </section>
      )}

      {step === 2 && (
        <section aria-label="은퇴 목표">
          {/* 시드값은 «정규화된» 프로필에서 가져온다. 저장된 옛 은퇴 나이를 그대로 시드하면
              「빠른 은퇴」를 처음 고른 순간 카드에 60세가 찍히는데, 계산은 그 목표를 고르기
              전까지 65세로 돌고 있었다 — 카드가 계산을 설명하지 못하게 된다. */}
          <RetirementGoalSelector
            goals={goals}
            displayCurrency={params.displayCurrency}
            retirementAge={goalSeedProfile.retirementAge}
            targetMonthlySpending={goalSeedProfile.targetMonthlySpending}
            targetBequest={goalSeedProfile.targetBequest}
            onChange={(nextGoals) => onChangeParams(applyRetirementGoals(params, nextGoals))}
          />
        </section>
      )}
    </div>
  );
}
