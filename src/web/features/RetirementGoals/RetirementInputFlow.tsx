'use client';

import { useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, UserRound, WalletCards } from 'lucide-react';
import type { SimulationParams } from '../../../core/entities/types';
import { applyRetirementGoals, resolveRetirementGoals } from '../../../core/usecases/goals/retirementGoalAdapter';
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
}

const STEPS = [
  { label: '개인정보', icon: UserRound },
  { label: '자산정보', icon: WalletCards },
  { label: '은퇴 목표', icon: BarChart3 },
] as const;

export function RetirementInputFlow({ params, onChangeParams, onStartAnalysis }: RetirementInputFlowProps) {
  const [step, setStep] = useState(0);
  const goals = resolveRetirementGoals(params);
  const canAnalyze = goals.length > 0 && goals.every((goal) => {
    const needsTarget = goal.type === 'EARLY_RETIREMENT'
      || goal.type === 'LIVING_EXPENSE_STABILITY'
      || goal.type === 'COMFORTABLE_SPENDING'
      || goal.type === 'INHERITANCE';
    return !needsTarget || (goal.targetValue !== undefined && goal.targetValue > 0);
  });

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
          <RetirementGoalSelector
            goals={goals}
            displayCurrency={params.displayCurrency}
            retirementAge={params.userProfile.retirementAge}
            targetMonthlySpending={params.userProfile.targetMonthlySpending}
            targetBequest={params.userProfile.targetBequest}
            onChange={(nextGoals) => onChangeParams(applyRetirementGoals(params, nextGoals))}
          />
        </section>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-card-border/60 pt-4">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          className="flex items-center gap-1 rounded-lg border border-card-border px-3 py-2 text-xs font-semibold text-foreground-muted disabled:opacity-30"
        >
          <ChevronLeft size={14} /> 이전
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}
            className="flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white"
          >
            다음 <ChevronRight size={14} />
          </button>
        ) : (
          <button
            type="button"
            disabled={!canAnalyze}
            onClick={onStartAnalysis}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            분석 시작
          </button>
        )}
      </div>
      {step === 2 && !canAnalyze && (
        <p role="alert" className="-mt-2 text-right text-xs text-warning">
          목표를 1개 이상 선택하고 필요한 목표값을 입력해 주세요.
        </p>
      )}
    </div>
  );
}
