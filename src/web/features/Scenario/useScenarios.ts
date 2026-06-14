import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { SimulationParams, ScenarioModel } from '../../../core/entities/types';
import { loadParams, saveParams, initialParams } from '../../../infrastructure/storage/localStore';

export function useScenarios() {
  const { status } = useSession();
  const [scenarios, setScenarios] = useState<ScenarioModel[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [compareScenarioIds, setCompareScenarioIds] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Helper to generate a local mock scenario ID
  const generateId = () => Math.random().toString(36).substr(2, 9);

  // Initialize from local storage if not logged in
  useEffect(() => {
    if (status === 'unauthenticated' || status === 'loading') {
      if (!isLoaded) {
        const loaded = loadParams();
        const defaultScenario: ScenarioModel = {
          id: 'local-default',
          name: '기본 시나리오',
          isDefault: true,
          data: loaded || initialParams,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setScenarios([defaultScenario]);
        setActiveScenarioId('local-default');
        setIsLoaded(true);
      }
    }
  }, [status, isLoaded]);

  // Fetch scenarios when logged in
  useEffect(() => {
    if (status === 'authenticated') {
      fetch('/api/scenarios')
        .then(res => {
          if (!res.ok) throw new Error('Failed to fetch scenarios');
          return res.json();
        })
        .then(({ data }) => {
          if (data && data.length > 0) {
            setScenarios(data);
            if (!activeScenarioId || !data.find((s: ScenarioModel) => s.id === activeScenarioId)) {
              setActiveScenarioId(data[0].id);
            }
          } else {
            // No scenarios yet, create a default one based on local storage
            const loaded = loadParams();
            handleCreateScenario('기본 시나리오', loaded || initialParams, true);
          }
          setIsLoaded(true);
        })
        .catch(err => console.error(err));
    }
  }, [status]);

  // Get current active params
  const activeParams = scenarios.find(s => s.id === activeScenarioId)?.data || initialParams;

  // Auto-save debounced
  useEffect(() => {
    if (isLoaded && activeScenarioId) {
      const activeScenario = scenarios.find(s => s.id === activeScenarioId);
      if (activeScenario) {
        saveParams(activeScenario.data); // save to local storage as fallback
        
        if (status === 'authenticated' && !activeScenarioId.startsWith('local-')) {
          const timeoutId = setTimeout(() => {
            fetch(`/api/scenarios/${activeScenarioId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: activeScenario.data }),
            }).catch(err => console.error('Failed to save cloud data:', err));
          }, 1500);
          return () => clearTimeout(timeoutId);
        }
      }
    }
  }, [activeParams, isLoaded, status, activeScenarioId, scenarios]);

  const handleUpdateActiveParams = useCallback((newParams: SimulationParams | ((prev: SimulationParams) => SimulationParams)) => {
    setScenarios(prev => prev.map(s => {
      if (s.id === activeScenarioId) {
        const nextData = typeof newParams === 'function' ? newParams(s.data) : newParams;
        return { ...s, data: nextData };
      }
      return s;
    }));
  }, [activeScenarioId]);

  const handleCreateScenario = async (name: string, data: SimulationParams, isDefault = false) => {
    if (status === 'authenticated') {
      try {
        const res = await fetch('/api/scenarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, data, isDefault }),
        });
        const { data: newScenario } = await res.json();
        if (newScenario) {
          setScenarios(prev => [...prev, newScenario]);
          setActiveScenarioId(newScenario.id);
        }
      } catch (err) {
        console.error('Failed to create scenario:', err);
      }
    } else {
      const newId = 'local-' + generateId();
      const newScenario: ScenarioModel = {
        id: newId,
        name,
        isDefault,
        data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setScenarios(prev => [...prev, newScenario]);
      setActiveScenarioId(newId);
    }
  };

  const handleDuplicateScenario = (id: string) => {
    const source = scenarios.find(s => s.id === id);
    if (source) {
      handleCreateScenario(`${source.name} (복사본)`, source.data);
    }
  };

  const handleDeleteScenario = async (id: string) => {
    const target = scenarios.find(s => s.id === id);
    if (!target) return;
    if (target.isDefault) {
      alert('기본 시나리오는 삭제할 수 없습니다.');
      return;
    }

    if (status === 'authenticated' && !id.startsWith('local-')) {
      try {
        const res = await fetch(`/api/scenarios/${id}`, { method: 'DELETE' });
        if (res.ok) {
          setScenarios(prev => prev.filter(s => s.id !== id));
          if (activeScenarioId === id) setActiveScenarioId(scenarios[0].id);
          setCompareScenarioIds(prev => prev.filter(compId => compId !== id));
        }
      } catch (err) {
        console.error('Failed to delete scenario:', err);
      }
    } else {
      setScenarios(prev => prev.filter(s => s.id !== id));
      if (activeScenarioId === id) setActiveScenarioId(scenarios[0].id);
      setCompareScenarioIds(prev => prev.filter(compId => compId !== id));
    }
  };

  const handleRenameScenario = async (id: string, newName: string) => {
    setScenarios(prev => prev.map(s => s.id === id ? { ...s, name: newName } : s));
    if (status === 'authenticated' && !id.startsWith('local-')) {
      try {
        await fetch(`/api/scenarios/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName }),
        });
      } catch (err) {
        console.error('Failed to rename scenario:', err);
      }
    }
  };

  const toggleCompareScenario = (id: string) => {
    setCompareScenarioIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(compId => compId !== id);
      } else {
        if (prev.length >= 3) {
          alert('비교 시나리오는 최대 3개까지만 추가할 수 있습니다.');
          return prev;
        }
        return [...prev, id];
      }
    });
  };

  return {
    scenarios,
    activeScenarioId,
    setActiveScenarioId,
    compareScenarioIds,
    toggleCompareScenario,
    activeParams,
    handleUpdateActiveParams,
    handleCreateScenario,
    handleDuplicateScenario,
    handleDeleteScenario,
    handleRenameScenario,
    isLoaded,
  };
}
