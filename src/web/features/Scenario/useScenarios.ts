import { useState, useEffect, useCallback, useRef } from 'react';
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
  const lastSavedParamsRef = useRef<Record<string, string>>({});

  // Error & Retry States
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // E2EE States
  const [localKey, setLocalKey] = useState<string | null>(null);
  const [needsKeyRestore, setNeedsKeyRestore] = useState(false);
  const [isBackupKeyBackedUp, setIsBackupKeyBackedUp] = useState(true);

  // Cloud Save States
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Initialize/Load E2EE Key
  useEffect(() => {
    const userId = (session?.user as any)?.id;
    if (status === 'authenticated' && userId) {
      const keyName = `nextlife_e2ee_key_${userId}`;
      const backupName = `nextlife_e2ee_backed_up_${userId}`;
      
      const key = localStorage.getItem(keyName);
      if (key) {
        const backedUp = localStorage.getItem(backupName) === 'true';
        setIsBackupKeyBackedUp(backedUp);
        setLocalKey(key);
      } else {
        setLocalKey(null);
      }
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
    if (status === 'unauthenticated') {
      if (!isLoaded) {
        const loaded = loadParams();
        const migrated = migrateParams(loaded || initialParams, etfTickers);
        const defaultScenario: ScenarioModel = {
          id: 'local-default',
          name: '기본 시나리오',
          isDefault: true,
          data: migrated,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        lastSavedParamsRef.current['local-default'] = JSON.stringify(migrated);
        setScenarios([defaultScenario]);
        setActiveScenarioId('local-default');
        setIsLoaded(true);
      }
    }
  }, [status, isLoaded]);

  // Fetch scenarios when logged in
  useEffect(() => {
    const userId = (session?.user as any)?.id;
    if (status === 'authenticated') {
      if (userId) {
        const storedKey = localStorage.getItem(`nextlife_e2ee_key_${userId}`);
        if (storedKey && !localKey) {
          return; // Wait for localKey state to be populated by the initialization effect
        }
      }
      setIsLoaded(false);
      setLoadError(null);

      // Helper for retrying fetches (helps with NextJS rebuild/compilation delay)
      const fetchWithRetry = async (url: string, retries = 3, delay = 1500): Promise<any> => {
        try {
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`서버 응답 오류 (HTTP ${res.status})`);
          }
          return await res.json();
        } catch (err: any) {
          if (retries > 0) {
            console.warn(`[useScenarios] Fetch failed, retrying in ${delay}ms... (${retries} left). Error:`, err);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(url, retries - 1, delay);
          }
          throw err;
        }
      };

      fetchWithRetry('/api/scenarios')
        .then(({ data }) => {
          if (data && data.length > 0) {
            const decryptAll = async () => {
              const decryptedList = [];
              let hasDecryptionFailure = false;
              const keyName = `nextlife_e2ee_key_${userId}`;
              const activeKey = localKey || (userId ? localStorage.getItem(keyName) : null);

              for (const s of data) {
                if (isEncryptedPayload(s.data)) {
                  if (activeKey && userId) {
                    try {
                      const decryptedData = await decryptData(s.data, activeKey, userId);
                      const migrated = migrateParams(decryptedData, etfTickers);
                      decryptedList.push({ ...s, data: migrated });
                      lastSavedParamsRef.current[s.id] = JSON.stringify(migrated);
                    } catch (err) {
                      console.error('Decryption failed for scenario', s.id, err);
                      hasDecryptionFailure = true;
                      decryptedList.push({ ...s, data: initialParams });
                      lastSavedParamsRef.current[s.id] = JSON.stringify(initialParams);
                    }
                  } else {
                    // No key found in local storage, but database has E2EE scenarios!
                    hasDecryptionFailure = true;
                    decryptedList.push({ ...s, data: initialParams });
                    lastSavedParamsRef.current[s.id] = JSON.stringify(initialParams);
                  }
                } else {
                  // Backwards compatibility for plain text simulation data
                  const migrated = migrateParams(s.data, etfTickers);
                  decryptedList.push({ ...s, data: migrated });
                  lastSavedParamsRef.current[s.id] = JSON.stringify(migrated);
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
            // First-time user: No scenarios exist in the database!
            // We can safely generate a brand new key for them here.
            const userId = (session?.user as any)?.id;
            if (userId) {
              const keyName = `nextlife_e2ee_key_${userId}`;
              const backupName = `nextlife_e2ee_backed_up_${userId}`;
              
              let generatedKey = localStorage.getItem(keyName);
              if (!generatedKey) {
                generatedKey = generateBackupKey();
                localStorage.setItem(keyName, generatedKey);
                localStorage.setItem(backupName, 'false');
                setIsBackupKeyBackedUp(false);
              }
              setLocalKey(generatedKey);
              
              const loaded = loadParams();
              const migrated = migrateParams(loaded || initialParams, etfTickers);
              lastSavedParamsRef.current['local-default'] = JSON.stringify(migrated);
              // Pass the newly generated key directly to handleCreateScenario to avoid race conditions
              handleCreateScenario('기본 시나리오', migrated, true, generatedKey);
            }
            setIsLoaded(true);
          }
        })
        .catch(err => {
          console.error('[useScenarios] Failed to load scenarios:', err);
          setLoadError(err.message || '시나리오 데이터를 가져오지 못했습니다.');
          setIsLoaded(true);
        });
    }
  }, [status, localKey, retryCount]);

  // Get current active params
  const activeParams = scenarios.find(s => s.id === activeScenarioId)?.data || initialParams;

  // Auto-save debounced
  useEffect(() => {
    if (needsKeyRestore) return; // Prevent overwriting encrypted server data with default values when key is missing!
    if (isLoaded && activeScenarioId) {
      const activeScenario = scenarios.find(s => s.id === activeScenarioId);
      // Only auto-save if data is not locked/encrypted payload (which would trigger decryption failure)
      if (activeScenario && !isEncryptedPayload(activeScenario.data)) {
        const currentDataStr = JSON.stringify(activeScenario.data);
        const lastSavedDataStr = lastSavedParamsRef.current[activeScenario.id];

        // Skip saving if data is identical to the last saved/loaded state
        if (currentDataStr === lastSavedDataStr) {
          return;
        }

        saveParams(activeScenario.data); // save to local storage as fallback
        
        if (status === 'authenticated' && !activeScenarioId.startsWith('local-')) {
          setSaveStatus('saving');
          setIsSaving(true);
          const timeoutId = setTimeout(async () => {
            try {
              let payloadToSave: any = activeScenario.data;
              const userId = (session?.user as any)?.id;
              if (localKey && userId) {
                payloadToSave = await encryptData(activeScenario.data, localKey, userId);
              }
              const res = await fetch(`/api/scenarios/${activeScenarioId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: payloadToSave }),
              });
              if (res.ok) {
                setSaveStatus('success');
                setLastSaved(new Date());
                lastSavedParamsRef.current[activeScenarioId] = currentDataStr;
              } else {
                setSaveStatus('error');
              }
            } catch (err) {
              console.error('Failed to save cloud data:', err);
              setSaveStatus('error');
            } finally {
              setIsSaving(false);
            }
          }, 1500);
          return () => clearTimeout(timeoutId);
        } else {
          // Unauthenticated or local scenario - saved to local storage instantly
          setSaveStatus('success');
          setLastSaved(new Date());
          lastSavedParamsRef.current[activeScenarioId] = currentDataStr;
        }
      }
    }
  }, [activeParams, isLoaded, status, activeScenarioId, scenarios, localKey, needsKeyRestore]);

  const handleUpdateActiveParams = useCallback((newParams: SimulationParams | ((prev: SimulationParams) => SimulationParams)) => {
    setScenarios(prev => prev.map(s => {
      if (s.id === activeScenarioId) {
        const nextData = typeof newParams === 'function' ? newParams(s.data) : newParams;
        return { ...s, data: nextData };
      }
      return s;
    }));
  }, [activeScenarioId]);

  const handleCreateScenario = async (name: string, data: SimulationParams, isDefault = false, overrideKey?: string) => {
    console.log('[E2EE] handleCreateScenario called:', name, 'isDefault:', isDefault, 'status:', status);
    if (!isDefault && scenarios.length >= 3) {
      alert('시나리오는 최대 3개까지만 생성할 수 있습니다.');
      return;
    }

    if (status === 'authenticated') {
      try {
        let payloadToSave: any = data;
        const keyToUse = overrideKey || localKey;
        const userId = (session?.user as any)?.id;
        if (keyToUse && userId) {
          payloadToSave = await encryptData(data, keyToUse, userId);
        }
        const res = await fetch('/api/scenarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, data: payloadToSave, isDefault }),
        });
        const { data: newScenario } = await res.json();
        if (newScenario) {
          let decryptedData = newScenario.data;
          const decryptionKey = overrideKey || localKey;
          if (isEncryptedPayload(newScenario.data) && decryptionKey && userId) {
            try {
              decryptedData = await decryptData(newScenario.data, decryptionKey, userId);
            } catch (err) {
              console.error('Failed to decrypt created scenario:', err);
            }
          }
          lastSavedParamsRef.current[newScenario.id] = JSON.stringify(decryptedData);
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
    console.log('[E2EE] handleDuplicateScenario called with ID:', id);
    const source = scenarios.find(s => s.id === id);
    console.log('[E2EE] Source scenario found:', source ? source.name : 'null');
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
      const cleanKey = enteredKey.trim().toUpperCase();
      if (cleanKey.length !== 6) {
        alert('올바른 6자리 보안 백업 키가 아닙니다.');
        return false;
      }
      const userId = (session?.user as any)?.id;
      if (!userId) return false;

      // Verify key correctness by attempting to decrypt the encrypted scenarios on the server
      try {
        const res = await fetch('/api/scenarios');
        if (!res.ok) throw new Error('Failed to fetch scenarios');
        const { data } = await res.json();
        
        if (data && data.length > 0) {
          let hasEncrypted = false;
          let decryptedSuccessfully = false;
          
          for (const s of data) {
            if (isEncryptedPayload(s.data)) {
              hasEncrypted = true;
              try {
                await decryptData(s.data, cleanKey, userId);
                decryptedSuccessfully = true;
              } catch (e) {
                // Ignore failure for individual scenario, but keep tracking if any decrypt successfully
              }
            }
          }
          
          if (hasEncrypted && !decryptedSuccessfully) {
            // If we have encrypted payloads but none decrypted successfully, the key is incorrect.
            return false;
          }
        }
      } catch (err) {
        console.error('Verification of restore key failed:', err);
        return false;
      }

      localStorage.setItem(`nextlife_e2ee_key_${userId}`, cleanKey);
      localStorage.setItem(`nextlife_e2ee_backed_up_${userId}`, 'true');
      setLocalKey(cleanKey);
      setIsBackupKeyBackedUp(true);
      setNeedsKeyRestore(false);
      setIsLoaded(false); // will trigger refetching
      return true;
    },
    loadError,
    handleRetryLoad: () => {
      setRetryCount(prev => prev + 1);
    },
    isSaving,
    saveStatus,
    lastSaved,
    handleAcknowledgeBackup: () => {
      const userId = (session?.user as any)?.id;
      if (userId) {
        localStorage.setItem(`nextlife_e2ee_backed_up_${userId}`, 'true');
        setIsBackupKeyBackedUp(true);
      }
    }
  };
}
