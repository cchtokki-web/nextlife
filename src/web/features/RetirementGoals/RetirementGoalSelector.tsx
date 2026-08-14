'use client';

import { ArrowDown, ArrowUp, Check, Target } from 'lucide-react';
import {
  MAX_RETIREMENT_GOALS,
  moveRetirementGoal,
  normalizeRetirementGoals,
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

                <div className={`mt-3 grid gap-3 ${definition.target ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
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
                              updateGoal(goal.type, {
                                targetValue: raw === '' ? undefined : Number(raw),
                              });
                            }
                          }}
                          className="w-full rounded-lg border border-card-border bg-black/20 px-3 py-2 pr-12 text-sm text-foreground outline-none focus:border-primary"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-foreground-muted">
                          {definition.target.unit === 'age' ? '세' : displayCurrency === 'KRW' ? '원' : 'USD'}
                        </span>
                      </span>
                    </label>
                  )}
                  <label className="flex flex-col gap-1 text-xs font-semibold text-foreground-muted">
                    조건 강도
                    <select
                      aria-label={`${definition.label} 조건 강도`}
                      value={goal.constraintType}
                      onChange={(event) => updateGoal(goal.type, {
                        constraintType: event.target.value as RetirementGoalConstraintType,
                      })}
                      className="rounded-lg border border-card-border bg-black/20 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                    >
                      <option value="HARD">반드시 지키기 (HARD)</option>
                      <option value="SOFT">가능하면 달성 (SOFT)</option>
                    </select>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
