import React, { useState, useRef, useCallback } from 'react';
import { SimulationParams, InvestmentAsset, PrivatePension, OtherIncome, AssetCurrency, IsaAccount } from '../../../core/entities/types';
import { InputField } from '../../components/InputField';
import { AmountField } from '../../components/fields/AmountField';
import { NumberField } from '../../components/fields/NumberField';
import { SelectField } from '../../components/SelectField';
import styles from './AssetForm.module.css';
import compStyles from '../../styles/components.module.css';
import { Plus, Trash2, Wallet, Landmark, PiggyBank, DollarSign, ExternalLink, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { predefinedAssets } from './predefinedAssets';
import { ReturnBreakdownHint } from './ReturnBreakdownHint';
import { YieldPresetHelper } from './YieldPresetHelper';
import { initialParams } from '../../../infrastructure/storage/localStore';
import { resolveStrategy } from '../../../core/usecases/strategy/compileStrategy';
import {
  convertContributionAmount,
  roundContributionForCurrency,
  toMonthlyContribution,
  type ContributionPeriod,
} from '../../../core/domain/input/contributionPeriod';

// /api/stock-search가 돌려주는 항목 중 이 화면이 쓰는 필드. 자동완성 목록을 predefinedAssets와
// 같은 모양으로 합치기 위해 필요한 것만 선언한다.
interface StockSuggestion {
  ticker: string;
  name: string;
  // 자산 폼이 그대로 InvestmentAsset에 넣으므로 도메인 유니온과 같은 폭이어야 한다.
  // 넓은 string으로 두면 여기서는 통과하고 자산을 만들 때 어긋난다.
  type: 'stock' | 'etf';
  currency: AssetCurrency;
  exchDisp?: string;
}

// 새로 추가하는 항목의 id.
//
// 예전에는 컴포넌트 안에서 `asset-${Date.now()}`로 만들었다. 두 가지가 문제였다.
// 카운터는 같은 밀리초에 두 번 추가할 때의 id 충돌(React key 충돌)을 없앤다.
// purity 검사를 벗어난 것은 카운터가 아니라 이 함수를 컴포넌트 밖으로 옮긴 덕이다 —
// Date.now()는 여전히 호출되므로 렌더 경로에서 부르면 안 된다.
let entitySequence = 0;

function createEntityId(prefix: 'asset' | 'pension' | 'isa' | 'income'): string {
  entitySequence += 1;
  return `${prefix}-${Date.now()}-${entitySequence}`;
}

interface AssetFormSectionProps {
  params: SimulationParams;
  // updater 형태를 함께 받는다. 실제 구현(useScenarios의 handleUpdateActiveParams)이 이미
  // 둘 다 받는데 여기 타입만 좁게 선언돼 있어서, 호출부마다 `as any`로 뚫고 쓰고 있었다.
  // 이 화면은 연속 편집이 잦아 updater가 필요하다 — 값을 넘기면 직전 상태를 덮어쓴다.
  onChangeParams: (
    newParams: SimulationParams | ((prev: SimulationParams) => SimulationParams)
  ) => void;
}

type TabType = 'stocks' | 'pensions' | 'isa' | 'other';

export const AssetFormSection: React.FC<AssetFormSectionProps> = ({ params: rawParams, onChangeParams }) => {
  const params: SimulationParams = {
    ...rawParams,
    // 폴백은 앱이 새 시나리오에 넣는 값(initialParams)과 같아야 한다. 여기에 리터럴을
    // 적어 두면 같은 "기본 프로필"의 정의가 둘이 되고, 둘이 조용히 어긋난다.
    userProfile: rawParams?.userProfile || initialParams.userProfile,
    assets: rawParams?.assets || [],
    nationalPension: rawParams?.nationalPension || { expectedMonthlyAmount: 0 },
    privatePensions: rawParams?.privatePensions || [],
    isaAccounts: rawParams?.isaAccounts || [],
    otherIncomes: rawParams?.otherIncomes || [],
    inflationRate: rawParams?.inflationRate ?? 2,
    inflationMode: rawParams?.inflationMode || 'real',
    baseExchangeRate: rawParams?.baseExchangeRate ?? 1350,
    displayCurrency: rawParams?.displayCurrency || 'KRW',
    spendingStrategy: rawParams?.spendingStrategy || 'target',
  };
  const strategy = resolveStrategy(params);

  // 목표 기반 흐름에서 이 화면은 「내 자산이 이렇다」는 사실을 받는 자리다. 재투자 여부는
  // 사실이 아니라 인출 전략의 결정이며(배당을 그해 생활비로 쓸 것인가, 남겨서 나중에 팔
  // 것인가), 그 결정은 「연금 전략」의 배당금 재투자 축이 담당한다 — 기본값은 AI가 자산마다
  // 판단해 개선이 확인된 것만 계산에 반영하는 「자동으로 선택」이다.
  // 전문가만 그 기준선을 자산별로 손으로 정한다.
  const dividendStrategy = strategy.dividendStrategy ?? 'ai_optimized';
  const showPerAssetDividend = strategy.mode === 'expert';
  // 「전부 재투자」·「전부 현금 수령」을 고르면 compileStrategy가 전 자산을 그 값으로 덮어쓴다.
  // 잠그지 않으면 여기서 고친 값이 화면에만 남고 엔진은 전략이 정한 값으로 돈다.
  const dividendGoverned = dividendStrategy !== 'ai_optimized';

  const [activeTab, setActiveTab] = useState<TabType>('stocks');
  const [expandedAssets, setExpandedAssets] = useState<Record<string, boolean>>({});
  const [expandedPensions, setExpandedPensions] = useState<Record<string, boolean>>({});
  const [expandedIsa, setExpandedIsa] = useState<Record<string, boolean>>({});
  const [fetchingPriceMap, setFetchingPriceMap] = useState<Record<string, boolean>>({});
  const [fetchingInfoMap, setFetchingInfoMap] = useState<Record<string, boolean>>({});
  const [focusedAssetId, setFocusedAssetId] = useState<string | null>(null);
  const [realtimeSuggestions, setRealtimeSuggestions] = useState<Record<string, StockSuggestion[]>>({});
  const [isSearching, setIsSearching] = useState<Record<string, boolean>>({});
  const [autocompleteIndex, setAutocompleteIndex] = useState<number>(-1);

  const searchTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});
  const isSelectingRef = useRef<Record<string, boolean>>({});

  const getCombinedOptions = useCallback((id: string, name: string | undefined) => {
    if (!name) return [];
    const matchingPredefined = predefinedAssets.filter(pa => 
      pa.name.toLowerCase().includes(name.toLowerCase()) ||
      pa.ticker.toLowerCase().includes(name.toLowerCase())
    );
    const rsList = realtimeSuggestions[id] || [];
    const predefinedTickers = new Set(matchingPredefined.map(p => p.ticker));
    const additionalRealtime = rsList
      .filter((rs) => !predefinedTickers.has(rs.ticker))
      .map((rs) => ({
        ...rs,
        // 예전 성장률 7.0/6.0 + 배당 1.5/1.0 (총수익률 표기로 이관)
        totalReturn: rs.type === 'etf' ? 8.5 : 7.0,
        dividendYield: rs.type === 'etf' ? 1.5 : 1.0,
      }));
    return [...matchingPredefined, ...additionalRealtime].slice(0, 8);
  }, [realtimeSuggestions]);


  const fetchRealtimeSuggestions = useCallback(async (id: string, query: string) => {
    if (!query || query.length < 1) {
      setRealtimeSuggestions(prev => ({ ...prev, [id]: [] }));
      setIsSearching(prev => ({ ...prev, [id]: false }));
      return;
    }
    setIsSearching(prev => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/stock-search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.results) {
        setRealtimeSuggestions(prev => ({ ...prev, [id]: data.results }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(prev => ({ ...prev, [id]: false }));
    }
  }, []);

  const fetchAssetPrice = async (id: string, ticker: string) => {
    if (!ticker || ticker === 'NEW') return;
    setFetchingPriceMap((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/stock-price?ticker=${encodeURIComponent(ticker)}`);
      if (!res.ok) {
        throw new Error('단가 조회에 실패했습니다.');
      }
      const data = await res.json();
      if (typeof data.price === 'number') {
        onChangeParams((prevParams: SimulationParams) => {
          const updated = prevParams.assets.map((asset) => {
            if (asset.id === id) {
              let fetchedPrice = data.price;
              const fetchedCurrency = data.currency || 'USD';
              
              if (fetchedCurrency === 'USD' && asset.currency === 'KRW') {
                fetchedPrice = Math.round(fetchedPrice * prevParams.baseExchangeRate);
              } else if (fetchedCurrency === 'KRW' && asset.currency === 'USD') {
                fetchedPrice = Math.round((fetchedPrice / prevParams.baseExchangeRate) * 100) / 100;
              }
              return { ...asset, averagePrice: fetchedPrice };
            }
            return asset;
          });
          return { ...prevParams, assets: updated };
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setFetchingPriceMap((prev) => ({ ...prev, [id]: false }));
    }
  };

  const fetchAssetInfo = async (id: string, ticker: string) => {
    if (!ticker || ticker === 'NEW') return;
    setFetchingInfoMap((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/stock-info?ticker=${encodeURIComponent(ticker)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.totalReturn !== undefined || data.dividendYield !== undefined) {
          onChangeParams((prevParams: SimulationParams) => {
            const updated = prevParams.assets.map((asset) => {
              if (asset.id === id) {
                return {
                  ...asset,
                  ...(data.totalReturn !== undefined && { totalReturn: data.totalReturn }),
                  ...(data.dividendYield !== undefined && { dividendYield: data.dividendYield }),
                };
              }
              return asset;
            });
            return { ...prevParams, assets: updated, yieldPreset: 'custom' };
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch asset info:', err);
    } finally {
      setFetchingInfoMap((prev) => ({ ...prev, [id]: false }));
    }
  };

  const fetchPensionInfo = async (id: string, ticker: string) => {
    if (!ticker) return;
    setFetchingInfoMap((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/stock-info?ticker=${encodeURIComponent(ticker)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.totalReturn !== undefined || data.dividendYield !== undefined) {
          const fetchedTotalReturn = data.totalReturn || 0;
          const fetchedDividendYield = data.dividendYield || 0;

          onChangeParams((prevParams: SimulationParams) => {
            const updated = prevParams.privatePensions.map((p) => {
              if (p.id === id) {
                return { ...p, totalReturn: fetchedTotalReturn, dividendYield: fetchedDividendYield };
              }
              return p;
            });
            return { ...prevParams, privatePensions: updated, yieldPreset: 'custom' };
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch pension info:', err);
    } finally {
      setFetchingInfoMap((prev) => ({ ...prev, [id]: false }));
    }
  };

  const fetchIsaInfo = async (id: string, ticker: string) => {
    if (!ticker) return;
    setFetchingInfoMap((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/stock-info?ticker=${encodeURIComponent(ticker)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.totalReturn !== undefined || data.dividendYield !== undefined) {
          const fetchedTotalReturn = data.totalReturn || 0;
          const fetchedDividendYield = data.dividendYield || 0;

          onChangeParams((prevParams: SimulationParams) => {
            const updated = (prevParams.isaAccounts || []).map((isa) => {
              if (isa.id === id) {
                return { ...isa, totalReturn: fetchedTotalReturn, dividendYield: fetchedDividendYield };
              }
              return isa;
            });
            return { ...prevParams, isaAccounts: updated, yieldPreset: 'custom' };
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch isa info:', err);
    } finally {
      setFetchingInfoMap((prev) => ({ ...prev, [id]: false }));
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedAssets((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const togglePensionExpand = (id: string) => {
    setExpandedPensions((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const toggleIsaExpand = (id: string) => {
    setExpandedIsa((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // 인적사항(나이·생활비·상속 목표)은 좌측 "내 은퇴 전략" 패널의 「기본 정보」·「은퇴 목표」가
  // 담당한다. 이 컴포넌트는 보유 자산 입력에만 집중한다.

  // 1. National Pension update
  const handleNationalPensionChange = (value: number) => {
    onChangeParams({
      ...params,
      nationalPension: {
        expectedMonthlyAmount: value,
      },
    });
  };

  // 3. Investment Assets actions
  const handleAddCustomAsset = () => {
    const newId = createEntityId('asset');
    
    const newAsset: InvestmentAsset = {
      id: newId,
      type: 'etf',
      ticker: 'NEW',
      name: '신규 자산',
      quantity: 0,
      averagePrice: 0,
      totalReturn: 8, // 예전 성장률 6 + 배당 2 (총수익률 표기로 이관)
      dividendYield: 2,
      contributionPeriod: 'daily',
      contributionAmount: 0,
      monthlyContribution: 0,
      reinvestDividend: true,
      currency: 'USD',
    };
    onChangeParams({
      ...params,
      assets: [...params.assets, newAsset],
      yieldPreset: 'custom',
    });
    setExpandedAssets((prev) => ({ ...prev, [newId]: true }));
  };


  const handleUpdateAsset = (id: string, updates: Partial<InvestmentAsset> | keyof InvestmentAsset, value?: InvestmentAsset[keyof InvestmentAsset]) => {
    onChangeParams((prevParams: SimulationParams) => {
      const updated = prevParams.assets.map((asset) => {
        if (asset.id === id) {
          if (typeof updates === 'string') {
            const key = updates as keyof InvestmentAsset;
            if (key === 'currency') {
              const prevCurrency = asset.currency;
              const nextCurrency = value as AssetCurrency;
              if (prevCurrency !== nextCurrency) {
                let averagePrice = asset.averagePrice;
                let monthlyContribution = asset.monthlyContribution;
                let contributionAmount = asset.contributionAmount ?? asset.monthlyContribution;
                if (prevCurrency === 'USD' && nextCurrency === 'KRW') {
                  averagePrice = Math.round(averagePrice * prevParams.baseExchangeRate);
                  monthlyContribution = Math.round(monthlyContribution * prevParams.baseExchangeRate);
                  contributionAmount = Math.round(contributionAmount * prevParams.baseExchangeRate);
                } else if (prevCurrency === 'KRW' && nextCurrency === 'USD') {
                  averagePrice = Math.round((averagePrice / prevParams.baseExchangeRate) * 100) / 100;
                  monthlyContribution = Math.round((monthlyContribution / prevParams.baseExchangeRate) * 100) / 100;
                  contributionAmount = Math.round((contributionAmount / prevParams.baseExchangeRate) * 100) / 100;
                }
                return {
                  ...asset,
                  currency: nextCurrency,
                  averagePrice,
                  monthlyContribution,
                  contributionAmount,
                  contributionPeriod: asset.contributionPeriod ?? 'monthly',
                };
              }
            }
            return { ...asset, [key]: value };
          } else {
            return { ...asset, ...updates };
          }
        }
        return asset;
      });
      const isGrowthRateChanged = typeof updates === 'string'
        ? updates === 'totalReturn'
        : 'totalReturn' in updates;
      const presetUpdate = isGrowthRateChanged ? { yieldPreset: 'custom' as const } : {};
      return { ...prevParams, assets: updated, ...presetUpdate };
    });
  };

  const handleDeleteAsset = (id: string) => {
    onChangeParams({
      ...params,
      assets: params.assets.filter((asset) => asset.id !== id),
      yieldPreset: 'custom',
    });
  };

  // 4. Private Pension actions
  const handleAddPrivatePension = () => {
    const newPension: PrivatePension = {
      id: createEntityId('pension'),
      type: 'irp',
      investmentType: 'custom',
      balance: 0,
      monthlyContribution: 0,
      totalReturn: 5,
      currency: 'KRW',
    };
    onChangeParams({
      ...params,
      privatePensions: [...params.privatePensions, newPension],
      yieldPreset: 'custom',
    });
  };

  const handleUpdatePrivatePension = (id: string, updates: Partial<PrivatePension> | keyof PrivatePension, value?: PrivatePension[keyof PrivatePension]) => {
    onChangeParams((prevParams: SimulationParams) => {
      const updated = prevParams.privatePensions.map((p) => {
        if (p.id === id) {
          if (typeof updates === 'string') {
            const key = updates as keyof PrivatePension;
            if (key === 'currency') {
              const prevCurrency = p.currency;
              const nextCurrency = value as AssetCurrency;
              if (prevCurrency !== nextCurrency) {
                let balance = p.balance;
                let monthlyContribution = p.monthlyContribution;
                if (prevCurrency === 'USD' && nextCurrency === 'KRW') {
                  balance = Math.round(balance * prevParams.baseExchangeRate);
                  monthlyContribution = Math.round(monthlyContribution * prevParams.baseExchangeRate);
                } else if (prevCurrency === 'KRW' && nextCurrency === 'USD') {
                  balance = Math.round((balance / prevParams.baseExchangeRate) * 100) / 100;
                  monthlyContribution = Math.round((monthlyContribution / prevParams.baseExchangeRate) * 100) / 100;
                }
                return { ...p, currency: nextCurrency, balance, monthlyContribution };
              }
            }
            return { ...p, [key]: value };
          } else {
            return { ...p, ...updates };
          }
        }
        return p;
      });
      const isReturnChanged = typeof updates === 'string'
        ? updates === 'totalReturn'
        : 'totalReturn' in updates;
      const presetUpdate = isReturnChanged ? { yieldPreset: 'custom' as const } : {};
      return { ...prevParams, privatePensions: updated, ...presetUpdate };
    });
  };

  const handleDeletePrivatePension = (id: string) => {
    onChangeParams({
      ...params,
      privatePensions: params.privatePensions.filter((p) => p.id !== id),
      yieldPreset: 'custom',
    });
  };

  // 4-1. ISA Account actions
  const handleAddIsaAccount = () => {
    const newIsa: IsaAccount = {
      id: createEntityId('isa'),
      type: 'general',
      investmentType: 'custom',
      balance: 0,
      monthlyContribution: 0,
      totalReturn: 6.5, // 예전 성장률 5 + 배당 1.5 (총수익률 표기로 이관)
      dividendYield: 1.5,
      currency: 'KRW',
      maturityYears: 3,
    };
    onChangeParams({
      ...params,
      isaAccounts: [...(params.isaAccounts || []), newIsa],
    });
  };

  const handleUpdateIsaAccount = (id: string, updates: Partial<IsaAccount> | keyof IsaAccount, value?: IsaAccount[keyof IsaAccount]) => {
    onChangeParams((prevParams: SimulationParams) => {
      const updated = (prevParams.isaAccounts || []).map((isa) => {
        if (isa.id === id) {
          if (typeof updates === 'string') {
            return { ...isa, [updates]: value };
          } else {
            return { ...isa, ...updates };
          }
        }
        return isa;
      });
      return { ...prevParams, isaAccounts: updated };
    });
  };

  const handleDeleteIsaAccount = (id: string) => {
    onChangeParams({
      ...params,
      isaAccounts: (params.isaAccounts || []).filter((isa) => isa.id !== id),
    });
  };

  // 5. Other Incomes actions
  const handleAddOtherIncome = () => {
    const newIncome: OtherIncome = {
      id: createEntityId('income'),
      label: '신규 월 소득',
      monthlyAmount: 0,
      currency: 'KRW',
    };
    onChangeParams({
      ...params,
      otherIncomes: [...params.otherIncomes, newIncome],
    });
  };

  const handleUpdateOtherIncome = (id: string, key: keyof OtherIncome, value: OtherIncome[keyof OtherIncome]) => {
    onChangeParams((prevParams: SimulationParams) => {
      const updated = prevParams.otherIncomes.map((income) => {
        if (income.id === id) {
          if (key === 'currency') {
            const prevCurrency = income.currency;
            const nextCurrency = value as AssetCurrency;
            if (prevCurrency !== nextCurrency) {
              let monthlyAmount = income.monthlyAmount;
              if (prevCurrency === 'USD' && nextCurrency === 'KRW') {
                monthlyAmount = Math.round(monthlyAmount * prevParams.baseExchangeRate);
              } else if (prevCurrency === 'KRW' && nextCurrency === 'USD') {
                monthlyAmount = Math.round((monthlyAmount / prevParams.baseExchangeRate) * 100) / 100;
              }
              return { ...income, currency: nextCurrency, monthlyAmount };
            }
          }
          return { ...income, [key]: value };
        }
        return income;
      });
      return { ...prevParams, otherIncomes: updated };
    });
  };

  // 이 핸들러는 아래의 handleUpdate*/fetch* 들을 부르므로 그 선언 뒤에 둔다.
  // 위쪽에 두면 const 선언보다 앞서 참조하게 되어(런타임에는 호출 시점이 늦어 동작하지만)
  // React Compiler가 "선언 전 접근"으로 막는다 — 그 값이 나중에 바뀌어도 앞선 참조가
  // 따라가지 못하는 형태이기 때문이다.
  const handleAutocompleteKeyDown = (e: React.KeyboardEvent, id: string, name: string | undefined, type: 'asset' | 'pension' | 'isa') => {
    if (!focusedAssetId || focusedAssetId !== id || !name) return;
    const combined = getCombinedOptions(id, name);
    if (combined.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAutocompleteIndex(prev => Math.min(prev + 1, combined.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAutocompleteIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (autocompleteIndex >= 0 && autocompleteIndex < combined.length) {
        const pa = combined[autocompleteIndex];
        isSelectingRef.current[id] = true;
        
        if (type === 'asset') {
          const isUsEtf = pa.type === 'etf' && pa.currency === 'USD';
          handleUpdateAsset(id, {
            name: isUsEtf ? pa.ticker : pa.name,
            ticker: pa.ticker,
            type: pa.type,
            currency: pa.currency,
            totalReturn: pa.totalReturn,
            dividendYield: pa.dividendYield,
          });
          fetchAssetInfo(id, pa.ticker);
          fetchAssetPrice(id, pa.ticker);
        } else if (type === 'pension') {
          handleUpdatePrivatePension(id, {
            name: pa.name,
            ticker: pa.ticker,
            currency: pa.currency,
            totalReturn: pa.totalReturn,
          });
          fetchPensionInfo(id, pa.ticker);
        } else if (type === 'isa') {
          handleUpdateIsaAccount(id, {
            name: pa.name,
            ticker: pa.ticker,
            currency: pa.currency,
            totalReturn: pa.totalReturn,
          });
          fetchIsaInfo(id, pa.ticker);
        }
        
        setFocusedAssetId(null);
        setAutocompleteIndex(-1);
        setTimeout(() => { isSelectingRef.current[id] = false; }, 200);
      }
    } else if (e.key === 'Escape') {
      setFocusedAssetId(null);
      setAutocompleteIndex(-1);
    }
  };

  const handleDeleteOtherIncome = (id: string) => {
    onChangeParams({
      ...params,
      otherIncomes: params.otherIncomes.filter((income) => income.id !== id),
    });
  };

  const handleTabClick = (tab: TabType, e: React.MouseEvent<HTMLButtonElement>) => {
    setActiveTab(tab);
    e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };

  const [isSectionExpanded, setIsSectionExpanded] = useState(true);

  return (
    <div className={styles.formContainer}>
      <div 
        className={styles.header}
        onClick={() => setIsSectionExpanded(!isSectionExpanded)}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isSectionExpanded ? '1rem' : '0' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Wallet size={18} className={styles.icon} />
          <span className={styles.title}>보유 자산 입력</span>
        </div>
        {isSectionExpanded ? <ChevronUp size={18} className={styles.icon} /> : <ChevronDown size={18} className={styles.icon} />}
      </div>

      {isSectionExpanded && (
        <>
          <YieldPresetHelper params={params} onChangeParams={onChangeParams} />

          {/* Tab Menu */}
          <div className={styles.tabList}>
        <button
          className={`${styles.tabButton} ${activeTab === 'stocks' ? styles.tabButtonActive : ''}`}
          onClick={(e) => handleTabClick('stocks', e)}
        >
          <Landmark size={16} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
          주식 & ETF <span className={styles.numberBadge}>{params.assets.length}</span>
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === 'pensions' ? styles.tabButtonActive : ''}`}
          onClick={(e) => handleTabClick('pensions', e)}
        >
          <PiggyBank size={16} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
          연금 자산 <span className={styles.numberBadge}>{params.privatePensions.length + 1}</span>
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === 'isa' ? styles.tabButtonActive : ''}`}
          onClick={(e) => handleTabClick('isa', e)}
        >
          <Landmark size={16} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
          ISA 계좌 <span className={styles.numberBadge}>{(params.isaAccounts || []).length}</span>
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === 'other' ? styles.tabButtonActive : ''}`}
          onClick={(e) => handleTabClick('other', e)}
        >
          <DollarSign size={16} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
          기타 소득 <span className={styles.numberBadge}>{params.otherIncomes.length}</span>
        </button>
      </div>

      {/* Tab Panels */}
      <div className={styles.tabContent}>
        {/* Stock & ETF Tab */}
        {activeTab === 'stocks' && (
          <div>
            {params.assets.map((asset) => {
              const isExpanded = !!expandedAssets[asset.id];
              const formatQuantity = (qty: number) => {
                return `${qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}주`;
              };
              const formatEvaluationAmount = (qty: number, price: number, assetCurrency: string) => {
                const val = qty * price;
                if (assetCurrency === 'KRW') {
                  return `${Math.round(val).toLocaleString()}원`;
                } else {
                  return `$${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
                }
              };

              return (
                <div 
                  key={asset.id} 
                  className={`${styles.assetCard} ${isExpanded ? styles.assetCardExpanded : ''}`}
                  style={{ zIndex: focusedAssetId === asset.id ? 50 : 1 }}
                >
                  <div
                    className={`${styles.cardHeader} ${styles.clickableHeader}`}
                    onClick={() => toggleExpand(asset.id)}
                  >
                    <div className={styles.headerTitleArea}>
                      <span className={styles.chevronIcon}>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </span>
                      <span className={styles.cardTitle}>
                        {asset.name || '미입력 자산'}
                      </span>
                    </div>
                    <div className={styles.headerActionArea} onClick={(e) => e.stopPropagation()}>
                      <button className={styles.deleteButton} onClick={() => handleDeleteAsset(asset.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div
                    className={`${styles.summaryContainer} ${isExpanded ? styles.expanded : ''}`}
                    onClick={() => toggleExpand(asset.id)}
                  >
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>수량:</span>
                      <span className={styles.summaryValue}>{formatQuantity(asset.quantity)}</span>
                    </div>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>평가금:</span>
                      <span className={styles.summaryValue}>
                        {formatEvaluationAmount(asset.quantity, asset.averagePrice, asset.currency)}
                      </span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className={`${styles.cardDetails} ${compStyles.grid}`}>
                      <div className={styles.autocompleteWrapper}>
                        <InputField
                          label="종목명"
                          type="text"
                          value={asset.name}
                          onChange={(e) => {
                            if (isSelectingRef.current[asset.id]) return;
                            const val = e.target.value;
                            handleUpdateAsset(asset.id, 'name', val);
                            setFocusedAssetId(asset.id);
                            setAutocompleteIndex(-1);
                            if (searchTimeoutRef.current[asset.id]) {
                              clearTimeout(searchTimeoutRef.current[asset.id]);
                            }
                            searchTimeoutRef.current[asset.id] = setTimeout(() => {
                              fetchRealtimeSuggestions(asset.id, val);
                            }, 150);
                          }}
                          onKeyDown={(e) => handleAutocompleteKeyDown(e, asset.id, asset.name, 'asset')}
                          onFocus={() => setFocusedAssetId(asset.id)}
                          onBlur={() => setTimeout(() => setFocusedAssetId(null), 500)}
                        />
                        {focusedAssetId === asset.id && asset.name && (
                          (() => {
                            const combined = getCombinedOptions(asset.id, asset.name);
                            const searching = isSearching[asset.id];
                            
                            if (combined.length === 0 && !searching) return null;
                            
                            return (
                              <div className={styles.autocompleteDropdown}>
                                {combined.map((pa, i) => (
                                  <div
                                    key={pa.ticker}
                                    className={`${styles.autocompleteItem} ${autocompleteIndex === i ? styles.autocompleteItemActive : ''}`}
                                    onMouseEnter={() => setAutocompleteIndex(i)}
                                    onMouseDown={(e) => {
                                      e.preventDefault(); // Prevent input from losing focus on desktop
                                    }}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      isSelectingRef.current[asset.id] = true;
                                      const isUsEtf = pa.type === 'etf' && pa.currency === 'USD';
                                      handleUpdateAsset(asset.id, {
                                        name: isUsEtf ? pa.ticker : pa.name,
                                        ticker: pa.ticker,
                                        type: pa.type,
                                        currency: pa.currency,
                                        totalReturn: pa.totalReturn,
                                        dividendYield: pa.dividendYield,
                                      });
                                      setFocusedAssetId(null);
                                      setAutocompleteIndex(-1);
                                      fetchAssetInfo(asset.id, pa.ticker);
                                      fetchAssetPrice(asset.id, pa.ticker);
                                      setTimeout(() => { isSelectingRef.current[asset.id] = false; }, 200);
                                    }}
                                  >
                                    <span className={styles.autocompleteItemTitle}>{pa.name}</span>
                                    <span className={styles.autocompleteItemSub}>
                                      {pa.ticker} • {pa.currency === 'USD' ? '미국 주식/ETF' : '국내 주식/ETF'}
                                    </span>
                                  </div>
                                ))}
                                {searching && (
                                  <div className={styles.autocompleteItem} style={{ cursor: 'default' }}>
                                    <span className={styles.autocompleteItemSub}>실시간 검색 중...</span>
                                  </div>
                                )}
                              </div>
                            );
                          })()
                        )}
                      </div>
                      <SelectField
                        label="통화(Currency)"
                        value={asset.currency}
                        onChange={(e) => handleUpdateAsset(asset.id, 'currency', e.target.value)}
                        options={[
                          { value: 'KRW', label: 'KRW (원)' },
                          { value: 'USD', label: 'USD ($)' },
                        ]}
                      />
                      <SelectField
                        label="과세 체계"
                        value={asset.assetMarket || (asset.currency === 'USD' ? 'US_ETF' : 'KR_ETF')}
                        onChange={(e) => handleUpdateAsset(asset.id, 'assetMarket', e.target.value)}
                        options={[
                          { value: 'US_ETF', label: '해외(미국) 주식/ETF' },
                          { value: 'KR_ETF', label: '국내 상장 주식/ETF' },
                          { value: 'OTHER', label: '기타 자산 (비과세 등)' },
                        ]}
                      />
                      <NumberField
                        label="수량"
                        value={asset.quantity}
                        onChangeValue={(quantity) => handleUpdateAsset(asset.id, 'quantity', quantity)}
                      />
                      <div className={styles.priceInputWrapper}>
                        <div className={styles.priceInputGrow}>
                          <AmountField
                            label="현재 단가"
                            maximumFractionDigits={2}
                            value={asset.averagePrice}
                            onChangeValue={(price) => handleUpdateAsset(asset.id, 'averagePrice', price)}
                            suffixText={asset.currency === 'KRW' ? '원' : asset.currency}
                          />
                        </div>
                        <button
                          type="button"
                          className={`${compStyles.button} ${compStyles.buttonSecondary} ${styles.priceFetchButton}`}
                          onClick={() => fetchAssetPrice(asset.id, asset.ticker)}
                          disabled={fetchingPriceMap[asset.id] || asset.ticker === 'NEW'}
                          title="실시간 단가 조회"
                        >
                          <RefreshCw
                            size={22}
                            className={fetchingPriceMap[asset.id] ? styles.spinner : ''}
                          />
                        </button>
                      </div>
                      <InputField
                        label="총 취득원가"
                        // "현재 단가"는 시세 조회 버튼이 시장가로 덮어쓰므로 취득원가가 아니다.
                        // 양도소득세는 (매도액 − 취득원가)에 붙으므로 별도 입력이 필요하다.
                        // 비워 두면 지금까지의 평가차익을 과세하지 않는다 — 확정되지 않은
                        // 숫자를 지어내는 대신 사용자가 알려주지 않은 부분에 세금을 물리지 않는다.
                        labelSecondary="비우면 지금까지의 평가차익에 세금을 매기지 않습니다"
                        type="text"
                        value={
                          asset.acquisitionCostBasis === undefined
                            ? ''
                            : asset.acquisitionCostBasis.toLocaleString()
                        }
                        placeholder={(asset.quantity * asset.averagePrice).toLocaleString()}
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/,/g, '');
                          if (rawValue === '') {
                            handleUpdateAsset(asset.id, 'acquisitionCostBasis', undefined);
                            return;
                          }
                          const numValue = Number(rawValue);
                          if (!isNaN(numValue)) {
                            handleUpdateAsset(asset.id, 'acquisitionCostBasis', numValue);
                          }
                        }}
                        suffixText={asset.currency === 'KRW' ? '원' : asset.currency}
                      />
                      <div className={styles.returnFieldGroup}>
                        <div className={styles.priceInputWrapper}>
                          <div className={styles.priceInputGrow}>
                            <NumberField
                              label="연 총수익률"
                              step="0.1"
                              value={asset.totalReturn}
                              onChangeValue={(rate) => handleUpdateAsset(asset.id, 'totalReturn', rate)}
                              suffixText="%"
                            />
                          </div>
                          <button
                            type="button"
                            className={`${compStyles.button} ${compStyles.buttonSecondary} ${styles.priceFetchButton}`}
                            onClick={() => fetchAssetInfo(asset.id, asset.ticker)}
                            disabled={fetchingInfoMap[asset.id] || asset.ticker === 'NEW'}
                            title="실시간 성장률/배당률 조회"
                          >
                            <RefreshCw
                              size={22}
                              className={fetchingInfoMap[asset.id] ? styles.spinner : ''}
                            />
                          </button>
                        </div>
                        <div className={styles.priceInputWrapper}>
                          <div className={styles.priceInputGrow}>
                            <NumberField
                              label="연 배당률"
                              step="0.1"
                              value={asset.dividendYield}
                              onChangeValue={(rate) => handleUpdateAsset(asset.id, 'dividendYield', rate)}
                              suffixText="%"
                            />
                          </div>
                          <button
                            type="button"
                            className={`${compStyles.button} ${compStyles.buttonSecondary} ${styles.priceFetchButton}`}
                            onClick={() => fetchAssetInfo(asset.id, asset.ticker)}
                            disabled={fetchingInfoMap[asset.id] || asset.ticker === 'NEW'}
                            title="실시간 성장률/배당률 조회"
                          >
                            <RefreshCw
                              size={22}
                              className={fetchingInfoMap[asset.id] ? styles.spinner : ''}
                            />
                          </button>
                        </div>
                        <ReturnBreakdownHint totalReturn={asset.totalReturn} dividendYield={asset.dividendYield} />
                      </div>
                      <SelectField
                        label="적립 주기"
                        value={asset.contributionPeriod || 'monthly'}
                        onChange={(e) => {
                          const newPeriod = e.target.value as ContributionPeriod;
                          const currentPeriod = asset.contributionPeriod || 'monthly';
                          const currentAmount = asset.contributionAmount ?? asset.monthlyContribution;

                          const newAmount = roundContributionForCurrency(
                            convertContributionAmount(currentAmount, currentPeriod, newPeriod),
                            asset.currency
                          );
                          const roundedMonthly = roundContributionForCurrency(
                            toMonthlyContribution(newAmount, newPeriod),
                            asset.currency
                          );

                          handleUpdateAsset(asset.id, {
                            contributionPeriod: newPeriod,
                            contributionAmount: newAmount,
                            monthlyContribution: roundedMonthly,
                          });
                        }}
                        options={[
                          { value: 'daily', label: '매일(영업일 기준)' },
                          { value: 'weekly', label: '매주' },
                          { value: 'monthly', label: '매월' },
                        ]}
                      />
                      <AmountField
                        label={
                          (asset.contributionPeriod || 'monthly') === 'daily'
                            ? '매일 적립 투자금'
                            : (asset.contributionPeriod || 'monthly') === 'weekly'
                            ? '매주 적립 투자금'
                            : '월 적립 투자금'
                        }
                        value={asset.contributionAmount ?? asset.monthlyContribution}
                        onChangeValue={(numValue) => {
                          const period = asset.contributionPeriod || 'monthly';
                          const roundedMonthly = roundContributionForCurrency(
                            toMonthlyContribution(numValue, period),
                            asset.currency
                          );

                          handleUpdateAsset(asset.id, {
                            contributionAmount: numValue,
                            monthlyContribution: roundedMonthly,
                          });
                        }}
                        onStepUp={() => {
                          const currentAmount = asset.contributionAmount ?? asset.monthlyContribution;
                          const nextAmount = currentAmount + 5000;
                          const period = asset.contributionPeriod || 'monthly';
                          const roundedMonthly = roundContributionForCurrency(
                            toMonthlyContribution(nextAmount, period),
                            asset.currency
                          );

                          handleUpdateAsset(asset.id, {
                            contributionAmount: nextAmount,
                            monthlyContribution: roundedMonthly,
                          });
                        }}
                        onStepDown={() => {
                          const currentAmount = asset.contributionAmount ?? asset.monthlyContribution;
                          const nextAmount = Math.max(0, currentAmount - 5000);
                          const period = asset.contributionPeriod || 'monthly';
                          const roundedMonthly = roundContributionForCurrency(
                            toMonthlyContribution(nextAmount, period),
                            asset.currency
                          );

                          handleUpdateAsset(asset.id, {
                            contributionAmount: nextAmount,
                            monthlyContribution: roundedMonthly,
                          });
                        }}
                        suffixText={asset.currency === 'KRW' ? '원' : asset.currency}
                      />
                      {showPerAssetDividend && (
                        <SelectField
                          label="배당 재투자 여부"
                          labelSecondary={dividendGoverned ? '「연금 전략」이 결정하는 중' : '기준선 — AI가 더 나은 쪽을 고릅니다'}
                          value={asset.reinvestDividend ? 'true' : 'false'}
                          disabled={dividendGoverned}
                          onChange={(e) => handleUpdateAsset(asset.id, 'reinvestDividend', e.target.value === 'true')}
                          options={[
                            { value: 'true', label: '세후 재투자 활성화' },
                            { value: 'false', label: '현금 수령 (재투자 미수행)' },
                          ]}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <button className={styles.addButton} onClick={handleAddCustomAsset}>
              <Plus size={16} /> 투자자산 추가
            </button>
          </div>
        )}

        {/* Pensions Tab */}
        {activeTab === 'pensions' && (
          <div>
            {/* National Pension */}
            <div className={styles.assetCard}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>국민연금 (만 65세 수령 시작)</span>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem', marginTop: '-0.5rem' }}>
                * 수령액은 매년 설정된 물가상승률과 동일하게 인상되어 적용됩니다.
              </p>
              <div className={compStyles.grid}>
                  <AmountField
                    label="예상 월 수령액"
                    value={params.nationalPension.expectedMonthlyAmount}
                    onChangeValue={handleNationalPensionChange}
                    onStepUp={() => {
                      handleNationalPensionChange(params.nationalPension.expectedMonthlyAmount + 10000);
                    }}
                    onStepDown={() => {
                      handleNationalPensionChange(Math.max(0, params.nationalPension.expectedMonthlyAmount - 10000));
                    }}
                    suffixText="원"
                  />
              </div>
              <div className={styles.pensionLinkContainer}>
                <a
                  href="https://csa.nps.or.kr/ohkd/ntpsidnty/anpninq/UHKD7101M0.do"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.pensionLink}
                >
                  <ExternalLink size={14} />
                  국민연금 예상수령액 조회 (내 연금 알아보기)
                </a>
              </div>
            </div>

            {/* Private Pensions */}
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>사적연금 (IRP / 연금저축 / 퇴직연금)</span>
            </div>
            {params.privatePensions.map((pension) => {
              const isExpanded = !!expandedPensions[pension.id];
              const formatAmount = (val: number, currency: string) => {
                if (currency === 'KRW') {
                  return `${Math.round(val).toLocaleString()}원`;
                } else {
                  return `$${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
                }
              };

              return (
              <div 
                key={pension.id} 
                className={`${styles.assetCard} ${isExpanded ? styles.assetCardExpanded : ''}`}
                style={{ zIndex: focusedAssetId === pension.id ? 50 : 1 }}
              >
                <div 
                  className={`${styles.cardHeader} ${styles.clickableHeader}`}
                  onClick={() => togglePensionExpand(pension.id)}
                >
                  <div className={styles.headerTitleArea}>
                    <span className={styles.chevronIcon}>
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </span>
                    <span className={styles.cardTitle}>
                      {pension.type === 'savings' ? '저축' : pension.type === 'retirement' ? '퇴직' : pension.type.toUpperCase()} 연금 계좌
                    </span>
                  </div>
                  <div className={styles.headerActionArea} onClick={(e) => e.stopPropagation()}>
                    <button className={styles.deleteButton} onClick={() => handleDeletePrivatePension(pension.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div
                  className={`${styles.summaryContainer} ${isExpanded ? styles.expanded : ''}`}
                  onClick={() => togglePensionExpand(pension.id)}
                >
                  <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>잔액:</span>
                    <span className={styles.summaryValue}>{formatAmount(pension.balance, pension.currency)}</span>
                  </div>
                  <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>월 적립금:</span>
                    <span className={styles.summaryValue}>{formatAmount(pension.monthlyContribution, pension.currency)}</span>
                  </div>
                </div>

                {isExpanded && (
                <div className={`${styles.cardDetails} ${compStyles.grid}`}>
                  <SelectField
                    label="연금 유형"
                    value={pension.type}
                    onChange={(e) => handleUpdatePrivatePension(pension.id, 'type', e.target.value)}
                    options={[
                      { value: 'irp', label: 'IRP' },
                      { value: 'savings', label: '연금저축' },
                      { value: 'retirement', label: '퇴직연금' },
                    ]}
                  />
                  <SelectField
                    label="투자 방식"
                    value={pension.investmentType || 'custom'}
                    onChange={(e) => handleUpdatePrivatePension(pension.id, 'investmentType', e.target.value)}
                    options={[
                      { value: 'custom', label: '직접입력 (기본)' },
                      { value: 'deposit', label: '예금 (Deposit)' },
                      { value: 'etf', label: 'ETF' },
                    ]}
                  />
                  {pension.investmentType === 'etf' && (
                    <div className={styles.autocompleteWrapper}>
                      <InputField
                        label="종목명"
                        type="text"
                        value={pension.name || ''}
                        onChange={(e) => {
                          if (isSelectingRef.current[pension.id]) return;
                          const val = e.target.value;
                          handleUpdatePrivatePension(pension.id, 'name', val);
                          setFocusedAssetId(pension.id);
                          setAutocompleteIndex(-1);
                          if (searchTimeoutRef.current[pension.id]) {
                            clearTimeout(searchTimeoutRef.current[pension.id]);
                          }
                          searchTimeoutRef.current[pension.id] = setTimeout(() => {
                            fetchRealtimeSuggestions(pension.id, val);
                          }, 150);
                        }}
                        onKeyDown={(e) => handleAutocompleteKeyDown(e, pension.id, pension.name, 'pension')}
                        onFocus={() => setFocusedAssetId(pension.id)}
                        onBlur={() => setTimeout(() => setFocusedAssetId(null), 200)}
                      />
                      {focusedAssetId === pension.id && pension.name && (
                        (() => {
                          const combined = getCombinedOptions(pension.id, pension.name);
                          const searching = isSearching[pension.id];
                          if (combined.length === 0 && !searching) return null;
                          return (
                            <div className={styles.autocompleteDropdown}>
                              {combined.map((pa, i) => (
                                <div
                                  key={pa.ticker}
                                  className={`${styles.autocompleteItem} ${autocompleteIndex === i ? styles.autocompleteItemActive : ''}`}
                                  onMouseEnter={() => setAutocompleteIndex(i)}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                  }}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    isSelectingRef.current[pension.id] = true;
                                    handleUpdatePrivatePension(pension.id, {
                                      name: pa.name,
                                      ticker: pa.ticker,
                                      currency: pa.currency,
                                      totalReturn: pa.totalReturn,
                                    });
                                    setFocusedAssetId(null);
                                    setAutocompleteIndex(-1);
                                    fetchPensionInfo(pension.id, pa.ticker);
                                    setTimeout(() => { isSelectingRef.current[pension.id] = false; }, 200);
                                  }}
                                >
                                  <span className={styles.autocompleteItemTitle}>{pa.name}</span>
                                  <span className={styles.autocompleteItemSub}>
                                    {pa.ticker} • {pa.currency === 'USD' ? '미국 주식/ETF' : '국내 주식/ETF'}
                                  </span>
                                </div>
                              ))}
                              {searching && (
                                <div className={styles.autocompleteItem} style={{ cursor: 'default' }}>
                                  <span className={styles.autocompleteItemSub}>실시간 검색 중...</span>
                                </div>
                              )}
                            </div>
                          );
                        })()
                      )}
                    </div>
                  )}
                  <SelectField
                    label="통화(Currency)"
                    value={pension.currency}
                    onChange={(e) => handleUpdatePrivatePension(pension.id, 'currency', e.target.value)}
                    options={[
                      { value: 'KRW', label: 'KRW (원)' },
                      { value: 'USD', label: 'USD ($)' },
                    ]}
                  />
                  <AmountField
                    label="현재 적립 잔액 (평가 금액)"
                    value={pension.balance}
                    onChangeValue={(balance) => handleUpdatePrivatePension(pension.id, 'balance', balance)}
                    onStepUp={() => {
                      handleUpdatePrivatePension(pension.id, 'balance', pension.balance + (pension.currency === 'KRW' ? 100000 : 100));
                    }}
                    onStepDown={() => {
                      handleUpdatePrivatePension(pension.id, 'balance', Math.max(0, pension.balance - (pension.currency === 'KRW' ? 100000 : 100)));
                    }}
                    suffixText={pension.currency === 'KRW' ? '원' : pension.currency}
                  />
                  <AmountField
                    label="월 추가 적립금"
                    value={pension.monthlyContribution}
                    onChangeValue={(amount) => handleUpdatePrivatePension(pension.id, 'monthlyContribution', amount)}
                    onStepUp={() => {
                      handleUpdatePrivatePension(pension.id, 'monthlyContribution', pension.monthlyContribution + (pension.currency === 'KRW' ? 10000 : 10));
                    }}
                    onStepDown={() => {
                      handleUpdatePrivatePension(pension.id, 'monthlyContribution', Math.max(0, pension.monthlyContribution - (pension.currency === 'KRW' ? 10000 : 10)));
                    }}
                    suffixText={pension.currency === 'KRW' ? '원' : pension.currency}
                  />
                  {pension.investmentType === 'etf' ? (
                    <>
                      <div className={styles.returnFieldGroup}>
                        <div className={styles.priceInputWrapper}>
                          <div className={styles.priceInputGrow}>
                            <NumberField
                              label="연 총수익률"
                              step="0.1"
                              value={pension.totalReturn}
                              onChangeValue={(rate) => handleUpdatePrivatePension(pension.id, 'totalReturn', rate)}
                              suffixText="%"
                            />
                          </div>
                          <button
                            type="button"
                            className={`${compStyles.button} ${compStyles.buttonSecondary} ${styles.priceFetchButton}`}
                            onClick={() => fetchPensionInfo(pension.id, pension.ticker!)}
                            disabled={fetchingInfoMap[pension.id] || !pension.ticker}
                            title="실시간 수익률 조회"
                          >
                            <RefreshCw
                              size={22}
                              className={fetchingInfoMap[pension.id] ? styles.spinner : ''}
                            />
                          </button>
                        </div>
                        <div className={styles.priceInputWrapper}>
                          <div className={styles.priceInputGrow}>
                            <NumberField
                              label="연 배당률"
                              step="0.1"
                              value={pension.dividendYield || 0}
                              onChangeValue={(rate) => handleUpdatePrivatePension(pension.id, 'dividendYield', rate)}
                              suffixText="%"
                            />
                          </div>
                          <button
                            type="button"
                            className={`${compStyles.button} ${compStyles.buttonSecondary} ${styles.priceFetchButton}`}
                            onClick={() => fetchPensionInfo(pension.id, pension.ticker!)}
                            disabled={fetchingInfoMap[pension.id] || !pension.ticker}
                            title="실시간 수익률/배당률 조회"
                          >
                            <RefreshCw
                              size={22}
                              className={fetchingInfoMap[pension.id] ? styles.spinner : ''}
                            />
                          </button>
                        </div>
                        <ReturnBreakdownHint totalReturn={pension.totalReturn} dividendYield={pension.dividendYield || 0} />
                      </div>
                    </>
                  ) : (
                    <NumberField
                      label={pension.investmentType === 'deposit' ? '연 이자율 (금리)' : '연 총수익률'}
                      step="0.1"
                      value={pension.totalReturn}
                      onChangeValue={(rate) => handleUpdatePrivatePension(pension.id, 'totalReturn', rate)}
                      suffixText="%"
                    />
                  )}
                </div>
                )}
              </div>
            )})}
            <button className={styles.addButton} onClick={handleAddPrivatePension}>
              <Plus size={16} /> 사적연금 추가
            </button>
          </div>
        )}

        {/* ISA Account Tab */}
        {activeTab === 'isa' && (
          <div>
            {(params.isaAccounts || []).map((isa) => {
              const isExpanded = !!expandedIsa[isa.id];
              return (
                <div key={isa.id} className={`${styles.assetCard} ${isExpanded ? styles.assetCardExpanded : ''}`}>
                  <div className={`${styles.cardHeader} ${styles.clickableHeader}`} onClick={() => toggleIsaExpand(isa.id)}>
                    <div className={styles.headerTitleArea}>
                      <span className={styles.chevronIcon}>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </span>
                      <span className={styles.cardTitle}>중개형 ISA ({isa.type === 'general' ? '일반형' : '서민형'})</span>
                    </div>
                    <div className={styles.headerActionArea} onClick={(e) => e.stopPropagation()}>
                      <button className={styles.deleteButton} onClick={() => handleDeleteIsaAccount(isa.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className={`${styles.summaryContainer} ${isExpanded ? styles.expanded : ''}`} onClick={() => toggleIsaExpand(isa.id)}>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>현재 잔액:</span>
                      <span className={styles.summaryValue}>{isa.balance.toLocaleString()}{isa.currency === 'KRW' ? '원' : ''}</span>
                    </div>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>월 적립:</span>
                      <span className={styles.summaryValue}>{isa.monthlyContribution.toLocaleString()}{isa.currency === 'KRW' ? '원' : ''}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className={`${styles.cardDetails} ${compStyles.grid}`}>
                      <SelectField
                        label="ISA 유형"
                        value={isa.type}
                        onChange={(e) => handleUpdateIsaAccount(isa.id, 'type', e.target.value)}
                        options={[
                          { value: 'general', label: '일반형 (비과세 200만원)' },
                          { value: 'low_income', label: '서민형 (비과세 400만원)' },
                        ]}
                      />
                      <SelectField
                        label="투자 방식"
                        value={isa.investmentType || 'custom'}
                        onChange={(e) => handleUpdateIsaAccount(isa.id, 'investmentType', e.target.value)}
                        options={[
                          { value: 'custom', label: '직접입력 (기본)' },
                          { value: 'deposit', label: '예금 (Deposit)' },
                          { value: 'etf', label: 'ETF' },
                        ]}
                      />
                      {isa.investmentType === 'etf' && (
                        <div className={styles.autocompleteWrapper}>
                          <InputField
                            label="종목명"
                            type="text"
                            value={isa.name || ''}
                            onChange={(e) => {
                              if (isSelectingRef.current[isa.id]) return;
                              const val = e.target.value;
                              handleUpdateIsaAccount(isa.id, 'name', val);
                              setFocusedAssetId(isa.id);
                              setAutocompleteIndex(-1);
                              if (searchTimeoutRef.current[isa.id]) {
                                clearTimeout(searchTimeoutRef.current[isa.id]);
                              }
                              searchTimeoutRef.current[isa.id] = setTimeout(() => {
                                fetchRealtimeSuggestions(isa.id, val);
                              }, 150);
                            }}
                            onKeyDown={(e) => handleAutocompleteKeyDown(e, isa.id, isa.name, 'isa')}
                            onFocus={() => setFocusedAssetId(isa.id)}
                            onBlur={() => setTimeout(() => setFocusedAssetId(null), 200)}
                          />
                          {focusedAssetId === isa.id && isa.name && (
                            (() => {
                              const combined = getCombinedOptions(isa.id, isa.name);
                              const searching = isSearching[isa.id];
                              if (combined.length === 0 && !searching) return null;
                              return (
                                <div className={styles.autocompleteDropdown}>
                                  {combined.map((pa, i) => (
                                    <div
                                      key={pa.ticker}
                                      className={`${styles.autocompleteItem} ${autocompleteIndex === i ? styles.autocompleteItemActive : ''}`}
                                      onMouseEnter={() => setAutocompleteIndex(i)}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                      }}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        isSelectingRef.current[isa.id] = true;
                                        handleUpdateIsaAccount(isa.id, {
                                          name: pa.name,
                                          ticker: pa.ticker,
                                          currency: pa.currency,
                                          totalReturn: pa.totalReturn,
                                        });
                                        setFocusedAssetId(null);
                                        setAutocompleteIndex(-1);
                                        fetchIsaInfo(isa.id, pa.ticker);
                                        setTimeout(() => { isSelectingRef.current[isa.id] = false; }, 200);
                                      }}
                                    >
                                      <span className={styles.autocompleteItemTitle}>{pa.name}</span>
                                      <span className={styles.autocompleteItemSub}>
                                        {pa.ticker} • {pa.currency === 'USD' ? '미국 주식/ETF' : '국내 주식/ETF'}
                                      </span>
                                    </div>
                                  ))}
                                  {searching && (
                                    <div className={styles.autocompleteItem} style={{ cursor: 'default' }}>
                                      <span className={styles.autocompleteItemSub}>실시간 검색 중...</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })()
                          )}
                        </div>
                      )}
                      <NumberField
                        label="만기 기간 (년)"
                        value={isa.maturityYears}
                        onChangeValue={(years) => handleUpdateIsaAccount(isa.id, 'maturityYears', years)}
                        suffixText="년"
                      />
                      <AmountField
                        label="현재 잔액"
                        value={isa.balance}
                        onChangeValue={(balance) => handleUpdateIsaAccount(isa.id, 'balance', balance)}
                        suffixText={isa.currency === 'KRW' ? '원' : isa.currency}
                      />
                      <AmountField
                        label="월 적립액"
                        value={isa.monthlyContribution}
                        onChangeValue={(amount) => handleUpdateIsaAccount(isa.id, 'monthlyContribution', amount)}
                        suffixText={isa.currency === 'KRW' ? '원' : isa.currency}
                      />
                      {isa.investmentType === 'etf' ? (
                        <>
                          <div className={styles.returnFieldGroup}>
                            <div className={styles.priceInputWrapper}>
                              <div className={styles.priceInputGrow}>
                                <NumberField
                                  label="연 총수익률"
                                  step="0.1"
                                  value={isa.totalReturn}
                                  onChangeValue={(rate) => handleUpdateIsaAccount(isa.id, 'totalReturn', rate)}
                                  suffixText="%"
                                />
                              </div>
                              <button
                                type="button"
                                className={`${compStyles.button} ${compStyles.buttonSecondary} ${styles.priceFetchButton}`}
                                onClick={() => fetchIsaInfo(isa.id, isa.ticker!)}
                                disabled={fetchingInfoMap[isa.id] || !isa.ticker}
                                title="실시간 수익률 조회"
                              >
                                <RefreshCw
                                  size={22}
                                  className={fetchingInfoMap[isa.id] ? styles.spinner : ''}
                                />
                              </button>
                            </div>
                            <div className={styles.priceInputWrapper}>
                              <div className={styles.priceInputGrow}>
                                <NumberField
                                  label="연 배당률"
                                  step="0.1"
                                  value={isa.dividendYield || 0}
                                  onChangeValue={(rate) => handleUpdateIsaAccount(isa.id, 'dividendYield', rate)}
                                  suffixText="%"
                                />
                              </div>
                              <button
                                type="button"
                                className={`${compStyles.button} ${compStyles.buttonSecondary} ${styles.priceFetchButton}`}
                                onClick={() => fetchIsaInfo(isa.id, isa.ticker!)}
                                disabled={fetchingInfoMap[isa.id] || !isa.ticker}
                                title="실시간 수익률/배당률 조회"
                              >
                                <RefreshCw
                                  size={22}
                                  className={fetchingInfoMap[isa.id] ? styles.spinner : ''}
                                />
                              </button>
                            </div>
                            <ReturnBreakdownHint totalReturn={isa.totalReturn} dividendYield={isa.dividendYield || 0} />
                          </div>
                        </>
                      ) : isa.investmentType === 'deposit' ? (
                        <NumberField
                          label="연 이자율 (금리)"
                          step="0.1"
                          value={isa.totalReturn}
                          onChangeValue={(rate) => handleUpdateIsaAccount(isa.id, 'totalReturn', rate)}
                          suffixText="%"
                        />
                      ) : (
                        <>
                          <div className={styles.returnFieldGroup}>
                            <NumberField
                              label="연 총수익률"
                              step="0.1"
                              value={isa.totalReturn}
                              onChangeValue={(rate) => handleUpdateIsaAccount(isa.id, 'totalReturn', rate)}
                              suffixText="%"
                            />
                            <NumberField
                              label="연 배당률"
                              step="0.1"
                              value={isa.dividendYield}
                              onChangeValue={(rate) => handleUpdateIsaAccount(isa.id, 'dividendYield', rate)}
                              suffixText="%"
                            />
                            <ReturnBreakdownHint totalReturn={isa.totalReturn} dividendYield={isa.dividendYield} />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <button className={styles.addButton} onClick={handleAddIsaAccount}>
              <Plus size={16} /> ISA 계좌 추가
            </button>
          </div>
        )}

        {/* Other Income Tab */}
        {activeTab === 'other' && (
          <div>
            {params.otherIncomes.map((income) => (
              <div key={income.id} className={styles.assetCard}>
                <div className={styles.cardHeader}>
                  <span className={styles.cardTitle}>{income.label || '소득원 이름 미지정'}</span>
                  <button className={styles.deleteButton} onClick={() => handleDeleteOtherIncome(income.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className={compStyles.grid}>
                  <InputField
                    label="소득원 설명"
                    type="text"
                    value={income.label}
                    onChange={(e) => handleUpdateOtherIncome(income.id, 'label', e.target.value)}
                  />
                  <SelectField
                    label="통화(Currency)"
                    value={income.currency}
                    onChange={(e) => handleUpdateOtherIncome(income.id, 'currency', e.target.value)}
                    options={[
                      { value: 'KRW', label: 'KRW (원)' },
                      { value: 'USD', label: 'USD ($)' },
                    ]}
                  />
                  <AmountField
                    label="월 예상 소득"
                    // 이 시뮬레이터는 기타소득에 세금을 매기지 않는다. 소득원 설명이 자유 입력이라
                    // 월세인지 근로소득인지 알 수 없고, 사용자가 세전/세후 중 무엇을 넣었는지도
                    // 알 수 없다. 모르는 상태에서 세금을 물리면 임의로 소득을 깎는 것이므로,
                    // "세후를 넣어 달라"고 명시해 현재 동작을 의도된 계약으로 만든다.
                    labelSecondary="세금·공과금을 뺀 실수령액"
                    value={income.monthlyAmount}
                    onChangeValue={(amount) => handleUpdateOtherIncome(income.id, 'monthlyAmount', amount)}
                    suffixText={income.currency === 'KRW' ? '원' : income.currency}
                  />
                </div>
              </div>
            ))}
            <button className={styles.addButton} onClick={handleAddOtherIncome}>
              <Plus size={16} /> 기타소득원 추가
            </button>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
};
export default AssetFormSection;
