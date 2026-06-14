import React, { useState } from 'react';
import styles from './Scenario.module.css';
import { FolderGit2, ChevronDown, ChevronUp, Copy, Trash2, Edit2, CheckSquare, Square } from 'lucide-react';
import compStyles from '../../styles/components.module.css';

export const ScenarioManager: React.FC<{ scenarioState: any }> = ({ scenarioState }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const {
    scenarios,
    activeScenarioId,
    setActiveScenarioId,
    compareScenarioIds,
    toggleCompareScenario,
    handleDuplicateScenario,
    handleDeleteScenario,
    handleRenameScenario
  } = scenarioState;

  return (
    <div className={styles.container}>
      <div 
        className={styles.header}
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FolderGit2 size={18} className={styles.icon} />
          <span className={styles.title}>시나리오 관리</span>
        </div>
        {isExpanded ? <ChevronUp size={18} className={styles.icon} /> : <ChevronDown size={18} className={styles.icon} />}
      </div>

      {isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
          <label className={compStyles.label} style={{ marginBottom: '0.25rem' }}>내 시나리오 목록</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {scenarios.map((s: any) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', background: s.id === activeScenarioId ? 'rgba(59, 130, 246, 0.15)' : 'rgba(0,0,0,0.2)', borderRadius: '12px', border: s.id === activeScenarioId ? '1px solid var(--primary)' : '1px solid var(--card-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, cursor: 'pointer' }} onClick={() => setActiveScenarioId(s.id)}>
                  <span style={{ fontWeight: s.id === activeScenarioId ? 600 : 400, color: s.id === activeScenarioId ? 'var(--primary)' : 'var(--foreground)' }}>
                    {s.name} {s.isDefault && <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'var(--card-bg)', borderRadius: '4px', border: '1px solid var(--card-border)', marginLeft: '4px' }}>기본</span>}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button 
                    onClick={() => toggleCompareScenario(s.id)}
                    style={{ background: 'none', border: 'none', color: compareScenarioIds.includes(s.id) ? 'var(--accent)' : 'var(--foreground-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem' }}
                    title="비교 차트에 표시"
                  >
                    {compareScenarioIds.includes(s.id) ? <CheckSquare size={16} /> : <Square size={16} />} 비교
                  </button>
                  <button onClick={() => {
                    const newName = prompt('새로운 시나리오 이름을 입력하세요', s.name);
                    if (newName) handleRenameScenario(s.id, newName);
                  }} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer' }} title="이름 변경"><Edit2 size={16} /></button>
                  <button onClick={() => handleDuplicateScenario(s.id)} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer' }} title="복제"><Copy size={16} /></button>
                  {!s.isDefault && (
                    <button onClick={() => confirm('이 시나리오를 삭제하시겠습니까?') && handleDeleteScenario(s.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }} title="삭제"><Trash2 size={16} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
export default ScenarioManager;
