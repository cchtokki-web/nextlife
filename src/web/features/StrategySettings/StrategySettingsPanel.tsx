'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Coins, LineChart, Settings2, Target, TrendingUp, User } from 'lucide-react';
import { RetirementStrategy, SimulationParams, StrategyMode } from '../../../core/entities/types';
import { DEFAULT_RETIREMENT_STRATEGY } from '../../../core/usecases/strategy/compileStrategy';
import { SettingSection } from '../../components/form';
import { StrategyModeSelector } from './StrategyModeSelector';
import { collectChangedPaths, countSectionChanges } from './diffDefaults';
import { SectionId } from './fieldVisibility';

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

export function StrategySettingsPanel({ params, onChangeParams }: StrategySettingsPanelProps) {
  const strategy = resolveStrategy(params);
  const mode = strategy.mode;

  const changed = useMemo(() => collectChangedPaths(params), [params]);

  // 방금 바뀐 섹션을 잠깐 강조한다. 어떤 필드가 바뀌었는지는 changed 집합의 변화로
  // 알 수 있지만, "언제" 바뀌었는지는 상태가 없으면 알 수 없어 로컬 state로 둔다.
  const [recentSection, setRecentSection] = useState<SectionId | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 이번 Task에서는 섹션 본문이 비어 있어 호출부가 없다. Task 4가 섹션 값 변경
  // 핸들러에서 이 함수를 호출한다(브리프 참고).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  return (
    <div className="flex flex-col gap-4">
      <StrategyModeSelector mode={mode} onChange={handleModeChange} />

      <div className="flex flex-col gap-2">
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
            >
              {/* 섹션 본문은 Task 4·6·7·8·10에서 채운다. JSX 주석만으로는 children이 전달되지
                  않아(SettingSection의 children이 필수 prop) null을 명시한다. */}
              {null}
            </SettingSection>
          );
        })}
      </div>
    </div>
  );
}
