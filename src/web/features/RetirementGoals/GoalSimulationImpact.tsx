import { CheckCircle2, ListChecks, SlidersHorizontal, Sparkles } from 'lucide-react';
import {
  confirmedTargetValue,
  RETIREMENT_GOAL_LABELS,
  type RetirementGoal,
} from '../../../core/entities/retirementGoal';
import type { SimulationParams } from '../../../core/entities/types';

interface GoalSimulationImpactProps {
  goals: readonly RetirementGoal[];
  params: SimulationParams;
}

const money = (value: number, currency: SimulationParams['displayCurrency']) =>
  `${value.toLocaleString()}${currency === 'KRW' ? '원' : '달러'}`;

function goalImpact(goal: RetirementGoal, params: SimulationParams): string {
  const value = confirmedTargetValue(goal);
  switch (goal.type) {
    case 'EARLY_RETIREMENT':
      return `${value ?? params.userProfile.retirementAge}세 은퇴를 기준으로 계산합니다.`;
    case 'LIVING_EXPENSE_STABILITY':
    case 'COMFORTABLE_SPENDING':
      return value !== undefined
        ? `목표 생활비는 월 ${money(value, params.displayCurrency)}입니다.`
        : '목표 금액을 확정하면 목표 생활비 기준으로 계산합니다.';
    case 'INHERITANCE':
      return value !== undefined
        ? `기대수명까지 ${money(value, params.displayCurrency)}를 남기는 조건으로 계산합니다.`
        : '목표 금액을 확정하면 최소 상속자산 조건으로 계산합니다.';
    case 'ASSET_SURVIVAL':
      return '기대수명까지 자산이 고갈되지 않는지를 우선 확인합니다.';
    case 'PENSION_OPTIMIZATION':
      return '연금 수령 시점과 인출액을 비교할 때 연금 활용도를 높게 평가합니다.';
    case 'TAX_OPTIMIZATION':
      return '후보 전략을 비교할 때 세금 부담이 낮은 계획을 우선 평가합니다.';
    case 'RISK_REDUCTION':
      return '시장 변동을 고려할 때 자산 고갈 위험이 낮은 계획을 우선 평가합니다.';
    case 'HOUSING_STABILITY':
      return '주거 안정에 필요한 자산을 남기는 방향으로 후보를 평가합니다.';
    case 'ASSET_GROWTH':
      return '생활비를 충당하고 남는 자산이 큰 계획을 우선 평가합니다.';
    default:
      return '선택 순위와 조건 강도를 추천 전략 평가에 반영합니다.';
  }
}

export function GoalSimulationImpact({ goals, params }: GoalSimulationImpactProps) {
  if (goals.length === 0) return null;

  return (
    <section aria-labelledby="goal-simulation-impact-title" className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-2.5">
        <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h3 id="goal-simulation-impact-title" className="text-sm font-bold text-foreground">
            이 목표가 시뮬레이션을 바꾸는 방식
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-foreground-muted">
            목표는 계산의 목적을 정하고, 시스템이 그 목적에 맞는 전략을 자동으로 비교합니다.
            아래 목표값은 고급 설정과 별도로 이 단계에서 결정됩니다.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {goals.map((goal) => (
          <div key={goal.type} className="rounded-lg border border-card-border bg-black/10 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] text-primary">
                {goal.priority}
              </span>
              {RETIREMENT_GOAL_LABELS[goal.type]}
              <span className="font-normal text-foreground-muted">
                · {goal.constraintType === 'HARD' ? '반드시 지키기' : '가능하면 지키기'}
              </span>
            </div>
            <p className="mt-1 pl-7 text-xs leading-relaxed text-foreground-muted">
              {goalImpact(goal, params)}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-2 text-xs text-foreground-muted sm:grid-cols-2">
        <div className="flex gap-2 rounded-lg bg-black/10 px-3 py-2.5">
          <Sparkles size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          <span><strong className="text-foreground">자동 비교:</strong> 국민연금 시점, 사적연금 인출액, 자산 매도 순서, ISA 자금 행선지, 일반자산 인출 시작 시점</span>
        </div>
        <div className="flex gap-2 rounded-lg bg-black/10 px-3 py-2.5">
          <SlidersHorizontal size={15} className="mt-0.5 shrink-0 text-foreground-muted" aria-hidden="true" />
          <span><strong className="text-foreground">고급 설정:</strong> 수익률·물가·세금·건강보험료 같은 계산 가정을 직접 확인하거나 조정하는 곳</span>
        </div>
      </div>

      <p className="mt-3 flex items-start gap-2 border-t border-primary/20 pt-3 text-xs leading-relaxed text-foreground-muted">
        <ListChecks size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <span>목표를 바꾸면 추천 전략과 목표 달성 확률이 다시 계산됩니다. 고급 설정을 열지 않아도 목표 기반 분석은 진행할 수 있습니다.</span>
      </p>
    </section>
  );
}
