import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { SimulationParams, ScenarioModel } from '../../../core/entities/types';
import { loadParams, saveParams, initialParams } from '../../../infrastructure/storage/localStore';
import { generateBackupKey, encryptData, decryptData, isEncryptedPayload } from '../../../core/utils/crypto';

const migrateParams = (params: SimulationParams, tickers: string[]): SimulationParams => {
  if (!params.assets) return params;
  let changed = false;
  const migratedAssets = params.assets.map(asset => {
    if (asset.type === 'etf' && tickers.includes(asset.ticker) && asset.name !== asset.ticker) {
      changed = true;
      return { ...asset, name: asset.ticker };
    }
    return asset;
  });
  return changed ? { ...params, assets: migratedAssets } : params;
};

export function useScenarios() {
  const { data: session, status } = useSession();
  const [scenarios, setScenarios] = useState<ScenarioModel[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [compareScenarioIds, setCompareScenarioIds] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [etfTickers, setEtfTickers] = useState<string[]>(['VOO', 'QQQ', 'SCHD', 'SPY', 'JEPI', 'TLT', 'VNQ', 'SPLG']);

  // E2EE States
  const [localKey, setLocalKey] = useState<string | null>(null);
  const [needsKeyRestore, setNeedsKeyRestore] = useState(false);
  const [isBackupKeyBackedUp, setIsBackupKeyBackedUp] = useState(true);

  // Initialize/Load E2EE Key
  useEffect(() => {
    if (status === 'authenticated' && session?.user?.email) {
      const email = session.user.email;
      const keyName = `nextlife_e2ee_key_${email}`;
      const backupName = `nextlife_e2ee_backed_up_${email}`;
      
      let key = localStorage.getItem(keyName);
      if (!key) {
        // Automatically generate a new key if not exists
        key = generateBackupKey();
        localStorage.setItem(keyName, key);
        localStorage.setItem(backupName, 'false'); // Not backed up yet
        setIsBackupKeyBackedUp(false);
      } else {
        const backedUp = localStorage.getItem(backupName) === 'true';
        setIsBackupKeyBackedUp(backedUp);
      }
      setLocalKey(key);
    } else {
      setLocalKey(null);
      setNeedsKeyRestore(false);
    }
  }, [status, session]);

  // Fetch dynamic ETF tickers from API
  useEffect(() => {
    fetch('/api/etfs')
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data) {
          setEtfTickers(prev => Array.from(new Set([...prev, ...json.data])));
        }
      })
      .catch(err => console.error('Failed to load dynamic ETF tickers:', err));
  }, []);

  // Run migration again if ETF tickers list expands
  useEffect(() => {
    if (isLoaded && scenarios.length > 0 && etfTickers.length > 10) {
      let changedAny = false;
      const updated = scenarios.map(s => {
        const migrated = migrateParams(s.data, etfTickers);
        if (migrated !== s.data) {
          changedAny = true;
          return { ...s, data: migrated };
        }
        return s;
      });
      if (changedAny) {
        setScenarios(updated);
      }
    }
  }, [etfTickers, isLoaded]); // Omitting scenarios to prevent infinite loops, only run when etfTickers load

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
          data: migrateParams(loaded || initialParams, etfTickers),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setScenarios([defaultScenario]);
        setActiveScenarioId('local-default');
        setIsLoaded(true);
      }
    }
  }, [status, isLoaded]);

  // Fetch scenarios when logged in (depends on localKey to ensure we can decrypt)
  useEffect(() => {
    if (status === 'authenticated' && localKey) {
      setIsLoaded(false);
      fetch('/api/scenarios')
        .then(res => {
          if (!res.ok) throw new Error('Failed to fetch scenarios');
          return res.json();
        })
        .then(({ data }) => {
          if (data && data.length > 0) {
            const decryptAll = async () => {
              const decryptedList = [];
              let hasDecryptionFailure = false;
              for (const s of data) {
                if (isEncryptedPayload(s.data)) {
                  try {
                    const decryptedData = await decryptData(s.data, localKey);
                    decryptedList.push({ ...s, data: migrateParams(decryptedData, etfTickers) });
                  } catch (err) {
                    console.error('Decryption failed for scenario', s.id, err);
                    hasDecryptionFailure = true;
                    // Store the encrypted payload directly in the state, so if they fix the key, we can retry
                    decryptedList.push(s);
                  }
                } else {
                  // Backwards compatibility for plain text simulation data
                  decryptedList.push({ ...s, data: migrateParams(s.data, etfTickers) });
                }
              }
              setScenarios(decryptedList);
              setNeedsKeyRestore(hasDecryptionFailure);
              
              if (!activeScenarioId || !decryptedList.find((s: ScenarioModel) => s.id === activeScenarioId)) {
                setActiveScenarioId(decryptedList[0].id);
              }
              setIsLoaded(true);
            };
            decryptAll();
          } else {
            // No scenarios yet, create a default one based on local storage
            const loaded = loadParams();
            handleCreateScenario('기본 시나리오', migrateParams(loaded || initialParams, etfTickers), true);
            setIsLoaded(true);
          }
        })
        .catch(err => {
          console.error(err);
          if (!isLoaded) {
            const loaded = loadParams();
            const defaultScenario: ScenarioModel = {
              id: 'local-default',
              name: '기본 시나리오',
              isDefault: true,
              data: migrateParams(loaded || initialParams, etfTickers),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            setScenarios([defaultScenario]);
            setActiveScenarioId('local-default');
            setIsLoaded(true);
          }
        });
    }
  }, [status, localKey, etfTickers]);

  // Get current active params
  const activeParams = scenarios.find(s => s.id === activeScenarioId)?.data || initialParams;

  // Auto-save debounced
  useEffect(() => {
    if (isLoaded && activeScenarioId) {
      const activeScenario = scenarios.find(s => s.id === activeScenarioId);
      // Only auto-save if data is not locked/encrypted payload (which would trigger decryption failure)
      if (activeScenario && !isEncryptedPayload(activeScenario.data)) {
        saveParams(activeScenario.data); // save to local storage as fallback
        
        if (status === 'authenticated' && !activeScenarioId.startsWith('local-')) {
          const timeoutId = setTimeout(async () => {
            try {
              let payloadToSave: any = activeScenario.data;
              if (localKey) {
                payloadToSave = await encryptData(activeScenario.data, localKey);
              }
              await fetch(`/api/scenarios/${activeScenarioId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: payloadToSave }),
              });
            } catch (err) {
              console.error('Failed to save cloud data:', err);
            }
          }, 1500);
          return () => clearTimeout(timeoutId);
        }
      }
    }
  }, [activeParams, isLoaded, status, activeScenarioId, scenarios, localKey]);

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
    if (!isDefault && scenarios.length >= 3) {
      alert('시나리오는 최대 3개까지만 생성할 수 있습니다.');
      return;
    }

    if (status === 'authenticated') {
      try {
        let payloadToSave: any = data;
        if (localKey) {
          payloadToSave = await encryptData(data, localKey);
        }
        const res = await fetch('/api/scenarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, data: payloadToSave, isDefault }),
        });
        const { data: newScenario } = await res.json();
        if (newScenario) {
          let decryptedData = newScenario.data;
          if (isEncryptedPayload(newScenario.data) && localKey) {
            try {
              decryptedData = await decryptData(newScenario.data, localKey);
            } catch (err) {
              console.error('Failed to decrypt created scenario:', err);
            }
          }
          setScenarios(prev => [...prev, { ...newScenario, data: decryptedData }]);
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
      // Deep copy to prevent reference sharing in state
      const clonedData = JSON.parse(JSON.stringify(source.data));
      handleCreateScenario(`${source.name} (복사본)`, clonedData);
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
    localKey,
    needsKeyRestore,
    isBackupKeyBackedUp,
    handleRestoreKey: async (enteredKey: string) => {
      const cleanKey = enteredKey.replace(/[^0-9a-fA-F]/g, '');
      if (cleanKey.length !== 64) {
        alert('올바른 64자리 16진수 보안 백업 키가 아닙니다.');
        return false;
      }
      if (session?.user?.email) {
        const email = session.user.email;
        localStorage.setItem(`nextlife_e2ee_key_${email}`, cleanKey);
        localStorage.setItem(`nextlife_e2ee_backed_up_${email}`, 'true');
        setLocalKey(cleanKey);
        setIsBackupKeyBackedUp(true);
        setNeedsKeyRestore(false);
        setIsLoaded(false); // will trigger refetching
        return true;
      }
      return false;
    },
    handleAcknowledgeBackup: () => {
      if (session?.user?.email) {
        localStorage.setItem(`nextlife_e2ee_backed_up_${session.user.email}`, 'true');
        setIsBackupKeyBackedUp(true);
      }
    }
  };
}
