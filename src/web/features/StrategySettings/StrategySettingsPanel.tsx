'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Coins, LineChart, Settings2, Target, TrendingUp, User } from 'lucide-react';
import {
  NationalPensionStrategy, SimulationParams, StrategyMode, StrategyRecommendation,
} from '../../../core/entities/types';
import {
  NATIONAL_PENSION_STRATEGY_AGES, resolveStrategy,
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
import { SectionId, isSectionVisible } from './fieldVisibility';
import { AiRecommendationState, SectionProps } from './strategyOptions';

export interface StrategySettingsPanelProps {
  params: SimulationParams;
  onChangeParams: (params: SimulationParams) => void;
  // page.tsx가 이미 계산해 둔 AI 추천. 패널이 직접 recommendStrategy를 부르면 화면 전체에서
  // 가장 무거운 계산(최대 162개 후보 시뮬레이션)이 params 변경마다 두 번 돈다.
  recommendation: StrategyRecommendation | undefined;
  // 추천이 없는 이유가 "계산 실패"인지 "개선 여지 없음"인지 구분한다. 실패일 때만
  // 섹션의 AI 추천 버튼에 에러 문구를 보여준다.
  recommendationFailed: boolean;
}

// 값을 바꾼 섹션을 강조하는 시간. 눈에 띄되 시선을 붙잡지 않을 정도로 짧게 둔다.
// 2초는 "카드 전체가 선택된 것"처럼 읽힐 만큼 길었다.
const HIGHLIGHT_DURATION_MS = 800;

// 섹션 표시 메타. 순서가 화면 순서다.
const SECTIONS: ReadonlyArray<{ id: SectionId; title: string; icon: React.ReactNode }> = [
  { id: 'basic', title: '기본 정보', icon: <User size={16} /> },
  { id: 'goal', title: '은퇴 목표', icon: <Target size={16} /> },
  { id: 'pension', title: '연금 전략', icon: <Coins size={16} /> },
  { id: 'investment', title: '투자 전략', icon: <TrendingUp size={16} /> },
  { id: 'economic', title: '경제 가정', icon: <LineChart size={16} /> },
  { id: 'advanced', title: '고급 설정', icon: <Settings2 size={16} /> },
];

// 저장된 시나리오의 전략 읽기는 core의 resolveStrategy 하나로 모았다(레거시 저수준 필드에서
// 씨앗을 유도하는 규칙까지 그 안에 있다). 기존 import 경로를 쓰던 코드를 위해 재수출한다.
export { resolveStrategy };

// AI 추천 버튼을 붙일 섹션. 배우자·경제 가정처럼 AI가 관여하지 않는 섹션은 제외한다.
const AI_SECTIONS: ReadonlySet<SectionId> = new Set(['goal', 'pension', 'investment']);

export function StrategySettingsPanel({
  params, onChangeParams, recommendation, recommendationFailed,
}: StrategySettingsPanelProps) {
  const strategy = resolveStrategy(params);
  const mode = strategy.mode;

  const changed = useMemo(() => collectChangedPaths(params), [params]);
  // 추천 계산은 page.tsx가 한다(그쪽이 useDeferredValue + useBackgroundValue 파이프라인으로
  // 타이핑 반응성을 지킨다 — useDeferredValue 연쇄로는 2단이 되지 않는다).
  // 여기서는 섹션들이 쓰는 형태로 펴 주기만 한다 — 패널이 따로 지연시키거나 다시 계산하면
  // 같은 결과를 두 번 만들게 된다.
  const ai: AiRecommendationState = useMemo(() => ({
    recommendation: recommendation ?? null,
    error: recommendationFailed ? '추천을 계산하지 못했습니다.' : null,
    improved: recommendation?.improved ?? false,
  }), [recommendation, recommendationFailed]);

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

  // 섹션별 AI 적용 결과를 "적용 후 params" 또는 null(적용할 것이 없음)로 계산한다.
  //
  // 적용 로직과 버튼 활성 판정을 같은 함수로 묶는 이유: aiDisabled가 패널 전역
  // (!ai.improved) 판정이면, 이 섹션에서 바뀔 것이 하나도 없는데도 버튼이 활성으로 남아
  // 눌러도 조용히 아무 일이 일어나지 않는다. 게다가 추천에는 이 화면이 적용할 수 없는
  // 축(사적연금 월 인출 목표 등)이 섞여 있어 improved가 사실상 영구히 true다.
  const buildAiSectionPatch = (id: SectionId): SimulationParams | null => {
    if (id === 'investment') {
      // recommendedAssetReinvestment는 recommendedPlan과 독립적으로 계산된다(Phase 3).
      // 아래 plan 널 체크보다 앞에 두지 않으면, 인출계획은 개선이 없고 배당 재투자만
      // 개선된 경우에도 이 섹션의 AI 추천 버튼이 조용히 아무 일도 하지 않게 된다.
      const recommended = ai.recommendation?.recommendedAssetReinvestment;
      if (!recommended) return null;

      // 이미 권장값과 같으면 적용할 것이 없다.
      const changesAnything = params.assets.some(
        (a) => a.id in recommended && a.reinvestDividend !== recommended[a.id]
      );
      if (!changesAnything) return null;

      // 자산별 권장값을 그대로 적용한다. 전역 스위치는 표시 상태를 자산에서 파생하므로
      // 별도로 갱신할 필요가 없다.
      return {
        ...params,
        assets: params.assets.map((a) =>
          a.id in recommended ? { ...a, reinvestDividend: recommended[a.id] } : a
        ),
      };
    }

    const plan = ai.recommendation?.recommendedPlan;
    if (!plan) return null;

    if (id === 'goal') {
      if (plan.monthlySpendingMultiplier === 1) return null;
      return {
        ...params,
        userProfile: {
          ...params.userProfile,
          targetMonthlySpending: Math.round(
            params.userProfile.targetMonthlySpending * plan.monthlySpendingMultiplier
          ),
        },
      };
    }

    if (id === 'pension') {
      // 추천 나이를 enum으로 역매핑한다. 정확히 일치하는 전략이 없으면(예: 68세)
      // 가장 가까운 값을 고른다 — 후보 생성기의 나이 격자와 전략 4종이 완전히
      // 겹치지는 않기 때문이다.
      const currentStrategy = resolveStrategy(params);
      const targetAge = plan.nationalPensionStartAge;
      const candidates = (Object.keys(NATIONAL_PENSION_STRATEGY_AGES) as NationalPensionStrategy[])
        .filter((k) => k !== 'ai_optimized');
      const nearest = candidates.reduce((best, k) =>
        Math.abs(NATIONAL_PENSION_STRATEGY_AGES[k] - targetAge)
          < Math.abs(NATIONAL_PENSION_STRATEGY_AGES[best] - targetAge) ? k : best
      );
      const preferIsaFirst = plan.isaMaturityDestination === 'asset';

      if (currentStrategy.nationalPensionStrategy === nearest
        && currentStrategy.preferIsaFirst === preferIsaFirst) {
        return null;
      }

      return {
        ...params,
        strategy: { ...currentStrategy, nationalPensionStrategy: nearest, preferIsaFirst },
      };
    }

    return null;
  };

  const applyAiToSection = (id: SectionId) => {
    const next = buildAiSectionPatch(id);
    if (next) onChangeParams(next);
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

  // 이 모드에서 손댈 수 있는 필드가 있는 섹션만 렌더한다.
  const visibleSections = SECTIONS.filter(({ id }) => isSectionVisible(mode, id));

  // 통째로 숨긴 섹션 안에 기본값과 다른 값이 남아 있으면, 그 값은 화면 어디에도 없는 채로
  // 계속 계산에 들어간다. 섹션 헤더 배지가 사라진 자리를 이 요약 한 줄이 대신한다.
  //
  // 보이는 섹션의 숨은 필드(간편 모드의 '목표 상속자산' 등)는 여전히 그 섹션 헤더의
  // hiddenChangedCount가 맡는다. 여기서 함께 세면 같은 변경이 두 곳에 보고된다.
  const hiddenSectionChanges = SECTIONS
    .filter(({ id }) => !isSectionVisible(mode, id))
    .reduce((sum, { id }) => sum + countSectionChanges(changed, id, mode).hidden, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        <StrategyModeSelector mode={mode} onChange={handleModeChange} />

        {hiddenSectionChanges > 0 && (
          <p
            data-testid="hidden-section-notice"
            className="rounded-lg border border-card-border bg-[rgba(0,0,0,0.25)] px-3.5 py-2.5 text-xs leading-relaxed text-foreground-muted"
          >
            이 모드에서 숨겨진 사용자 설정 {hiddenSectionChanges}개가 계산에 그대로 반영됩니다.
            값을 확인하거나 되돌리려면 전문가 모드로 바꾸세요.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3.5 sm:gap-4">
        {/* react-hooks/refs 오탐: sectionPropsFor가 만드는 onChangeParams 클로저는 highlightSection을
            통해 ref(clearTimer)를 참조하지만, 실제 실행은 하위 섹션이 자기 이벤트 핸들러 안에서 이
            함수를 호출할 때뿐이다(렌더 중에는 호출되지 않는다). 컴파일러는 renderSectionBody라는
            일반 함수 인자로 전달되는 값까지는 추적하지 못해 보수적으로 에러를 낸다. */}
        {/* eslint-disable-next-line react-hooks/refs */}
        {visibleSections.map(({ id, title, icon }) => {
          const counts = countSectionChanges(changed, id, mode);
          // 이 섹션에서 실제로 바뀌는 값이 있을 때만 버튼을 연다.
          const canApplyAi = AI_SECTIONS.has(id) && buildAiSectionPatch(id) !== null;
          // 적용할 것이 없으면 버튼 자체를 내지 않는다.
          //
          // 예전에는 '이미 최적'이라는 비활성 버튼이 그 자리를 지켰는데, 누를 수도 없고
          // 알려 주는 것도 없으면서 헤더 폭의 3분의 1을 계속 차지했다. 추천 계산이 실패한
          // 경우(ai.error)는 다르다 — "추천을 못 받았다"는 사실 자체를 알려야 하므로 남긴다.
          const showAiButton = canApplyAi || !!ai.error;
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
              onAiRecommend={showAiButton ? () => applyAiToSection(id) : undefined}
              aiDisabled={!!ai.error}
              aiLabel={ai.error ?? 'AI 추천'}
            >
              {renderSectionBody(id, sectionPropsFor(id))}
            </SettingSection>
          );
        })}
      </div>
    </div>
  );
}
