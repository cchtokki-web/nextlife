'use client';

import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, Check, Target } from 'lucide-react';
import {
  MAX_RETIREMENT_GOALS,
  moveRetirementGoal,
  normalizeRetirementGoals,
  RETIREMENT_GOAL_CONSTRAINT_LABELS,
  confirmedTargetValue,
  isSpendingGoalType,
  isSuggestedTargetValue,
  type RetirementGoal,
  type RetirementGoalConstraintType,
  type RetirementGoalType,
} from '../../../core/entities/retirementGoal';
import { isQuantitativelyJudgedGoal } from '../../../core/usecases/goals/goalSuccessConditions';
import { hasGoalScoreFormula } from '../../../core/usecases/goals/goalScoreSupport';
import { RETIREMENT_GOAL_CATALOG, retirementGoalDefinition } from './goalCatalog';

/**
 * 「확인이 필요한 목표」를 가리키는 신호. 관문은 다른 단계의 버튼 옆에 있으므로, 막기만
 * 하고 «어디를» 고쳐야 하는지 가리키지 않으면 사용자는 목표 카드와 사유를 함께 볼 일이
 * 없다(known-issues 14번).
 *
 * nonce가 있는 이유: 같은 목표를 다시 가리키는 일이 흔하고, 유형만 보면 두 번째 클릭이
 * 아무 일도 하지 않는다.
 */
export interface GoalFocusRequest {
  type: RetirementGoalType;
  nonce: number;
}

const goalCardId = (type: RetirementGoalType) => `goal-card-${type}`;
const targetInputId = (type: RetirementGoalType) => `goal-target-${type}`;
const targetConfirmId = (type: RetirementGoalType) => `goal-target-confirm-${type}`;

interface RetirementGoalSelectorProps {
  goals: readonly RetirementGoal[];
  displayCurrency: 'KRW' | 'USD';
  retirementAge: number;
  targetMonthlySpending: number;
  targetBequest?: number;
  focusGoal?: GoalFocusRequest;
  onChange: (goals: RetirementGoal[]) => void;
}

export function RetirementGoalSelector({
  goals, displayCurrency, retirementAge, targetMonthlySpending, targetBequest, focusGoal, onChange,
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

  /** 사용자가 «직접» 고친 값만 반영하는 경로. */
  const updateGoal = (type: RetirementGoalType, patch: Partial<RetirementGoal>) => {
    onChange(normalizeRetirementGoals(
      selected.map((goal) => goal.type === type ? { ...goal, ...patch } : goal),
    ));
  };

  /**
   * 금액을 «고치는» 경로. 키 입력 하나하나는 「변경」이지 「확인」이 아니므로 출처 표시를
   * 붙이지 않고, 이미 붙어 있던 표시는 «떼어 낸다» — 확정한 뒤 고친 금액을 여전히 확정으로
   * 읽으면 사용자가 확인한 적 없는 숫자가 다시 판정 기준이 된다. 다 친 뒤의 확정은
   * commitTargetEdit이 맡는다.
   */
  const changeTargetValue = (type: RetirementGoalType, targetValue: number | undefined) => {
    onChange(normalizeRetirementGoals(selected.map((goal) => {
      if (goal.type !== type) return goal;
      const next: RetirementGoal = { ...goal, targetValue };
      delete next.targetValueSource;
      return next;
    })));
  };

  /**
   * 금액을 «확정하는» 행위. 출처 표시를 붙이는 곳은 여기 하나뿐이고, 이 함수를 부르는 곳은
   * 둘이다 — 제안된 금액을 그대로 받아들이는 「이 금액으로 확정」 버튼과, 직접 고쳐 넣은
   * 입력을 다 친 시점의 commitTargetEdit. 둘 다 사용자의 «행위»다.
   */
  const confirmTargetValue = (type: RetirementGoalType) => {
    updateGoal(type, { targetValueSource: 'user' });
  };

  /**
   * 「이번 포커스 동안 사용자가 «무슨 금액을» 쳐 넣었는가」.
   *
   * 확정 판단을 «커밋 시점»(blur·Enter)으로 미루기 위한 표식이다. 키 입력마다 확정하면
   * 350만원을 치는 도중의 3·35·350이 차례로 확정값이 된다 — 「고치다 만 금액을 확정으로
   * 읽지 않는다」는 규칙(known-issues 14번)은 그대로 두고, «다 친 뒤»만 확정으로 본다.
   *
   * **「고쳤다」는 사실이 아니라 «고친 값»을 담는다.** 사실만 담으면 커밋 시점에 목표를 다시
   * 찾아야 하는데, 그 사이 goals prop이 통째로 갈릴 수 있다(포커스를 쥔 채 다른 시나리오가
   * 늦게 도착하는 경우). 그러면 사용자가 «건드린 적 없는» 새 씨앗이 blur 한 번으로 확정값이
   * 된다 — 이 컴포넌트가 막아야 할 바로 그것이다. 값을 함께 들고 있다가 커밋 때 대조하면,
   * 내가 친 숫자가 그대로 남아 있을 때만 확정된다.
   *
   * 렌더 결과에 쓰이지 않으므로 state가 아니라 ref다. 이 값이 바뀐다고 다시 그릴 것은 없다.
   */
  const editedTargets = useRef(new Map<RetirementGoalType, number | undefined>());

  /**
   * 금액 입력을 «다 친» 시점. 사용자가 스스로 적어 넣은 숫자는 그 자체가 진술이므로 확정
   * 버튼을 한 번 더 누르게 하지 않는다 — 확인이 필요한 것은 사용자가 «건드린 적 없는»
   * 씨앗뿐이다(그 경우 이 함수는 아무 일도 하지 않고 확정 패널이 그대로 남는다).
   *
   * 판정은 isSuggestedTargetValue에 맡긴다. 그 술어가 참인 목표가 정확히 「확정이 필요한
   * 금액 목표」이고, 금액이 아닌 목표(빠른 은퇴의 나이)와 빈 칸은 거기서 함께 걸러진다 —
   * 확정할 값이 없는데 출처 표시만 붙는 일을 막는다.
   *
   * 확정하는 것은 «내가 친 숫자»뿐이다. 커밋 시점의 목표 금액이 그 사이 다른 값으로 바뀌어
   * 있으면(goals prop 교체) 아무 일도 하지 않는다 — editedTargets 주석 참조.
   */
  const commitTargetEdit = (type: RetirementGoalType) => {
    if (!editedTargets.current.has(type)) return;
    const edited = editedTargets.current.get(type);
    editedTargets.current.delete(type);
    const goal = selected.find((item) => item.type === type);
    if (!goal || goal.targetValue !== edited) return;
    if (isSuggestedTargetValue(goal)) confirmTargetValue(type);
  };

  const focusTargetInput = (type: RetirementGoalType) => {
    const input = document.getElementById(targetInputId(type));
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  };

  // 가리킨 목표로 «데려간다». 사유 문구만으로는 어느 카드인지 알 수 없고, 목록이 길면
  // 화면 밖에 있을 수도 있다. 포커스를 확정 버튼에 두면 키보드·스크린리더 사용자도 같은
  // 자리에 도착한다. jsdom에는 scrollIntoView가 없어 선택 호출로 둔다.
  useEffect(() => {
    if (!focusGoal) return;
    document.getElementById(goalCardId(focusGoal.type))?.scrollIntoView?.({ block: 'center' });
    document.getElementById(targetConfirmId(focusGoal.type))?.focus();
  }, [focusGoal]);

  return (
    // @container: 컨테이너 질의는 «자기 자신»이 아니라 조상 컨테이너를 본다. 폭 기준을
    // 여기 한 번만 걸고, 아래 카드 그리드가 그 폭을 참조한다.
    <div className="@container/goals flex flex-col gap-5">
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold break-keep text-foreground">원하는 노후를 선택하세요</h2>
            <p className="mt-1 text-xs leading-relaxed break-keep text-foreground-muted">
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

      {/* 목표 카드도 같은 360px 사이드바 안에서 그려진다. 뷰포트가 아니라 이 카드가
          실제로 쥔 폭을 기준으로 2단을 편다. */}
      <div className="grid grid-cols-1 gap-2 @min-[26rem]/goals:grid-cols-2">
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
                <span className="text-sm font-bold break-keep text-foreground">{definition.label}</span>
                <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                  isSelected ? 'border-primary bg-primary text-white' : 'border-card-border'
                }`} aria-hidden="true">
                  {isSelected && <Check size={13} />}
                </span>
              </span>
              <span className="mt-1.5 block text-xs leading-relaxed break-keep text-foreground-muted">
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
            // 「이 목표를 계산이 판정하는가」의 출처는 엔진이다(goalSuccessConditions).
            //
            // **유형만 보면 구멍이 생긴다.** 「자산 성장」은 판정 가능한 «유형»이지만 목표
            // 금액을 비워 둘 수 있고(goalCatalog의 optional), 비어 있으면 엔진이 기말자산
            // 하한을 세울 근거가 없다 — terminalAssetGoalOf가 «확정된» 금액만 보기 때문이다.
            // 그 상태에서 HARD를 열어 주면 사용자는 «계산이 지키지 않는 조건»을 못박은
            // 것으로 믿게 된다. 이 화면이 애초에 막으려던 바로 그 일이다(known-issues 1번).
            //
            // goalSuccessConditions가 같은 이유로 이미 유형 대신 「축을 실제로 켰는가」로
            // 갈랐다. 여기서도 같은 판단을 따른다 — 유형이 아니라 «값»을 본다.
            //
            // 금액이 필수인 목표는 여기 걸리지 않는다. 그쪽은 빈 칸 자체를 RetirementInputFlow가
            // 막으므로(goalsMissingTarget) 강도를 고르는 자리까지 오지 않는다.
            const optionalTarget = definition.target?.optional === true ? definition.target : undefined;
            // 「비워 둘 수 있는 금액인데 아직 확정되지 않았다」는 상태. 불리언이 아니라 그
            // 목표 «정의»를 담는다 — 아래 문구가 입력칸 라벨을 그대로 되불러야 사용자가
            // 어느 칸을 채우라는 말인지 알고, 이름을 다시 적으면 라벨이 바뀌는 날 갈라진다.
            const awaitingOptionalTarget =
              optionalTarget !== undefined && confirmedTargetValue(goal) === undefined
                ? optionalTarget
                : undefined;
            const judged = isQuantitativelyJudgedGoal(goal.type)
              && awaitingOptionalTarget === undefined;
            // 정량 기준이 없는 목표는 HARD를 «고를 수 없다». 기준이 없는데 「반드시 지키기」를
            // 고르게 두면, 계산이 지키지 않는 조건을 사용자가 못박은 것으로 믿게 된다.
            //
            // 이미 HARD로 저장된 시나리오는 그 값을 «그대로 보여 준다». 조용히 SOFT로 고쳐
            // 쓰면 사용자가 저장한 데이터를 말없이 바꾸는 것이 되고, 그것은 별개의 결정이다.
            // 대신 그 선택지는 잠가 둔다 — 보이되 다시 고를 수는 없다.
            const storedHard = goal.constraintType === 'HARD';
            const constraintOptions: RetirementGoalConstraintType[] =
              judged || storedHard ? ['HARD', 'SOFT'] : ['SOFT'];
            // 아직 확정되지 않은 «제안» 금액. undefined면 확인할 것이 없다는 뜻이다 —
            // 금액이 아닌 목표(은퇴 나이)와 금액을 묻지 않는 목표가 모두 여기서 빠진다.
            const suggestedValue = isSuggestedTargetValue(goal) ? goal.targetValue : undefined;
            const unitLabel = definition.target?.unit === 'age'
              ? '세' : displayCurrency === 'KRW' ? '원' : 'USD';
            return (
              <div
                key={goal.type}
                id={goalCardId(goal.type)}
                className="rounded-xl border border-card-border bg-black/10 p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                    {goal.priority}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-semibold break-keep text-foreground">
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
                          id={targetInputId(goal.type)}
                          aria-label={definition.target.label}
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          value={goal.targetValue?.toLocaleString() ?? ''}
                          onFocus={() => editedTargets.current.delete(goal.type)}
                          onChange={(event) => {
                            const raw = event.target.value.replace(/,/g, '');
                            if (raw === '' || /^\d+$/.test(raw)) {
                              // 여기서 확정하지 «않는다» — 확정은 커밋 시점에 한 번만
                              // 판단한다(commitTargetEdit). 빈 칸으로 지우면 표시도 함께
                              // 사라진다(normalizeRetirementGoals).
                              const next = raw === '' ? undefined : Number(raw);
                              editedTargets.current.set(goal.type, next);
                              changeTargetValue(goal.type, next);
                            }
                          }}
                          // 입력을 끝내는 두 가지 방법 모두가 커밋이다. Enter만 처리하면
                          // 다른 칸을 눌러 넘어간 사용자가 확정되지 않은 채로 남는다.
                          onBlur={() => commitTargetEdit(goal.type)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return;
                            // 오늘 이 카드 위에 form은 없다(저장소의 form은 로그인·관리자·
                            // 보안키뿐이다). 나중에 감싸이더라도 Enter가 제출로 새 나가지
                            // 않도록 미리 막아 둔다 — 지워도 당장은 아무 증상이 없는 종류의
                            // 방어이므로 왜 있는지를 여기 남긴다.
                            event.preventDefault();
                            commitTargetEdit(goal.type);
                          }}
                          className="h-10 w-full rounded-lg border border-card-border bg-black/20 px-3 pr-12 text-sm text-foreground outline-none focus:border-primary"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-foreground-muted">
                          {unitLabel}
                        </span>
                      </span>
                    </label>
                  )}
                  {/* 확정되지 않은 금액은 판정에 참가하지 않는다. 그 사실을 숨기면 「반드시
                      지키기」를 골라 둔 사용자가 자기 금액이 강제되지 않는다는 것을 알 수 없다.
                      제안값 자체는 지금 쓰는 것을 그대로 둔다 — 새 숫자를 만들지 않는다.

                      확정은 «명시적 행위»다. 두 갈래 모두 확정으로 끝난다 — 제안된 금액을
                      그대로 받아들이는 것(이 버튼)도 사용자의 행위이고, 직접 고쳐 넣는 것
                      (commitTargetEdit)도 그렇다.

                      그래서 이 패널이 남는 조건은 「건드린 적 없는 씨앗」이 아니라 «미확정
                      금액»이다(suggestedValue !== undefined). 둘은 대부분 같지만 «고치는
                      도중»에 갈린다 — changeTargetValue가 키 입력마다 출처 표시를 떼므로,
                      확정된 금액을 지우고 다시 치는 동안 이 패널이 도로 나타났다가 커밋
                      시점에 사라진다. 그 편이 맞다: 그 순간 금액은 실제로 미확정이다.
                      자기 숫자를 다 적어 넣은 사용자에게만 같은 말을 두 번 시키지 않는다.

                      별도 단계를 만들지 않고 목표 카드 안에서 처리한다 — 확인해야 할 금액과
                      그 금액이 속한 목표는 같은 자리에 있어야 한다. */}
                  {suggestedValue !== undefined && (
                    <div className="flex flex-col gap-2 rounded-lg border border-card-border bg-black/20 p-2.5">
                      {goal.constraintType === 'HARD' && (
                        <p className="text-xs font-bold leading-relaxed text-foreground">
                          {isSpendingGoalType(goal.type)
                            ? '반드시 지킬 최소 생활비를 확인해 주세요.'
                            : '반드시 남길 최소 자산을 확인해 주세요.'}
                        </p>
                      )}
                      <p className="text-xs leading-relaxed text-foreground-muted">
                        <strong className="text-foreground">아직 제안 금액입니다</strong>
                        {' '}— 지금 값은 입력하신 계획에서 가져온 것이라 달성·미달 판정에 쓰지
                        않습니다. 금액을 직접 고치거나 아래에서 확정하면 목표 금액이 됩니다.
                      </p>
                      {/* 확인할 금액을 «다시» 적는다. 입력창의 숫자와 같은 값이지만, 확정
                          버튼 옆에 무엇을 확정하는지가 없으면 사용자는 금액을 보지 않고
                          누르게 된다. 단위 변환은 하지 않는다 — 저장된 값과 다르게 보이는
                          숫자를 확정시키는 것이 이 화면이 막으려는 일이다. */}
                      <p className="text-sm font-bold text-foreground">
                        {isSpendingGoalType(goal.type) && '월 '}
                        {suggestedValue.toLocaleString()}{unitLabel}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {definition.target && (
                          <button
                            type="button"
                            aria-label={`${definition.label} 목표 금액 수정`}
                            onClick={() => focusTargetInput(goal.type)}
                            className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:border-primary/50"
                          >
                            금액 수정
                          </button>
                        )}
                        <button
                          id={targetConfirmId(goal.type)}
                          type="button"
                          aria-label={`${definition.label} 목표를 이 금액으로 확정`}
                          onClick={() => confirmTargetValue(goal.type)}
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-90"
                        >
                          이 금액으로 확정
                        </button>
                      </div>
                    </div>
                  )}
                  <label className="flex flex-col gap-1 text-xs font-semibold text-foreground-muted">
                    조건 강도
                    <select
                      aria-label={`${definition.label} 조건 강도`}
                      aria-describedby={judged ? undefined : `${goal.type}-not-judged`}
                      value={goal.constraintType}
                      onChange={(event) => updateGoal(goal.type, {
                        constraintType: event.target.value as RetirementGoalConstraintType,
                      })}
                      className="h-10 w-full rounded-lg border border-card-border bg-black/20 px-3 text-sm text-foreground outline-none focus:border-primary"
                    >
                      {constraintOptions.map((option) => (
                        <option key={option} value={option} disabled={!judged && option === 'HARD'}>
                          {RETIREMENT_GOAL_CONSTRAINT_LABELS[option]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {/* 잠근 이유를 «강도 바로 밑에» 적는다. 고를 수 없게만 하고 말이 없으면
                      사용자는 목표가 통째로 무시된다고 읽는다 — 그렇지 않다. 이 목표들은
                      정성 목표로 남아, 선택과 우선순위가 추천 전략을 고르는 기준에
                      그대로 반영된다(createGoalUtilityConfig).

                      목록은 엔진의 분류에서 읽는다. 여기서 유형을 나열하면 목표가 분류를
                      옮기는 날 화면만 옛말을 하게 된다. */}
                  {/* **두 사유는 서로 다른 상태다.** 「자산 성장」에 금액을 넣지 않은 것은
                      판정을 못 하는 상태가 «아니다» — 은퇴 시점 자산과 견주어 성장 여부를
                      실제로 채점한다. 못 하는 것은 그 기준을 «못박는» 일뿐이다. 여기에
                      「정량 판정 대상 아님」을 쓰면 화면이 사실과 다른 말을 하고, 사용자는
                      고칠 수 있는 상태를 고칠 수 없는 상태로 읽는다. */}
                  {!judged && awaitingOptionalTarget !== undefined && (
                    <p id={`${goal.type}-not-judged`} className="text-xs leading-relaxed break-keep text-foreground-muted">
                      <strong className="text-foreground">
                        「{RETIREMENT_GOAL_CONSTRAINT_LABELS.HARD}」는 금액을 확정해야 열립니다
                      </strong>
                      {' '}— 위 「{awaitingOptionalTarget.label}」에 금액을 넣고 확정하면 기말 자산이 그
                      금액 아래로 내려가지 않도록 지킵니다. 비워 두어도 목표는 채점됩니다 —
                      은퇴 시점의 자산보다 기말 자산이 많은지로 평가합니다. 다만 그 기준은
                      계획에 따라 함께 움직이므로 못박을 수 있는 금액이 아닙니다.
                      {storedHard && (
                        <>
                          {' '}이전에 저장된 「{RETIREMENT_GOAL_CONSTRAINT_LABELS.HARD}」는 그대로
                          두었지만, 금액을 확정하기 전까지는 판정에 쓰이지 않습니다.
                        </>
                      )}
                    </p>
                  )}
                  {!judged && awaitingOptionalTarget === undefined && (
                    <p id={`${goal.type}-not-judged`} className="text-xs leading-relaxed break-keep text-foreground-muted">
                      <strong className="text-foreground">정량 판정 대상 아님</strong>
                      {' '}— 이 목표는 달성·미달을 잴 정량 기준이 아직 없어
                      「{RETIREMENT_GOAL_CONSTRAINT_LABELS.HARD}」로 지정할 수 없습니다.{' '}
                      {/* **여기서 두 갈래가 갈린다.** 판정 대상이 아닌 목표 넷 중 셋(연금·세금·
                          위험)은 점수 «산식»이 있어 실제로 후보를 변별한다 — 그 셋에는 아래
                          앞 문장이 참이다. 「주거 안정」만 산식이 없어 평가가 상수 0을
                          돌려주므로, 같은 문장을 쓰면 화면이 사실과 다른 말을 한다.
                          분류는 엔진에서 읽는다(hasGoalScoreFormula) — 여기서 유형을 나열하면
                          목표가 분류를 옮기는 날 화면만 옛말을 하게 된다. */}
                      {hasGoalScoreFormula(goal.type) ? (
                        <>
                          무시되는 목표는 아닙니다: 선택과 우선순위는 추천 전략을 고르는 기준에
                          그대로 반영됩니다.
                        </>
                      ) : (
                        <>
                          <strong className="text-foreground">점수 산정 대상도 아닙니다</strong>
                          {' '}— 이 목표에는 평가 점수를 계산하지 않으며, 종합 점수에서도
                          빠집니다. 고른다고 점수가 깎이지는 않으며, 선택과 우선순위는
                          그대로 남습니다.
                        </>
                      )}
                      {storedHard && (
                        <>
                          {' '}이전에 저장된 「{RETIREMENT_GOAL_CONSTRAINT_LABELS.HARD}」는 그대로
                          두었지만 판정에는 쓰이지 않으며, 다시 고를 수는 없습니다.
                        </>
                      )}
                    </p>
                  )}
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
