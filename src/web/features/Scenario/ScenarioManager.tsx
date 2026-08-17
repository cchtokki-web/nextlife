import React, { useState } from 'react';
import styles from './Scenario.module.css';
import { FolderGit2, ChevronDown, ChevronUp, Copy, Trash2, Edit2, CheckSquare, Square, Upload, Download } from 'lucide-react';
import compStyles from '../../styles/components.module.css';
import type { ScenarioModel } from '../../../core/entities/types';
import type { useScenarios } from './useScenarios';
import { MAX_SCENARIO_COUNT } from '../../../core/utils/scenarioLimits';

// 이 패널은 useScenarios가 돌려주는 상태 뭉치를 통째로 받는다. 훅의 반환 타입을 그대로
// 따라가면 필드를 늘리거나 이름을 바꿀 때 여기서도 바로 어긋남이 드러난다.
type ScenarioState = ReturnType<typeof useScenarios>;

interface ScenarioItemProps {
  scenario: ScenarioModel;
  isActive: boolean;
  isCompared: boolean;
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
  scenario, isActive, isCompared, isDuplicateDisabled, onSelect, onToggleCompare,
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

export const ScenarioManager: React.FC<{ scenarioState: ScenarioState }> = ({ scenarioState }) => {
  const [isExpanded, setIsExpanded] = useState(false);
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
          <div className={styles.scenarioList}>
            {scenarios.map((s: ScenarioModel) => (
              <ScenarioItem
                key={s.id}
                scenario={s}
                isActive={s.id === activeScenarioId}
                isCompared={compareScenarioIds.includes(s.id)}
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
    </section>
  );
};
export default ScenarioManager;
