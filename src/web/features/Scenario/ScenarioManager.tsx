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
          <label className={compStyles.label} style={{ marginBottom: '0.25rem' }}>내 시나리오 목록</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {scenarios.map((s: any) => (
              <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.75rem', background: s.id === activeScenarioId ? 'rgba(59, 130, 246, 0.15)' : 'rgba(0,0,0,0.2)', borderRadius: '12px', border: s.id === activeScenarioId ? '1px solid var(--primary)' : '1px solid var(--card-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', minWidth: 0, flex: 1, paddingRight: '8px' }} onClick={() => setActiveScenarioId(s.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: s.id === activeScenarioId ? 600 : 400, color: s.id === activeScenarioId ? 'var(--primary)' : 'var(--foreground)', overflow: 'hidden', width: '100%' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                      {s.isDefault && <span style={{ flexShrink: 0, whiteSpace: 'nowrap', fontSize: '0.7rem', padding: '2px 6px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 500 }}>기본</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '-0.25rem' }}>
                  <button 
                    onClick={() => toggleCompareScenario(s.id)}
                    style={{ background: 'none', border: 'none', color: compareScenarioIds.includes(s.id) ? 'var(--accent)' : 'var(--foreground-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', padding: '4px', flexShrink: 0 }}
                    title="비교 차트에 표시"
                  >
                    {compareScenarioIds.includes(s.id) ? <CheckSquare size={16} /> : <Square size={16} />} <span style={{ whiteSpace: 'nowrap' }}>비교</span>
                  </button>
                  <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                    <button onClick={() => {
                      const newName = prompt('새로운 시나리오 이름을 입력하세요', s.name);
                      if (newName) handleRenameScenario(s.id, newName);
                    }} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer', padding: '4px' }} title="이름 변경"><Edit2 size={16} /></button>
                    <button onClick={() => handleDuplicateScenario(s.id)} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer', padding: '4px' }} title="복제"><Copy size={16} /></button>
                    {!s.isDefault && (
                      <button onClick={() => confirm('이 시나리오를 삭제하시겠습니까?') && handleDeleteScenario(s.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '4px' }} title="삭제"><Trash2 size={16} /></button>
                    )}
                  </div>
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
