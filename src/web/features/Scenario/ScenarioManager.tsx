import React, { useEffect, useRef, useState } from 'react';
import styles from './Scenario.module.css';
import { FolderGit2, ChevronDown, ChevronUp, Copy, Trash2, Edit2, CheckSquare, Square, Upload, Download } from 'lucide-react';
import compStyles from '../../styles/components.module.css';
import type { ScenarioModel, SimulationParams } from '../../../core/entities/types';
import { scenarioAnalysisHash } from '../../../core/utils/scenarioAnalysisHash';
import { resolveStrategy } from '../../../core/usecases/strategy/compileStrategy';
import { applyRetirementGoals, resolveRetirementGoals } from '../../../core/usecases/goals/retirementGoalAdapter';
import { normalizeGoalDrivenParams } from '../../../core/usecases/goals/normalizeGoalDrivenParams';
import { retirementGoalDefinition } from '../RetirementGoals/goalCatalog';
import { AGE_MIN } from '../StrategySettings/ageInput';
import type { useScenarios } from './useScenarios';
import { MAX_SCENARIO_COUNT } from '../../../core/utils/scenarioLimits';

// 이 패널은 useScenarios가 돌려주는 상태 뭉치를 통째로 받는다. 훅의 반환 타입을 그대로
// 따라가면 필드를 늘리거나 이름을 바꿀 때 여기서도 바로 어긋남이 드러난다.
type ScenarioState = ReturnType<typeof useScenarios>;

interface ScenarioItemProps {
  scenario: ScenarioModel;
  isActive: boolean;
  isCompared: boolean;
  analysisIsCurrent: boolean;
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
  scenario, isActive, isCompared, analysisIsCurrent, isDuplicateDisabled, onSelect, onToggleCompare,
  onRename, onDuplicate, onDelete, onExport, onImport
}) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(scenario.name);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

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
              <span className={(() => {
                if (!scenario.analyzedAt) return styles.analysisNeededBadge;
                const hashIsStale = Boolean(scenario.analyzedParamsHash && scenario.analyzedParamsHash !== scenarioAnalysisHash(scenario.data));
                const needsReanalysis = hashIsStale || (isActive && !analysisIsCurrent);
                return needsReanalysis ? styles.analysisNeededBadge : styles.analyzedBadge;
              })()}>
                {!scenario.analyzedAt ? '분석 필요' : (scenario.analyzedParamsHash && scenario.analyzedParamsHash !== scenarioAnalysisHash(scenario.data)) || (isActive && !analysisIsCurrent) ? '재분석 필요' : '분석 완료'}
              </span>
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
}> = ({ scenarioState, onScenarioCreated, analysisIsCurrent = false }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCopyMenuOpen, setIsCopyMenuOpen] = useState(false);
  const [earlyRetirementYears, setEarlyRetirementYears] = useState(3);
  const [pendingPreset, setPendingPreset] = useState<{
    label: string;
    name: string;
    data: SimulationParams;
    changes: string[];
    impacts: string[];
  } | null>(null);
  const [createdPresetName, setCreatedPresetName] = useState<string | null>(null);
  const [dismissedNoticeName, setDismissedNoticeName] = useState<string | null>(null);
  const notifiedPresetRef = useRef<string | null>(null);
  const [importTargetId, setImportTargetId] = useState<string | null>(null);

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
  const creationNotice = createdPresetName
    && activeScenario?.name === createdPresetName
    && dismissedNoticeName !== createdPresetName
    ? `${createdPresetName}이 활성화되었습니다. 분석을 시작합니다.`
    : null;

  useEffect(() => {
    if (!onScenarioCreated || !createdPresetName || !activeScenario
      || activeScenario.name !== createdPresetName
      || notifiedPresetRef.current === createdPresetName) return;
    notifiedPresetRef.current = createdPresetName;
    onScenarioCreated(activeScenario);
  }, [activeScenario, createdPresetName, onScenarioCreated]);
  const earlyRetirementGoal = activeScenario
    ? resolveRetirementGoals(activeScenario.data).find((goal) => goal.type === 'EARLY_RETIREMENT')
    : undefined;
  const activeRetirementAge = activeScenario
    ? normalizeGoalDrivenParams(activeScenario.data, resolveStrategy(activeScenario.data)).userProfile.retirementAge
    : 65;
  const currentAge = activeScenario?.data.userProfile.currentAge ?? 1;
  const earlyRetirementBaseAge = earlyRetirementGoal?.targetValue ?? activeRetirementAge;
  const maxEarlyRetirementYears = Math.max(1, (earlyRetirementBaseAge ?? 65) - currentAge - 1);
  const createEarlyRetirementPreset = (years: number) => {
    if (!activeScenario) return null;
    const safeYears = Math.min(Math.max(1, years), maxEarlyRetirementYears);
    const targetAge = Math.max(AGE_MIN, (earlyRetirementBaseAge ?? 65) - safeYears);
    const goals = resolveRetirementGoals(activeScenario.data);
    return {
      label: '빠른 은퇴 비교', name: '빠른 은퇴 비교',
      data: applyRetirementGoals(activeScenario.data, [
        ...goals.filter((goal) => goal.type !== 'EARLY_RETIREMENT'),
        {
          type: 'EARLY_RETIREMENT' as const,
          priority: goals.length + 1,
          targetValue: targetAge,
          constraintType: earlyRetirementGoal?.constraintType ?? retirementGoalDefinition('EARLY_RETIREMENT').defaultConstraintType,
        },
      ]),
      changes: earlyRetirementGoal
        ? [`희망 은퇴 나이: ${earlyRetirementBaseAge}세 → ${targetAge}세`, `${safeYears}년 앞당긴 은퇴 비교`]
        : [`빠른 은퇴 목표 추가: 희망 은퇴 나이 ${targetAge}세`, '기존 목표는 그대로 유지'],
      impacts: ['은퇴 전 준비 기간이 짧아져 은퇴 초기 자산 인출 부담이 커질 수 있습니다.'],
    };
  };
  const earlyRetirementPreset = createEarlyRetirementPreset(earlyRetirementYears);
  const copyPresets = activeScenario ? [
    ...(earlyRetirementPreset ? [earlyRetirementPreset] : []),
    {
      label: '생활비 감소 가정', name: '생활비 감소 가정',
      data: { ...activeScenario.data, strategy: { ...resolveStrategy(activeScenario.data), spendingShape: 'front_loaded' as const } },
      changes: ['생활비 배분: 나이가 들수록 감소'],
      impacts: ['70대 이후 목표 생활비가 줄어 기대수명까지 자산을 유지하는 데 유리할 수 있습니다.'],
    },
    {
      label: '장기 침체 가정', name: '장기 침체 가정',
      data: { ...activeScenario.data, strategy: { ...resolveStrategy(activeScenario.data), economicScenario: 'recession' as const } },
      changes: ['경제 시나리오: 장기 침체'],
      impacts: ['물가·환율을 장기 침체 가정으로 계산해 경제 환경이 불리할 때의 계획을 비교합니다.'],
    },
    {
      label: '국민연금 늦게 받기', name: '국민연금 늦게 받기',
      data: { ...activeScenario.data, strategy: { ...resolveStrategy(activeScenario.data), nationalPensionStrategy: 'defer_max' as const } },
      changes: ['국민연금 수령 시작: 최대 연기(70세)'],
      impacts: ['월 연금액은 늘 수 있지만, 연금 수령 전 자산으로 생활비를 충당하는 기간이 길어집니다.'],
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
            <button type="button" onClick={() => setDismissedNoticeName(createdPresetName)} aria-label="안내 닫기">닫기</button>
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
                {copyPresets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className={styles.presetBtn}
                    onClick={() => {
                      if (preset.label === '빠른 은퇴 비교') {
                        setEarlyRetirementYears(Math.min(3, maxEarlyRetirementYears));
                      }
                      setPendingPreset(preset);
                    }}
                  >
                    {preset.label}
                  </button>
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
          <div className={styles.confirmModal} role="dialog" aria-modal="true" aria-labelledby="preset-title">
            <h3 id="preset-title" className={styles.modalTitle}>{pendingPreset.label}을 만들까요?</h3>
            <p className={styles.managementDescription}>
              현재 시나리오를 복제하고 다음 설정만 변경합니다.
            </p>
            {pendingPreset.label === '빠른 은퇴 비교' && (
              <fieldset className={styles.yearChoice}>
                <legend className={styles.choiceLegend}>몇 년 앞당길까요?</legend>
                <div className={styles.yearButtons}>
                  {[1, 3, 5].map((years) => (
                    <button
                      key={years}
                      type="button"
                      aria-pressed={earlyRetirementYears === Math.min(years, maxEarlyRetirementYears)}
                      disabled={years > maxEarlyRetirementYears}
                      className={`${styles.yearBtn} ${earlyRetirementYears === years ? styles.yearBtnActive : ''}`}
                      onClick={() => {
                        setEarlyRetirementYears(Math.min(years, maxEarlyRetirementYears));
                        const next = createEarlyRetirementPreset(years);
                        if (next) setPendingPreset(next);
                      }}
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
                  min={1}
                  max={maxEarlyRetirementYears}
                  value={earlyRetirementYears}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value)) return;
                    const years = Math.min(Math.max(1, Math.trunc(value)), maxEarlyRetirementYears);
                    setEarlyRetirementYears(years);
                    const next = createEarlyRetirementPreset(years);
                    if (next) setPendingPreset(next);
                  }}
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
            <div className={styles.modalActions}>
              <button type="button" className={styles.secondaryBtn} onClick={() => setPendingPreset(null)}>취소</button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => {
                  scenarioState.handleDuplicateScenario(activeScenario.id, pendingPreset.name, pendingPreset.data);
                  setCreatedPresetName(pendingPreset.name);
                  setDismissedNoticeName(null);
                  setPendingPreset(null);
                  setIsCopyMenuOpen(false);
                }}
              >
                비교안 만들기
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
export default ScenarioManager;
