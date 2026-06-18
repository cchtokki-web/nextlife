import React, { useState } from 'react';
import styles from './Scenario.module.css';
import { FolderGit2, ChevronDown, ChevronUp, Copy, Trash2, Edit2, CheckSquare, Square, FileJson, Upload } from 'lucide-react';
import compStyles from '../../styles/components.module.css';

interface ScenarioItemProps {
  scenario: any;
  isActive: boolean;
  isCompared: boolean;
  onSelect: () => void;
  onToggleCompare: () => void;
  onRename: (newName: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: (e: React.MouseEvent) => void;
}

const ScenarioItem: React.FC<ScenarioItemProps> = ({
  scenario, isActive, isCompared, onSelect, onToggleCompare,
  onRename, onDuplicate, onDelete, onExport
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
              <button onClick={(e) => { e.stopPropagation(); setIsRenaming(true); setIsConfirmingDelete(false); }} className={`${styles.actionBtn} ${styles.iconBtn}`} title="이름 변경"><Edit2 size={16} /></button>
              <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className={`${styles.actionBtn} ${styles.iconBtn}`} title="복제"><Copy size={16} /></button>
              <button onClick={(e) => { e.stopPropagation(); onExport(e); }} className={`${styles.actionBtn} ${styles.iconBtn}`} title="JSON 내보내기"><FileJson size={16} /></button>
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

export const ScenarioManager: React.FC<{ scenarioState: any }> = ({ scenarioState }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const handleImportJson = () => {
    const fileInput = document.getElementById('scenario-file-input') as HTMLInputElement;
    if (fileInput) fileInput.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (json && typeof json === 'object' && json.userProfile) {
          const newName = file.name.replace('.json', '');
          scenarioState.handleCreateScenario(`[가져옴] ${newName}`, json);
        } else {
          alert('올바른 시나리오 데이터 파일이 아닙니다.');
        }
      } catch (err) {
        console.error('Failed to parse JSON file:', err);
        alert('파일을 읽는 중 오류가 발생했습니다.');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleExportScenario = (e: React.MouseEvent, scenario: any) => {
    e.stopPropagation();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(scenario.data, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `nextlife_${scenario.name}_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const {
    scenarios, activeScenarioId, setActiveScenarioId, compareScenarioIds,
    toggleCompareScenario, handleDuplicateScenario, handleDeleteScenario, handleRenameScenario
  } = scenarioState;

  return (
    <div className={styles.container}>
      <div 
        className={styles.header}
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isExpanded ? '1rem' : '0' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FolderGit2 size={18} className={styles.icon} />
          <span className={styles.title}>시나리오 관리</span>
        </div>
        {isExpanded ? <ChevronUp size={18} className={styles.icon} /> : <ChevronDown size={18} className={styles.icon} />}
      </div>

      {isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <label className={compStyles.label} style={{ margin: 0 }}>내 시나리오 목록</label>
            <button 
              onClick={handleImportJson} 
              style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', padding: '0' }}
              title="시나리오 불러오기"
            >
              <Upload size={14} /> <span>불러오기</span>
            </button>
            <input 
              type="file" id="scenario-file-input" accept=".json" 
              style={{ display: 'none' }} onChange={handleFileChange} 
            />
          </div>
          <div className={styles.scenarioList}>
            {scenarios.map((s: any) => (
              <ScenarioItem
                key={s.id}
                scenario={s}
                isActive={s.id === activeScenarioId}
                isCompared={compareScenarioIds.includes(s.id)}
                onSelect={() => setActiveScenarioId(s.id)}
                onToggleCompare={() => toggleCompareScenario(s.id)}
                onRename={(newName) => handleRenameScenario(s.id, newName)}
                onDuplicate={() => handleDuplicateScenario(s.id)}
                onDelete={() => handleDeleteScenario(s.id)}
                onExport={(e) => handleExportScenario(e, s)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
export default ScenarioManager;
