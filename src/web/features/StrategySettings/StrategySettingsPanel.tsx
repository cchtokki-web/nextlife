'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Coins, LineChart, Settings2, Target, TrendingUp, User } from 'lucide-react';
import {
  NationalPensionStrategy, RetirementStrategy, SimulationParams, StrategyMode,
} from '../../../core/entities/types';
import {
  DEFAULT_RETIREMENT_STRATEGY, NATIONAL_PENSION_STRATEGY_AGES,
} from '../../../core/usecases/strategy/compileStrategy';
import { SettingSection } from '../../components/form';
import { AdvancedSection } from './sections/AdvancedSection';
import { BasicInfoSection } from './sections/BasicInfoSection';
import { EconomicAssumptionSection } from './sections/EconomicAssumptionSection';
import { InvestmentStrategySection } from './sections/InvestmentStrategySection';
import { PensionStrategySection } from './sections/PensionStrategySection';
import { RetirementGoalSection } from './sections/RetirementGoalSection';
import { StrategyModeSelector } from './StrategyModeSelector';
import { collectChangedPaths, countSectionChanges } from './diffDefaults';
import { SectionId } from './fieldVisibility';
import { SectionProps } from './strategyOptions';
import { useAiRecommendation } from './useAiRecommendation';

export interface StrategySettingsPanelProps {
  params: SimulationParams;
  onChangeParams: (params: SimulationParams) => void;
}

// 값을 바꾼 섹션을 강조하는 시간. 눈에 띄되 시선을 붙잡지 않을 정도로 짧게 둔다.
const HIGHLIGHT_DURATION_MS = 2000;

// 섹션 표시 메타. 순서가 화면 순서다.
const SECTIONS: ReadonlyArray<{ id: SectionId; title: string; icon: React.ReactNode }> = [
  { id: 'basic', title: '기본 정보', icon: <User size={16} /> },
  { id: 'goal', title: '은퇴 목표', icon: <Target size={16} /> },
  { id: 'pension', title: '연금 전략', icon: <Coins size={16} /> },
  { id: 'investment', title: '투자 전략', icon: <TrendingUp size={16} /> },
  { id: 'economic', title: '경제 가정', icon: <LineChart size={16} /> },
  { id: 'advanced', title: '고급 설정', icon: <Settings2 size={16} /> },
];

// 저장된 시나리오에 strategy가 없을 수 있으므로(구 데이터) 항상 기본값으로 채워 읽는다.
export function resolveStrategy(params: SimulationParams): RetirementStrategy {
  return { ...DEFAULT_RETIREMENT_STRATEGY, ...(params.strategy ?? {}) };
}

// AI 추천 버튼을 붙일 섹션. 배우자·경제 가정처럼 AI가 관여하지 않는 섹션은 제외한다.
const AI_SECTIONS: ReadonlySet<SectionId> = new Set(['goal', 'pension', 'investment']);

export function StrategySettingsPanel({ params, onChangeParams }: StrategySettingsPanelProps) {
  const strategy = resolveStrategy(params);
  const mode = strategy.mode;

  const changed = useMemo(() => collectChangedPaths(params), [params]);
  // AI 추천(recommendStrategy)은 후보 최대 162개를 시뮬레이션하는 무거운 계산이다.
  // 화면에 즉시 반영돼야 하는 params와 달리, AI 추천 계산만 page.tsx의 deferredParams와
  // 같은 패턴으로 지연시켜 설정 패널 어디서든 타이핑할 때마다 동기적으로 재계산되는
  // 것을 막는다. 화면에 보이는 값(sectionPropsFor 등)은 여전히 즉시 반영되는 params를 쓴다.
  const deferredParams = useDeferredValue(params);
  const ai = useAiRecommendation(deferredParams);

  // 방금 바뀐 섹션을 잠깐 강조한다. 어떤 필드가 바뀌었는지는 changed 집합의 변화로
  // 알 수 있지만, "언제" 바뀌었는지는 상태가 없으면 알 수 없어 로컬 state로 둔다.
  const [recentSection, setRecentSection] = useState<SectionId | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const highlightSection = useCallback((id: SectionId) => {
    setRecentSection(id);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setRecentSection(null), HIGHLIGHT_DURATION_MS);
  }, []);

  // 언마운트 시 타이머를 정리하지 않으면 setState가 사라진 컴포넌트에 대해 호출된다.
  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  const handleModeChange = (nextMode: StrategyMode) => {
    // 모드를 낮춰도 값은 보존한다 — 숨김일 뿐 초기화가 아니다.
    onChangeParams({ ...params, strategy: { ...strategy, mode: nextMode } });
  };

  // 섹션 본문 렌더링. SECTIONS의 6개 id가 모두 여기서 처리된다.
  const renderSectionBody = (id: SectionId, sectionProps: SectionProps) => {
    switch (id) {
      case 'basic':
        return <BasicInfoSection {...sectionProps} />;
      case 'goal':
        return <RetirementGoalSection {...sectionProps} ai={ai} />;
      case 'pension':
        return <PensionStrategySection {...sectionProps} ai={ai} />;
      case 'investment':
        return <InvestmentStrategySection {...sectionProps} ai={ai} />;
      case 'economic':
        return <EconomicAssumptionSection {...sectionProps} />;
      case 'advanced':
        return <AdvancedSection {...sectionProps} />;
      default:
        return null;
    }
  };

  // 섹션별 AI 적용. Task 7·8이 자기 케이스를 추가한다.
  const applyAiToSection = (id: SectionId) => {
    if (id === 'investment') {
      // recommendedAssetReinvestment는 recommendedPlan과 독립적으로 계산된다(Phase 3).
      // 아래 plan 널 체크보다 앞에 두지 않으면, 인출계획은 개선이 없고 배당 재투자만
      // 개선된 경우에도 이 섹션의 AI 추천 버튼이 조용히 아무 일도 하지 않게 된다.
      const recommended = ai.recommendation?.recommendedAssetReinvestment;
      if (!recommended) return;

      // 자산별 권장값을 그대로 적용한다. 전역 스위치는 표시 상태를 자산에서 파생하므로
      // 별도로 갱신할 필요가 없다.
      onChangeParams({
        ...params,
        assets: params.assets.map((a) =>
          a.id in recommended ? { ...a, reinvestDividend: recommended[a.id] } : a
        ),
      });
      return;
    }

    const plan = ai.recommendation?.recommendedPlan;
    if (!plan) return;

    if (id === 'goal' && plan.monthlySpendingMultiplier !== 1) {
      onChangeParams({
        ...params,
        userProfile: {
          ...params.userProfile,
          targetMonthlySpending: Math.round(
            params.userProfile.targetMonthlySpending * plan.monthlySpendingMultiplier
          ),
        },
      });
      return;
    }

    if (id === 'pension') {
      // 추천 나이를 enum으로 역매핑한다. 정확히 일치하는 전략이 없으면(예: 68세)
      // 가장 가까운 값을 고른다 — 후보 생성기의 나이 격자와 전략 4종이 완전히
      // 겹치지는 않기 때문이다.
      const strategy = resolveStrategy(params);
      const targetAge = plan.nationalPensionStartAge;
      const candidates = (Object.keys(NATIONAL_PENSION_STRATEGY_AGES) as NationalPensionStrategy[])
        .filter((k) => k !== 'ai_optimized');
      const nearest = candidates.reduce((best, k) =>
        Math.abs(NATIONAL_PENSION_STRATEGY_AGES[k] - targetAge)
          < Math.abs(NATIONAL_PENSION_STRATEGY_AGES[best] - targetAge) ? k : best
      );

      onChangeParams({
        ...params,
        strategy: {
          ...strategy,
          nationalPensionStrategy: nearest,
          preferIsaFirst: plan.isaMaturityDestination === 'asset',
        },
      });
      return;
    }
  };

  // 섹션이 값을 바꾸면 그 섹션을 잠깐 강조한다. 각 섹션이 highlightSection을
  // 직접 호출하게 하면 여섯 곳에서 잊어버릴 수 있으므로 여기서 한 번만 감싼다.
  const sectionPropsFor = (id: SectionId): SectionProps => ({
    params,
    onChangeParams: (next) => {
      highlightSection(id);
      onChangeParams(next);
    },
    mode,
    changed,
  });

  return (
    <div className="flex flex-col gap-4">
      <StrategyModeSelector mode={mode} onChange={handleModeChange} />

      <div className="flex flex-col gap-2">
        {/* react-hooks/refs 오탐: sectionPropsFor가 만드는 onChangeParams 클로저는 highlightSection을
            통해 ref(clearTimer)를 참조하지만, 실제 실행은 하위 섹션이 자기 이벤트 핸들러 안에서 이
            함수를 호출할 때뿐이다(렌더 중에는 호출되지 않는다). 컴파일러는 renderSectionBody라는
            일반 함수 인자로 전달되는 값까지는 추적하지 못해 보수적으로 에러를 낸다. */}
        {/* eslint-disable-next-line react-hooks/refs */}
        {SECTIONS.map(({ id, title, icon }) => {
          const counts = countSectionChanges(changed, id, mode);
          return (
            <SettingSection
              key={id}
              icon={icon}
              title={title}
              changedCount={counts.visible}
              hiddenChangedCount={counts.hidden}
              highlighted={recentSection === id}
              // 고급 설정은 전문가 모드에서만 기본으로 펼친다.
              defaultOpen={id === 'advanced' ? mode === 'expert' : false}
              onAiRecommend={AI_SECTIONS.has(id) ? () => applyAiToSection(id) : undefined}
              aiDisabled={!ai.improved}
              aiLabel={ai.error ?? (ai.improved ? 'AI 추천' : '이미 최적')}
            >
              {renderSectionBody(id, sectionPropsFor(id))}
            </SettingSection>
          );
        })}
      </div>
    </div>
  );
}
