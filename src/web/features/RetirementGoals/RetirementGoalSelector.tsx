'use client';

import { ArrowDown, ArrowUp, Check, Target } from 'lucide-react';
import {
  MAX_RETIREMENT_GOALS,
  moveRetirementGoal,
  normalizeRetirementGoals,
  RETIREMENT_GOAL_CONSTRAINT_LABELS,
  isSpendingGoalType,
  isSuggestedTargetValue,
  type RetirementGoal,
  type RetirementGoalConstraintType,
  type RetirementGoalType,
} from '../../../core/entities/retirementGoal';
import { RETIREMENT_GOAL_CATALOG, retirementGoalDefinition } from './goalCatalog';

interface RetirementGoalSelectorProps {
  goals: readonly RetirementGoal[];
  displayCurrency: 'KRW' | 'USD';
  retirementAge: number;
  targetMonthlySpending: number;
  targetBequest?: number;
  onChange: (goals: RetirementGoal[]) => void;
}

export function RetirementGoalSelector({
  goals, displayCurrency, retirementAge, targetMonthlySpending, targetBequest, onChange,
}: RetirementGoalSelectorProps) {
  const selected = normalizeRetirementGoals(goals);
  const selectedTypes = new Set(selected.map((goal) => goal.type));
  const atLimit = selected.length >= MAX_RETIREMENT_GOALS;

  const defaultTarget = (type: RetirementGoalType): number | undefined => {
    if (type === 'EARLY_RETIREMENT') return retirementAge;
    if (type === 'LIVING_EXPENSE_STABILITY' || type === 'COMFORTABLE_SPENDING') {
      return targetMonthlySpending;
    }
    if (type === 'INHERITANCE') return targetBequest ?? targetMonthlySpending * 24;
    return undefined;
  };

  // 목표를 고르는 순간 깔아 주는 값은 «제안»이다. 출처 표시(targetValueSource)를 붙이지
  // 않으므로 계산은 이 값을 사용자가 확정한 목표금액으로 취급하지 않는다. 씨앗 자체는
  // 그대로 둔다 — 빈 칸으로 두면 사용자가 매번 숫자를 지어내야 한다.
  const toggleGoal = (type: RetirementGoalType) => {
    if (selectedTypes.has(type)) {
      onChange(normalizeRetirementGoals(selected.filter((goal) => goal.type !== type)));
      return;
    }
    if (atLimit) return;
    const definition = retirementGoalDefinition(type);
    onChange(normalizeRetirementGoals([
      ...selected,
      {
        type,
        priority: selected.length + 1,
        constraintType: definition.defaultConstraintType,
        targetValue: defaultTarget(type),
      },
    ]));
  };

  /**
   * 사용자가 «직접» 고친 값만 반영하는 경로. 목표금액을 여기로 넣으면 출처 표시가 함께
   * 붙어 확정값이 된다 — 이 함수 말고는 표시를 붙이는 곳이 없어야 한다.
   */
  const updateGoal = (type: RetirementGoalType, patch: Partial<RetirementGoal>) => {
    onChange(normalizeRetirementGoals(
      selected.map((goal) => goal.type === type ? { ...goal, ...patch } : goal),
    ));
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-foreground">원하는 노후를 선택하세요</h2>
            <p className="mt-1 text-xs leading-relaxed text-foreground-muted">
              최대 5개까지 선택한 뒤, 나에게 중요한 순서대로 정렬해 주세요.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-bold text-primary">
            {selected.length}/{MAX_RETIREMENT_GOALS}
          </span>
        </div>
        <p aria-live="polite" className="sr-only">
          {selected.length}개의 은퇴 목표가 선택되었습니다.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {RETIREMENT_GOAL_CATALOG.map((definition) => {
          const isSelected = selectedTypes.has(definition.type);
          const disabled = !isSelected && atLimit;
          return (
            <button
              key={definition.type}
              type="button"
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => toggleGoal(definition.type)}
              className={`min-h-24 rounded-xl border p-3 text-left transition ${
                isSelected
                  ? 'border-primary bg-primary/10'
                  : 'border-card-border bg-black/10 hover:border-primary/50'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="text-sm font-bold text-foreground">{definition.label}</span>
                <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                  isSelected ? 'border-primary bg-primary text-white' : 'border-card-border'
                }`} aria-hidden="true">
                  {isSelected && <Check size={13} />}
                </span>
              </span>
              <span className="mt-1.5 block text-xs leading-relaxed text-foreground-muted">
                {definition.description}
              </span>
            </button>
          );
        })}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Target size={15} className="text-primary" /> 목표 우선순위
          </h3>
          {selected.map((goal, index) => {
            const definition = retirementGoalDefinition(goal.type);
            return (
              <div key={goal.type} className="rounded-xl border border-card-border bg-black/10 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                    {goal.priority}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                    {definition.label}
                  </span>
                  <button
                    type="button" aria-label={`${definition.label} 우선순위 올리기`}
                    disabled={index === 0}
                    onClick={() => onChange(moveRetirementGoal(selected, goal.type, -1))}
                    className="rounded-md border border-card-border p-1 text-foreground-muted disabled:opacity-30"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button" aria-label={`${definition.label} 우선순위 내리기`}
                    disabled={index === selected.length - 1}
                    onClick={() => onChange(moveRetirementGoal(selected, goal.type, 1))}
                    className="rounded-md border border-card-border p-1 text-foreground-muted disabled:opacity-30"
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>

                <div className="mt-3 flex flex-col gap-3">
                  {definition.target && (
                    <label className="flex flex-col gap-1 text-xs font-semibold text-foreground-muted">
                      {definition.target.label}
                      <span className="relative">
                        <input
                          aria-label={definition.target.label}
                          type="text"
                          inputMode="numeric"
                          value={goal.targetValue?.toLocaleString() ?? ''}
                          onChange={(event) => {
                            const raw = event.target.value.replace(/,/g, '');
                            if (raw === '' || /^\d+$/.test(raw)) {
                              // 사용자가 이 칸에 써넣은 숫자만 확정값이다. 빈 칸으로 지우면
                              // 표시도 함께 사라진다(normalizeRetirementGoals).
                              updateGoal(goal.type, {
                                targetValue: raw === '' ? undefined : Number(raw),
                                targetValueSource: 'user',
                              });
                            }
                          }}
                          className="h-10 w-full rounded-lg border border-card-border bg-black/20 px-3 pr-12 text-sm text-foreground outline-none focus:border-primary"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-foreground-muted">
                          {definition.target.unit === 'age' ? '세' : displayCurrency === 'KRW' ? '원' : 'USD'}
                        </span>
                      </span>
                    </label>
                  )}
                  {/* 확정되지 않은 금액은 판정에 참가하지 않는다. 그 사실을 숨기면 「반드시
                      지키기」를 골라 둔 사용자가 자기 금액이 강제되지 않는다는 것을 알 수 없다.
                      제안값 자체는 지금 쓰는 것을 그대로 둔다 — 새 숫자를 만들지 않는다. */}
                  {isSuggestedTargetValue(goal) && (
                    <p className="text-xs leading-relaxed text-foreground-muted">
                      <strong className="text-foreground">아직 제안 금액입니다</strong>
                      {' '}— 지금 값은 입력하신 계획에서 가져온 것이라 달성·미달 판정에 쓰지
                      않습니다. 위 칸에 원하는 금액을 직접 입력하면 목표 금액으로 확정됩니다.
                    </p>
                  )}
                  <label className="flex flex-col gap-1 text-xs font-semibold text-foreground-muted">
                    조건 강도
                    <select
                      aria-label={`${definition.label} 조건 강도`}
                      value={goal.constraintType}
                      onChange={(event) => updateGoal(goal.type, {
                        constraintType: event.target.value as RetirementGoalConstraintType,
                      })}
                      className="h-10 w-full rounded-lg border border-card-border bg-black/20 px-3 text-sm text-foreground outline-none focus:border-primary"
                    >
                      <option value="HARD">{RETIREMENT_GOAL_CONSTRAINT_LABELS.HARD}</option>
                      <option value="SOFT">{RETIREMENT_GOAL_CONSTRAINT_LABELS.SOFT}</option>
                    </select>
                  </label>
                  {/* 생활비 목표에만 붙인다. 다른 유형에서는 강도의 «뜻»이 달라서다 —
                      은퇴 나이나 기말자산의 HARD는 후보를 거르는 조건이지, 인출 중에
                      계좌 순서를 깨는 규칙이 아니다. 같은 문구를 붙이면 거짓이 된다. */}
                  {isSpendingGoalType(definition.type) && (
                    <p className="text-xs leading-relaxed text-foreground-muted">
                      <strong className="text-foreground">
                        {RETIREMENT_GOAL_CONSTRAINT_LABELS.SOFT}
                      </strong>
                      {' '}— 목표 생활비에 미달해도 허용합니다. 세금이나 인출 순서를 강제로
                      깨지 않습니다.
                      <br />
                      <strong className="text-foreground">
                        {RETIREMENT_GOAL_CONSTRAINT_LABELS.HARD}
                      </strong>
                      {' '}— 법적으로 인출 가능한 자산이 있다면 계좌 순서·월 인출 목표·세제
                      최적화보다 생활비 충당을 우선합니다.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
