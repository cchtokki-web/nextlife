import React, { useEffect, useRef, useState } from 'react';
import styles from './Scenario.module.css';
import { FolderGit2, ChevronDown, ChevronUp, Copy, Trash2, Edit2, CheckSquare, Square, Upload, Download } from 'lucide-react';
import compStyles from '../../styles/components.module.css';
import type { ScenarioModel, SimulationParams } from '../../../core/entities/types';
import { isComparableScenarioAnalysisHash, scenarioAnalysisHash } from '../../../core/utils/scenarioAnalysisHash';
import { resolveStrategy } from '../../../core/usecases/strategy/compileStrategy';
import { applyRetirementGoals, resolveRetirementGoals } from '../../../core/usecases/goals/retirementGoalAdapter';
import { normalizeGoalDrivenParams } from '../../../core/usecases/goals/normalizeGoalDrivenParams';
import { MAX_RETIREMENT_GOALS } from '../../../core/entities/retirementGoal';
import { retirementGoalDefinition } from '../RetirementGoals/goalCatalog';
import type { useScenarios } from './useScenarios';
import { MAX_SCENARIO_COUNT } from '../../../core/utils/scenarioLimits';
import { parseNumericInput, useNumericDraft } from '../../components/fields/numericDraft';

// 비교안의 «신원». 예전에는 화면에 찍히는 한글 라벨을 그대로 비교했는데(preset.label ===
// '빠른 은퇴 비교'), 문구를 다듬는 순간 연차 선택 UI가 컴파일 오류 하나 없이 사라진다.
type PresetKind = 'early_retirement' | 'front_loaded_spending' | 'recession' | 'defer_pension';

interface ComparisonPreset {
  kind: PresetKind;
  label: string;
  data: SimulationParams;
  changes: string[];
  impacts: string[];
}

// 만들 수 없는 비교안은 목록에서 숨기지 않고 «이유와 함께» 비활성으로 남긴다. 조용히 빼면
// 사용자는 그 비교안이 원래 없는 줄 안다.
interface PresetOption {
  kind: PresetKind;
  label: string;
  preset: ComparisonPreset | null;
  blockedReason: string | null;
}

// 이 패널은 useScenarios가 돌려주는 상태 뭉치를 통째로 받는다. 훅의 반환 타입을 그대로
// 따라가면 필드를 늘리거나 이름을 바꿀 때 여기서도 바로 어긋남이 드러난다.
type ScenarioState = ReturnType<typeof useScenarios>;

interface ScenarioItemProps {
  scenario: ScenarioModel;
  isActive: boolean;
  isCompared: boolean;
  analysisIsCurrent: boolean;
  analysisFailed: boolean;
  isDuplicateDisabled: boolean;
  onSelect: () => void;
  onToggleCompare: () => void;
  onRename: (newName: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: (e: React.MouseEvent) => void;
  onImport: (e: React.MouseEvent) => void;
}

const ScenarioItem: React.FC<ScenarioItemProps> = ({
  scenario, isActive, isCompared, analysisIsCurrent, analysisFailed, isDuplicateDisabled, onSelect, onToggleCompare,
  onRename, onDuplicate, onDelete, onExport, onImport
}) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(scenario.name);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  // 배지 상태는 «한 번만» 계산한다. 예전에는 같은 조건식이 className 자리와 라벨 자리에 따로
  // 있어서, 한쪽만 고치면 「재분석 필요」라는 글자가 완료(초록) 스타일을 입을 수 있었다.
  // 겸사겸사 시나리오당 두 번 돌던 전체 params 직렬화도 한 번으로 준다.
  const analysisBadge = ((): { className: string; label: string } => {
    if (!scenario.analyzedAt) return { className: styles.analysisNeededBadge, label: '분석 필요' };

    // 「분석 시작」을 누른 사실은 결과가 나오기 전에 기록된다(그래야 다음 접속에서 결과
    // 화면을 다시 세울 수 있다). 그래서 analyzedAt만 보면 실패한 분석도 「분석 완료」로
    // 읽힌다 — 검증이 끝나지 않은 계획을 검증됐다고 말하는 셈이다. 실행 중인 분석의
    // 실패는 그 사실을 아는 이 자리에서만 말할 수 있다.
    if (isActive && analysisFailed) {
      return { className: styles.analysisFailedBadge, label: '분석 실패' };
    }

    const activeIsStale = isActive && !analysisIsCurrent;
    if (!isComparableScenarioAnalysisHash(scenario.analyzedParamsHash)) {
      // 이 필드가 생기기 전에 분석했거나 해시 규칙이 바뀐 시나리오다. 무엇으로 분석했는지
      // 알 수 없으므로 「분석 완료」라고 단언하지 않는다 — 단언하면 그 뒤로 아무리 설정을
      // 바꿔도 영원히 초록 배지가 유지된다. 한 번 더 분석하면 그때부터 추적이 시작된다.
      return activeIsStale
        ? { className: styles.analysisNeededBadge, label: '재분석 필요' }
        : { className: styles.analysisUnknownBadge, label: '분석 시점 확인 불가' };
    }

    const hashIsStale = scenario.analyzedParamsHash !== scenarioAnalysisHash(scenario.data);
    return hashIsStale || activeIsStale
      ? { className: styles.analysisNeededBadge, label: '재분석 필요' }
      : { className: styles.analyzedBadge, label: '분석 완료' };
  })();

  return (
    <div 
      className={`${styles.scenarioItem} ${isActive ? styles.scenarioItemActive : ''}`}
      onClick={() => { if (!isRenaming) onSelect(); }}
    >
      <div className={styles.scenarioItemHeader}>
        <div className={styles.scenarioNameContainer} style={{ paddingRight: '8px' }}>
          {isRenaming ? (
            <input 
              type="text" 
              value={renameValue} 
              onChange={(e) => setRenameValue(e.target.value)} 
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameValue.trim()) {
                  onRename(renameValue.trim());
                  setIsRenaming(false);
                } else if (e.key === 'Escape') {
                  setIsRenaming(false);
                  setRenameValue(scenario.name);
                }
              }}
              autoFocus
              className={styles.renameInput}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className={`${styles.scenarioName} ${isActive ? styles.scenarioNameActive : styles.scenarioNameInactive}`}>
                {scenario.name}
              </span>
              {scenario.isDefault && <span className={styles.defaultBadge}>기본</span>}
              <span className={analysisBadge.className}>{analysisBadge.label}</span>
            </>
          )}
        </div>
      </div>
      <div className={styles.scenarioActionsRow}>
        <button 
          onClick={(e) => { e.stopPropagation(); onToggleCompare(); }}
          className={`${styles.actionBtn} ${styles.compareBtn} ${isCompared ? styles.compareBtnActive : styles.compareBtnInactive}`}
          title="비교 차트에 표시"
        >
          {isCompared ? <CheckSquare size={16} /> : <Square size={16} />} <span>비교</span>
        </button>
        <div className={styles.actionGroup}>
          {isRenaming ? (
            <>
              <button onClick={(e) => { e.stopPropagation(); if (renameValue.trim()) { onRename(renameValue.trim()); setIsRenaming(false); } }} className={styles.primaryBtn}>확인</button>
              <button onClick={(e) => { e.stopPropagation(); setIsRenaming(false); setRenameValue(scenario.name); }} className={styles.secondaryBtn}>취소</button>
            </>
          ) : isConfirmingDelete ? (
            <>
              <span className={styles.confirmText}>삭제 확인</span>
              <button onClick={(e) => { e.stopPropagation(); onDelete(); setIsConfirmingDelete(false); }} className={styles.primaryBtn} style={{ background: 'var(--danger)' }}>확인</button>
              <button onClick={(e) => { e.stopPropagation(); setIsConfirmingDelete(false); }} className={styles.secondaryBtn}>취소</button>
            </>
          ) : (
            <>
              {!scenario.isDefault && (
                <button onClick={(e) => { e.stopPropagation(); setIsRenaming(true); setIsConfirmingDelete(false); }} className={`${styles.actionBtn} ${styles.iconBtn}`} title="이름 변경"><Edit2 size={16} /></button>
              )}
              <button 
                onClick={(e) => { e.stopPropagation(); if (!isDuplicateDisabled) onDuplicate(); }} 
                className={`${styles.actionBtn} ${styles.iconBtn}`} 
                title={isDuplicateDisabled ? `최대 ${MAX_SCENARIO_COUNT}개까지만 생성할 수 있습니다` : "복제"}
                disabled={isDuplicateDisabled}
                style={isDuplicateDisabled ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
              ><Copy size={16} /></button>
              <button onClick={(e) => { e.stopPropagation(); onImport(e); }} className={`${styles.actionBtn} ${styles.iconBtn}`} title="불러오기"><Upload size={16} /></button>
              <button onClick={(e) => { e.stopPropagation(); onExport(e); }} className={`${styles.actionBtn} ${styles.iconBtn}`} title="내보내기"><Download size={16} /></button>
              {!scenario.isDefault && (
                <button onClick={(e) => { e.stopPropagation(); setIsConfirmingDelete(true); setIsRenaming(false); }} className={`${styles.actionBtn} ${styles.iconBtn} ${styles.dangerBtn}`} title="삭제"><Trash2 size={16} /></button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export const ScenarioManager: React.FC<{
  scenarioState: ScenarioState;
  onScenarioCreated?: (scenario: ScenarioModel) => void;
  analysisIsCurrent?: boolean;
  analysisFailed?: boolean;
}> = ({ scenarioState, onScenarioCreated, analysisIsCurrent = false, analysisFailed = false }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCopyMenuOpen, setIsCopyMenuOpen] = useState(false);
  const [earlyRetirementYears, setEarlyRetirementYears] = useState(3);
  const [pendingPreset, setPendingPreset] = useState<ComparisonPreset | null>(null);
  // 새로 만든 시나리오는 «id»로 좇는다. 이름으로 좇으면 프리셋 이름이 고정 리터럴이라
  // 두 번째 생성부터 같은 이름의 옛 시나리오를 붙잡거나, 래치에 걸려 분석이 아예 시작되지
  // 않는다(안내 문구는 「분석을 시작합니다」를 그대로 띄운 채로).
  const [createdScenarioId, setCreatedScenarioId] = useState<string | null>(null);
  const [dismissedNoticeId, setDismissedNoticeId] = useState<string | null>(null);
  const notifiedScenarioIdRef = useRef<string | null>(null);
  const [isCreatingPreset, setIsCreatingPreset] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [importTargetId, setImportTargetId] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  const handleImportClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setImportTargetId(id);
    const fileInput = document.getElementById('scenario-file-input') as HTMLInputElement;
    if (fileInput) fileInput.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !importTargetId) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        // userProfile 유무는 "시나리오 파일이 맞는가"의 최소 판별일 뿐이다. 값의 정제는
        // importScenarioData가 다른 로드 경로와 같은 migrateParams로 처리한다 — 여기서
        // 캐스팅해 넘기면 조작된 JSON이 그대로 상태와 엔진까지 들어간다.
        if (json && typeof json === 'object' && json.userProfile) {
          scenarioState.importScenarioData(importTargetId, json);
          scenarioState.setActiveScenarioId(importTargetId);
          alert('시나리오 데이터를 성공적으로 불러왔습니다.');
        } else {
          alert('올바른 시나리오 데이터 파일이 아닙니다.');
        }
      } catch (err) {
        console.error('Failed to parse JSON file:', err);
        alert('파일을 읽는 중 오류가 발생했습니다.');
      }
      e.target.value = '';
      setImportTargetId(null);
    };
    reader.readAsText(file);
  };

  const handleExportScenario = (e: React.MouseEvent, scenario: ScenarioModel) => {
    e.stopPropagation();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(scenario.data, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    
    // Format date in local timezone
    const localDate = new Date();
    const year = localDate.getFullYear();
    const month = String(localDate.getMonth() + 1).padStart(2, '0');
    const day = String(localDate.getDate()).padStart(2, '0');
    const formattedDate = `${year}-${month}-${day}`;

    downloadAnchorNode.setAttribute("download", `${scenario.name}_${formattedDate}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const {
    scenarios, activeScenarioId, setActiveScenarioId, compareScenarioIds,
    toggleCompareScenario, handleDuplicateScenario, handleDeleteScenario, handleRenameScenario
  } = scenarioState;

  const activeScenario = scenarios.find((scenario) => scenario.id === activeScenarioId);
  const createdScenario = createdScenarioId
    ? scenarios.find((scenario) => scenario.id === createdScenarioId)
    : undefined;
  const creationNotice = createdScenario
    && activeScenarioId === createdScenarioId
    && dismissedNoticeId !== createdScenarioId
    ? `${createdScenario.name}이 활성화되었습니다. 분석을 시작합니다.`
    : null;

  useEffect(() => {
    if (!onScenarioCreated || !createdScenario
      || activeScenarioId !== createdScenario.id
      || notifiedScenarioIdRef.current === createdScenario.id) return;
    notifiedScenarioIdRef.current = createdScenario.id;
    onScenarioCreated(createdScenario);
  }, [createdScenario, activeScenarioId, onScenarioCreated]);

  // 모달이 열려 있는 동안 Escape로 닫고 포커스를 안으로 들여놓는다. role="dialog"
  // aria-modal="true"만 붙어 있으면 보조기술에는 모달이라고 말해 놓고 실제 포커스는 뒤쪽
  // 버튼들 사이를 그대로 돌아다닌다.
  useEffect(() => {
    if (!pendingPreset) return;
    modalRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingPreset(null);
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === modalRef.current)) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pendingPreset]);
  const earlyRetirementGoal = activeScenario
    ? resolveRetirementGoals(activeScenario.data).find((goal) => goal.type === 'EARLY_RETIREMENT')
    : undefined;
  const activeRetirementAge = activeScenario
    ? normalizeGoalDrivenParams(activeScenario.data, resolveStrategy(activeScenario.data)).userProfile.retirementAge
    : 65;
  const currentAge = activeScenario?.data.userProfile.currentAge;
  const earlyRetirementBaseAge = earlyRetirementGoal?.targetValue ?? activeRetirementAge;

  // 앞당길 수 있는 «실제» 여지. 예전에는 이 값을 Math.max(1, …)로 바닥을 쳐 두어, 이미 은퇴
  // 나이에 도달한 사용자에게도 「최대 1년」을 제시하고 현재 나이보다 어린 목표 나이를 만들어
  // 냈다. normalizeGoalDrivenParams가 그 값을 다시 현재 나이로 끌어올리므로 계산 결과는
  // 원본과 같아지고, 달성할 수 없는 목표만 붙은 비교안이 남는다.
  const earlyRetirementHeadroom = currentAge === undefined
    ? 0
    : earlyRetirementBaseAge - currentAge - 1;
  const maxEarlyRetirementYears = Math.max(0, earlyRetirementHeadroom);

  const createEarlyRetirementPreset = (years: number): ComparisonPreset | null => {
    if (!activeScenario || maxEarlyRetirementYears < 1) return null;
    const safeYears = Math.min(Math.max(1, years), maxEarlyRetirementYears);
    const targetAge = earlyRetirementBaseAge - safeYears;
    const goals = resolveRetirementGoals(activeScenario.data);

    // 기존 목표는 «제자리에서» 값만 바꾼다. 예전에는 filter로 빼고 맨 뒤에 다시 붙였는데,
    // normalizeRetirementGoals가 우선순위를 정렬 순서대로 다시 매기므로 그 목표가 항상
    // 최하위로 강등됐다. 목표 가중치(goalUtilityConfig)가 함께 바뀌면 은퇴 나이 말고
    // 채점 축까지 움직여, 「다음 설정만 변경합니다」라는 약속이 깨진다.
    const nextGoals = earlyRetirementGoal
      ? goals.map((goal) => (goal.type === 'EARLY_RETIREMENT' ? { ...goal, targetValue: targetAge } : goal))
      : [...goals, {
        type: 'EARLY_RETIREMENT' as const,
        priority: goals.length + 1,
        targetValue: targetAge,
        constraintType: retirementGoalDefinition('EARLY_RETIREMENT').defaultConstraintType,
      }];

    return {
      kind: 'early_retirement',
      label: '빠른 은퇴 비교',
      data: applyRetirementGoals(activeScenario.data, nextGoals),
      changes: earlyRetirementGoal
        ? [`희망 은퇴 나이: ${earlyRetirementBaseAge}세 → ${targetAge}세`, `${safeYears}년 앞당긴 은퇴 비교`]
        : [`빠른 은퇴 목표 추가: 희망 은퇴 나이 ${targetAge}세`, '기존 목표는 그대로 유지'],
      impacts: ['은퇴 전 준비 기간이 짧아져 은퇴 초기 자산 인출 부담이 커질 수 있습니다.'],
    };
  };

  /**
   * 「직접 입력」 칸의 타이핑 중간 상태.
   *
   * 예전에는 키 입력마다 Number('')의 0을 다시 1로 끌어올려 저장했다. 한 자리만 남은
   * 순간부터는 저장값이 그대로라 다음 렌더가 방금 지운 DOM 값을 옛 숫자로 되돌려 놓아,
   * 아무리 지워도 마지막 한 자리가 되살아났다(모바일 사파리에서 보고된 증상).
   * 화면에 보일 텍스트는 초안이 쥐고, 저장은 연차로 읽을 수 있을 때만 한다 —
   * 규약은 numericDraft.ts 주석과 같다.
   */
  const yearsDraft = useNumericDraft({
    value: earlyRetirementYears,
    format: (years) => String(years),
    // 저장하는 값은 예전과 같이 «허용 범위 안의 정수»다. 달라진 것은 빈 칸·미완성 입력을
    // 숫자로 지어내지 않는다는 것뿐이다.
    parse: (raw) => {
      const parsed = parseNumericInput(raw);
      if (parsed === null) return null;
      return Math.min(Math.max(1, Math.trunc(parsed)), maxEarlyRetirementYears);
    },
    onCommit: (years) => {
      setEarlyRetirementYears(years);
      const next = createEarlyRetirementPreset(years);
      if (next) setPendingPreset(next);
    },
  });

  // 1·3·5년 버튼은 입력을 거치지 않고 연차를 바꾼다. 초안을 남겨 두면 방금 친 텍스트가
  // 계속 보여서 버튼이 «먹지 않는» 것처럼 읽힌다.
  const chooseEarlyRetirementYears = (years: number) => {
    yearsDraft.reset();
    setEarlyRetirementYears(years);
    const next = createEarlyRetirementPreset(years);
    if (next) setPendingPreset(next);
  };

  // 「빠른 은퇴」 목표가 없는데 목표가 이미 상한이면 새 목표를 넣을 자리가 없다. 그냥 넣으면
  // normalizeRetirementGoals의 slice(0, MAX_RETIREMENT_GOALS)가 방금 넣은 목표를 조용히
  // 잘라내고, 원본과 «완전히 똑같은» 시나리오가 「빠른 은퇴 비교」라는 이름으로 만들어진다.
  // 사용자는 그것을 보고 "일찍 은퇴해도 내 계획은 안 바뀌는구나"라고 결론낸다.
  const earlyRetirementBlockedReason = ((): string | null => {
    if (!activeScenario) return null;
    if (maxEarlyRetirementYears < 1) {
      return '이미 희망 은퇴 나이에 도달해 더 앞당길 수 없습니다.';
    }
    if (!earlyRetirementGoal
      && resolveRetirementGoals(activeScenario.data).length >= MAX_RETIREMENT_GOALS) {
      return `목표가 이미 ${MAX_RETIREMENT_GOALS}개라 빠른 은퇴 목표를 추가할 수 없습니다. 목표를 하나 지운 뒤 다시 시도해 주세요.`;
    }
    return null;
  })();

  const earlyRetirementPreset = earlyRetirementBlockedReason
    ? null
    : createEarlyRetirementPreset(earlyRetirementYears);

  const copyPresets: PresetOption[] = activeScenario ? [
    {
      kind: 'early_retirement',
      label: '빠른 은퇴 비교',
      preset: earlyRetirementPreset,
      blockedReason: earlyRetirementBlockedReason,
    },
    {
      kind: 'front_loaded_spending',
      label: '생활비 감소 가정',
      blockedReason: null,
      preset: {
        kind: 'front_loaded_spending',
        label: '생활비 감소 가정',
        data: { ...activeScenario.data, strategy: { ...resolveStrategy(activeScenario.data), spendingShape: 'front_loaded' as const } },
        changes: ['생활비 배분: 나이가 들수록 감소'],
        impacts: ['70대 이후 목표 생활비가 줄어 기대수명까지 자산을 유지하는 데 유리할 수 있습니다.'],
      },
    },
    {
      kind: 'recession',
      label: '장기 침체 가정',
      blockedReason: null,
      preset: {
        kind: 'recession',
        label: '장기 침체 가정',
        data: { ...activeScenario.data, strategy: { ...resolveStrategy(activeScenario.data), economicScenario: 'recession' as const } },
        changes: ['경제 시나리오: 장기 침체'],
        impacts: ['물가·환율을 장기 침체 가정으로 계산해 경제 환경이 불리할 때의 계획을 비교합니다.'],
      },
    },
    {
      kind: 'defer_pension',
      label: '국민연금 늦게 받기',
      blockedReason: null,
      preset: {
        kind: 'defer_pension',
        label: '국민연금 늦게 받기',
        data: { ...activeScenario.data, strategy: { ...resolveStrategy(activeScenario.data), nationalPensionStrategy: 'defer_max' as const } },
        changes: ['국민연금 수령 시작: 최대 연기(70세)'],
        impacts: ['월 연금액은 늘 수 있지만, 연금 수령 전 자산으로 생활비를 충당하는 기간이 길어집니다.'],
      },
    },
  ] : [];

  return (
    <section className={styles.container} aria-labelledby="scenario-context-title">
      <div className={styles.contextHeading}>
        <div className={styles.contextTitleRow}>
          <FolderGit2 size={18} className={styles.icon} aria-hidden="true" />
          <div>
            <h2 id="scenario-context-title" className={styles.contextTitle}>시나리오</h2>
            <p className={styles.contextDescription}>선택한 시나리오의 설정과 자산이 아래에 표시됩니다.</p>
          </div>
        </div>
      </div>

      <div className={styles.contextControls}>
        <label className={styles.selectLabel} htmlFor="active-scenario-select">현재 시나리오</label>
        <div className={styles.selectRow}>
          <div className={styles.selectWrap}>
            <select
              id="active-scenario-select"
              className={styles.scenarioSelect}
              value={activeScenarioId ?? ''}
              onChange={(event) => setActiveScenarioId(event.target.value)}
            >
              {scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>{scenario.name}</option>
              ))}
            </select>
            <ChevronDown size={16} className={styles.selectChevron} aria-hidden="true" />
          </div>
          <button
            type="button"
            className={styles.manageButton}
            aria-expanded={isExpanded}
            aria-controls="scenario-management-list"
            onClick={() => setIsExpanded((expanded) => !expanded)}
          >
            관리
            {isExpanded
              ? <ChevronUp size={16} aria-hidden="true" />
              : <ChevronDown size={16} aria-hidden="true" />}
          </button>
        </div>
        {activeScenario?.isDefault && <span className={styles.activeHint}>기본 시나리오</span>}
        {creationNotice && (
          <p role="status" className={styles.creationNotice}>
            {creationNotice}
            <button type="button" onClick={() => setDismissedNoticeId(createdScenarioId)} aria-label="안내 닫기">닫기</button>
          </p>
        )}
      </div>

      {isExpanded && (
        <div id="scenario-management-list" className={styles.managementPanel}>
          <div className={styles.managementHeader}>
            <div>
              <span className={compStyles.label}>시나리오 관리</span>
              <p className={styles.managementDescription}>비교하거나 복제하고, 이름과 파일을 관리할 수 있습니다.</p>
            </div>
            <input 
              type="file" id="scenario-file-input" accept=".json" 
              style={{ display: 'none' }} onChange={handleFileChange} 
            />
          </div>
          <div className={styles.presetSection}>
            <button
              type="button"
              className={styles.presetBtn}
              aria-expanded={isCopyMenuOpen}
              onClick={() => setIsCopyMenuOpen((open) => !open)}
              disabled={!activeScenario || scenarios.length >= MAX_SCENARIO_COUNT}
            >
              목적별 비교안 만들기
            </button>
            {isCopyMenuOpen && activeScenario && scenarios.length < MAX_SCENARIO_COUNT && (
              <div className={styles.presetButtons} role="group" aria-label="목적별 비교안">
                <p className={styles.helpText}>
                  선택한 전략을 반영한 비교안을 만들고, 생성 전에 변경 내용을 확인합니다.
                </p>
                {copyPresets.map((option) => (
                  <div key={option.kind} className={styles.presetOption}>
                    <button
                      type="button"
                      className={styles.presetBtn}
                      disabled={!option.preset}
                      title={option.blockedReason ?? undefined}
                      onClick={() => {
                        // 비교안은 «지금 설정하는 연차»로 다시 만든다. 예전에는 렌더 시점에
                        // 만들어 둔 객체를 그대로 담아서, 5년으로 만들었다가 취소하고 다시
                        // 열면 화면은 3년을 가리키는데 실제로는 5년짜리가 생성됐다.
                        if (option.kind === 'early_retirement') {
                          const years = Math.min(3, maxEarlyRetirementYears);
                          setEarlyRetirementYears(years);
                          setPendingPreset(createEarlyRetirementPreset(years));
                        } else {
                          setPendingPreset(option.preset);
                        }
                        setPresetError(null);
                      }}
                    >
                      {option.label}
                    </button>
                    {option.blockedReason && (
                      <p className={styles.presetBlockedReason}>{option.blockedReason}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className={styles.scenarioList}>
            {scenarios.map((s: ScenarioModel) => (
              <ScenarioItem
                key={s.id}
                scenario={s}
                isActive={s.id === activeScenarioId}
                isCompared={compareScenarioIds.includes(s.id)}
                analysisIsCurrent={analysisIsCurrent}
                analysisFailed={analysisFailed}
                isDuplicateDisabled={scenarios.length >= MAX_SCENARIO_COUNT}
                onSelect={() => setActiveScenarioId(s.id)}
                onToggleCompare={() => toggleCompareScenario(s.id)}
                onRename={(newName) => handleRenameScenario(s.id, newName)}
                onDuplicate={() => handleDuplicateScenario(s.id)}
                onDelete={() => handleDeleteScenario(s.id)}
                onExport={(e) => handleExportScenario(e, s)}
                onImport={(e) => handleImportClick(s.id, e)}
              />
            ))}
          </div>
        </div>
      )}

      {pendingPreset && activeScenario && (
        <div className={styles.modalBackdrop} role="presentation">
          <div
            ref={modalRef}
            tabIndex={-1}
            className={styles.confirmModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="preset-title"
          >
            <h3 id="preset-title" className={styles.modalTitle}>{pendingPreset.label}을 만들까요?</h3>
            <p className={styles.managementDescription}>
              현재 시나리오를 복제하고 다음 설정만 변경합니다.
            </p>
            {pendingPreset.kind === 'early_retirement' && (
              <fieldset className={styles.yearChoice}>
                <legend className={styles.choiceLegend}>몇 년 앞당길까요?</legend>
                <div className={styles.yearButtons}>
                  {[1, 3, 5].map((years) => (
                    <button
                      key={years}
                      type="button"
                      // 보이는 표시와 보조기술에 읽히는 상태는 «같은» 식이어야 한다. 예전에는
                      // aria-pressed만 Math.min을 거쳐서, 상한이 2년일 때 3년·5년 버튼이
                      // 둘 다 눌린 것으로 읽히는데 화면에는 아무것도 활성이 아니었다.
                      aria-pressed={earlyRetirementYears === years}
                      disabled={years > maxEarlyRetirementYears}
                      className={`${styles.yearBtn} ${earlyRetirementYears === years ? styles.yearBtnActive : ''}`}
                      onClick={() => chooseEarlyRetirementYears(years)}
                    >
                      {years}년
                    </button>
                  ))}
                </div>
                <label className={styles.customYearsLabel} htmlFor="early-retirement-years">
                  직접 입력 (최대 {maxEarlyRetirementYears}년)
                </label>
                <input
                  id="early-retirement-years"
                  type="number"
                  inputMode="numeric"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  min={1}
                  max={maxEarlyRetirementYears}
                  value={yearsDraft.value}
                  onChange={yearsDraft.onChange}
                  onBlur={yearsDraft.onBlur}
                  className={styles.customYearsInput}
                />
              </fieldset>
            )}
            <ul className={styles.changeList}>
              {pendingPreset.changes.map((change) => <li key={change}>{change}</li>)}
            </ul>
            <div className={styles.impactNotice}>
              <strong>예상되는 영향</strong>
              <ul>
                {pendingPreset.impacts.map((impact) => <li key={impact}>{impact}</li>)}
              </ul>
            </div>
            {presetError && <p role="alert" className={styles.presetError}>{presetError}</p>}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                disabled={isCreatingPreset}
                onClick={() => { setPendingPreset(null); setPresetError(null); }}
              >
                취소
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={isCreatingPreset}
                onClick={async () => {
                  setIsCreatingPreset(true);
                  setPresetError(null);
                  const created = await scenarioState.handleDuplicateScenario(
                    activeScenario.id, pendingPreset.label, pendingPreset.data,
                  );
                  setIsCreatingPreset(false);
                  // 생성에 실패했는데 모달을 닫으면 사용자에게는 아무 일도 없었던 것처럼 보인다.
                  // 열어 둔 채로 이유를 말하고 다시 누를 수 있게 남긴다.
                  if (!created) {
                    setPresetError('비교안을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
                    return;
                  }
                  setCreatedScenarioId(created.id);
                  setDismissedNoticeId(null);
                  setPendingPreset(null);
                  setIsCopyMenuOpen(false);
                }}
              >
                {isCreatingPreset ? '만드는 중…' : '비교안 만들기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
export default ScenarioManager;
