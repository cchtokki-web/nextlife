import React, { useState, useRef, useCallback } from 'react';
import { SimulationParams, InvestmentAsset, PrivatePension, OtherIncome, AssetCurrency, IsaAccount } from '../../../core/entities/types';
import { InputField } from '../../components/InputField';
import { SelectField } from '../../components/SelectField';
import styles from './AssetForm.module.css';
import compStyles from '../../styles/components.module.css';
import { Plus, Trash2, Wallet, Landmark, PiggyBank, DollarSign, ExternalLink, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { predefinedAssets } from './predefinedAssets';
import { ReturnBreakdownHint } from './ReturnBreakdownHint';
import { initialParams } from '../../../infrastructure/storage/localStore';
import { resolveRiskProfileYieldPreset, resolveStrategy } from '../../../core/usecases/strategy/compileStrategy';
import { isEconomicScenarioGoverning } from '../../../core/usecases/scenario/economicScenarios';
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
  // 전략(「투자 전략」)이 수익률을 지배하는 동안에는 이 폼의 수익률 입력을 잠근다.
  //
  // 이 폼은 compileStrategy를 거친 params가 아니라 원본 params를 받는다. 그래서 입력을
  // 열어두면 사용자는 자기가 넣은 값을 보면서 엔진은 프리셋 값(리스크 성향 5/7/9% ·
  // 3/4/6%, 경제 시나리오 프로필)으로 계산하는 상태가 조용히 만들어진다. 고급 설정의
  // 저율과세 한도, 「경제 가정」의 물가상승률에 이미 쓰고 있는 "지배 중이면 비활성화 +
  // 이유 표시" 패턴을 그대로 재사용한다.
  //
  // 반대 방향(수익률을 편집하면 riskProfile을 'custom'으로 되돌리기)은 택하지 않았다:
  // 다른 섹션에서 사용자가 명시적으로 고른 전략이 화면 반대편의 입력 때문에 소리 없이
  // 뒤집히는 것이야말로 이 브랜치가 반복해서 고쳐 온 결함 형태이고, 게다가 경제 시나리오는
  // riskProfile이 아니므로 그 방식으로는 절반만 해결된다.
  const strategy = resolveStrategy(params);
  const yieldGovernedBy = resolveRiskProfileYieldPreset(strategy.riskProfile) !== null
    ? '리스크 성향'
    : isEconomicScenarioGoverning(strategy.economicScenario)
      ? '경제 시나리오'
      : null;

  // 실시간 조회 버튼도 같은 이유로 잠근다.
  //
  // fetchAssetInfo/fetchPensionInfo/fetchIsaInfo는 totalReturn을 덮어쓰면서
  // yieldPreset을 'custom'으로까지 찍는다. 입력만 비활성화하고 이 버튼을 열어두면, 지배 중에도
  // 버튼 하나로 화면상 수익률과 '직접입력' 표식이 동시에 바뀌는데 엔진은 여전히 프리셋으로
  // 계산한다 — 입력을 잠가서 없애려던 바로 그 불일치가 다른 문으로 되돌아온다.
  // 배당률 조회가 같은 함수에 묶여 있어 함께 잠기지만, 조회 결과가 수익률을 덮어쓰는 이상
  // 부분 적용은 "눌렀는데 일부만 반영된다"는 더 나쁜 상태가 된다.
  // 이유는 원래 제목 뒤에 덧붙인다 — 제목을 통째로 갈아치우면 툴팁만 보고는 이 버튼이
  // 무슨 버튼이었는지 알 수 없다. 화면 상단 배너가 같은 이유를 이미 문장으로 설명한다.
  const yieldFetchTitle = (base: string): string =>
    yieldGovernedBy
      ? `${base} (「투자 전략」의 ${yieldGovernedBy}이(가) 수익률을 결정하는 동안에는 쓸 수 없습니다)`
      : base;

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
  const handleAutocompleteKeyDown = useCallback((e: React.KeyboardEvent, id: string, name: string | undefined, type: 'asset' | 'pension' | 'isa') => {
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
  }, [focusedAssetId, autocompleteIndex, getCombinedOptions]);

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
          {yieldGovernedBy && (
            <p style={{ fontSize: '0.75rem', color: 'var(--warning, #f59e0b)', margin: '0 0 0.75rem' }}>
              「투자 전략」의 {yieldGovernedBy}이(가) 아래 수익률 값을 결정합니다. 직접 입력하려면
              투자 전략에서 리스크 성향은 &ldquo;입력 수익률 유지&rdquo;, 경제 시나리오는 &ldquo;직접 입력값 유지&rdquo;로 두세요.
            </p>
          )}
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
                      <InputField
                        label="수량"
                        type="number"
                        value={asset.quantity}
                        onChange={(e) => handleUpdateAsset(asset.id, 'quantity', Number(e.target.value))}
                      />
                      <div className={styles.priceInputWrapper}>
                        <div className={styles.priceInputGrow}>
                          <InputField
                            label="현재 단가"
                            type="text"
                            value={asset.averagePrice === 0 ? '0' : asset.averagePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            onChange={(e) => {
                              const rawValue = e.target.value.replace(/,/g, '');
                              const numValue = rawValue === '' ? 0 : Number(rawValue);
                              if (!isNaN(numValue)) {
                                handleUpdateAsset(asset.id, 'averagePrice', numValue);
                              }
                            }}
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
                            <InputField
                              label="연 총수익률"
                              type="number"
                              step="0.1"
                              value={asset.totalReturn}
                              disabled={yieldGovernedBy !== null}
                              onChange={(e) => handleUpdateAsset(asset.id, 'totalReturn', Number(e.target.value))}
                              suffixText="%"
                            />
                          </div>
                          <button
                            type="button"
                            className={`${compStyles.button} ${compStyles.buttonSecondary} ${styles.priceFetchButton}`}
                            onClick={() => fetchAssetInfo(asset.id, asset.ticker)}
                            disabled={fetchingInfoMap[asset.id] || asset.ticker === 'NEW' || yieldGovernedBy !== null}
                            title={yieldFetchTitle('실시간 성장률/배당률 조회')}
                          >
                            <RefreshCw
                              size={22}
                              className={fetchingInfoMap[asset.id] ? styles.spinner : ''}
                            />
                          </button>
                        </div>
                        <div className={styles.priceInputWrapper}>
                          <div className={styles.priceInputGrow}>
                            <InputField
                              label="연 배당률"
                              type="number"
                              step="0.1"
                              value={asset.dividendYield}
                              onChange={(e) => handleUpdateAsset(asset.id, 'dividendYield', Number(e.target.value))}
                              suffixText="%"
                            />
                          </div>
                          <button
                            type="button"
                            className={`${compStyles.button} ${compStyles.buttonSecondary} ${styles.priceFetchButton}`}
                            onClick={() => fetchAssetInfo(asset.id, asset.ticker)}
                            disabled={fetchingInfoMap[asset.id] || asset.ticker === 'NEW' || yieldGovernedBy !== null}
                            title={yieldFetchTitle('실시간 성장률/배당률 조회')}
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
                      <InputField
                        label={
                          (asset.contributionPeriod || 'monthly') === 'daily'
                            ? '매일 적립 투자금'
                            : (asset.contributionPeriod || 'monthly') === 'weekly'
                            ? '매주 적립 투자금'
                            : '월 적립 투자금'
                        }
                        type="text"
                        value={
                          (asset.contributionAmount ?? asset.monthlyContribution) === 0
                            ? '0'
                            : (asset.contributionAmount ?? asset.monthlyContribution).toLocaleString()
                        }
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/,/g, '');
                          const numValue = rawValue === '' ? 0 : Number(rawValue);
                          if (!isNaN(numValue)) {
                            const period = asset.contributionPeriod || 'monthly';
                            const roundedMonthly = roundContributionForCurrency(
                              toMonthlyContribution(numValue, period),
                              asset.currency
                            );

                            handleUpdateAsset(asset.id, {
                              contributionAmount: numValue,
                              monthlyContribution: roundedMonthly,
                            });
                          }
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
                      <SelectField
                        label="배당 재투자 여부"
                        value={asset.reinvestDividend ? 'true' : 'false'}
                        onChange={(e) => handleUpdateAsset(asset.id, 'reinvestDividend', e.target.value === 'true')}
                        options={[
                          { value: 'true', label: '세후 재투자 활성화' },
                          { value: 'false', label: '현금 수령 (재투자 미수행)' },
                        ]}
                      />
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
                  <InputField
                    label="예상 월 수령액"
                    type="text"
                    value={params.nationalPension.expectedMonthlyAmount === 0 ? '0' : params.nationalPension.expectedMonthlyAmount.toLocaleString()}
                    onChange={(e) => {
                      const rawValue = e.target.value.replace(/,/g, '');
                      const numValue = rawValue === '' ? 0 : Number(rawValue);
                      if (!isNaN(numValue)) {
                        handleNationalPensionChange(numValue);
                      }
                    }}
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
                  <InputField
                    label="현재 적립 잔액 (평가 금액)"
                    type="text"
                    value={pension.balance === 0 ? '0' : pension.balance.toLocaleString()}
                    onChange={(e) => {
                      const rawValue = e.target.value.replace(/,/g, '');
                      const numValue = rawValue === '' ? 0 : Number(rawValue);
                      if (!isNaN(numValue)) {
                        handleUpdatePrivatePension(pension.id, 'balance', numValue);
                      }
                    }}
                    onStepUp={() => {
                      handleUpdatePrivatePension(pension.id, 'balance', pension.balance + (pension.currency === 'KRW' ? 100000 : 100));
                    }}
                    onStepDown={() => {
                      handleUpdatePrivatePension(pension.id, 'balance', Math.max(0, pension.balance - (pension.currency === 'KRW' ? 100000 : 100)));
                    }}
                    suffixText={pension.currency === 'KRW' ? '원' : pension.currency}
                  />
                  <InputField
                    label="월 추가 적립금"
                    type="text"
                    value={pension.monthlyContribution === 0 ? '0' : pension.monthlyContribution.toLocaleString()}
                    onChange={(e) => {
                      const rawValue = e.target.value.replace(/,/g, '');
                      const numValue = rawValue === '' ? 0 : Number(rawValue);
                      if (!isNaN(numValue)) {
                        handleUpdatePrivatePension(pension.id, 'monthlyContribution', numValue);
                      }
                    }}
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
                            <InputField
                              label="연 총수익률"
                              type="number"
                              step="0.1"
                              value={pension.totalReturn}
                              disabled={yieldGovernedBy !== null}
                              onChange={(e) => handleUpdatePrivatePension(pension.id, 'totalReturn', Number(e.target.value))}
                              suffixText="%"
                            />
                          </div>
                          <button
                            type="button"
                            className={`${compStyles.button} ${compStyles.buttonSecondary} ${styles.priceFetchButton}`}
                            onClick={() => fetchPensionInfo(pension.id, pension.ticker!)}
                            disabled={fetchingInfoMap[pension.id] || !pension.ticker || yieldGovernedBy !== null}
                            title={yieldFetchTitle('실시간 수익률 조회')}
                          >
                            <RefreshCw
                              size={22}
                              className={fetchingInfoMap[pension.id] ? styles.spinner : ''}
                            />
                          </button>
                        </div>
                        <div className={styles.priceInputWrapper}>
                          <div className={styles.priceInputGrow}>
                            <InputField
                              label="연 배당률"
                              type="number"
                              step="0.1"
                              value={pension.dividendYield || 0}
                              onChange={(e) => handleUpdatePrivatePension(pension.id, 'dividendYield', Number(e.target.value))}
                              suffixText="%"
                            />
                          </div>
                          <button
                            type="button"
                            className={`${compStyles.button} ${compStyles.buttonSecondary} ${styles.priceFetchButton}`}
                            onClick={() => fetchPensionInfo(pension.id, pension.ticker!)}
                            disabled={fetchingInfoMap[pension.id] || !pension.ticker || yieldGovernedBy !== null}
                            title={yieldFetchTitle('실시간 수익률/배당률 조회')}
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
                    <InputField
                      label={pension.investmentType === 'deposit' ? '연 이자율 (금리)' : '연 총수익률'}
                      type="number"
                      step="0.1"
                      value={pension.totalReturn}
                      disabled={yieldGovernedBy !== null}
                      onChange={(e) => handleUpdatePrivatePension(pension.id, 'totalReturn', Number(e.target.value))}
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
                      <InputField
                        label="만기 기간 (년)"
                        type="number"
                        value={isa.maturityYears}
                        onChange={(e) => handleUpdateIsaAccount(isa.id, 'maturityYears', Number(e.target.value))}
                        suffixText="년"
                      />
                      <InputField
                        label="현재 잔액"
                        type="text"
                        value={isa.balance === 0 ? '0' : isa.balance.toLocaleString()}
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/,/g, '');
                          const numValue = rawValue === '' ? 0 : Number(rawValue);
                          if (!isNaN(numValue)) handleUpdateIsaAccount(isa.id, 'balance', numValue);
                        }}
                        suffixText={isa.currency === 'KRW' ? '원' : isa.currency}
                      />
                      <InputField
                        label="월 적립액"
                        type="text"
                        value={isa.monthlyContribution === 0 ? '0' : isa.monthlyContribution.toLocaleString()}
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/,/g, '');
                          const numValue = rawValue === '' ? 0 : Number(rawValue);
                          if (!isNaN(numValue)) handleUpdateIsaAccount(isa.id, 'monthlyContribution', numValue);
                        }}
                        suffixText={isa.currency === 'KRW' ? '원' : isa.currency}
                      />
                      {isa.investmentType === 'etf' ? (
                        <>
                          <div className={styles.returnFieldGroup}>
                            <div className={styles.priceInputWrapper}>
                              <div className={styles.priceInputGrow}>
                                <InputField
                                  label="연 총수익률"
                                  type="number"
                                  step="0.1"
                                  value={isa.totalReturn}
                                  disabled={yieldGovernedBy !== null}
                                  onChange={(e) => handleUpdateIsaAccount(isa.id, 'totalReturn', Number(e.target.value))}
                                  suffixText="%"
                                />
                              </div>
                              <button
                                type="button"
                                className={`${compStyles.button} ${compStyles.buttonSecondary} ${styles.priceFetchButton}`}
                                onClick={() => fetchIsaInfo(isa.id, isa.ticker!)}
                                disabled={fetchingInfoMap[isa.id] || !isa.ticker || yieldGovernedBy !== null}
                                title={yieldFetchTitle('실시간 수익률 조회')}
                              >
                                <RefreshCw
                                  size={22}
                                  className={fetchingInfoMap[isa.id] ? styles.spinner : ''}
                                />
                              </button>
                            </div>
                            <div className={styles.priceInputWrapper}>
                              <div className={styles.priceInputGrow}>
                                <InputField
                                  label="연 배당률"
                                  type="number"
                                  step="0.1"
                                  value={isa.dividendYield || 0}
                                  onChange={(e) => handleUpdateIsaAccount(isa.id, 'dividendYield', Number(e.target.value))}
                                  suffixText="%"
                                />
                              </div>
                              <button
                                type="button"
                                className={`${compStyles.button} ${compStyles.buttonSecondary} ${styles.priceFetchButton}`}
                                onClick={() => fetchIsaInfo(isa.id, isa.ticker!)}
                                disabled={fetchingInfoMap[isa.id] || !isa.ticker || yieldGovernedBy !== null}
                                title={yieldFetchTitle('실시간 수익률/배당률 조회')}
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
                        <InputField
                          label="연 이자율 (금리)"
                          type="number"
                          step="0.1"
                          value={isa.totalReturn}
                          disabled={yieldGovernedBy !== null}
                          onChange={(e) => handleUpdateIsaAccount(isa.id, 'totalReturn', Number(e.target.value))}
                          suffixText="%"
                        />
                      ) : (
                        <>
                          <div className={styles.returnFieldGroup}>
                            <InputField
                              label="연 총수익률"
                              type="number"
                              step="0.1"
                              value={isa.totalReturn}
                              disabled={yieldGovernedBy !== null}
                              onChange={(e) => handleUpdateIsaAccount(isa.id, 'totalReturn', Number(e.target.value))}
                              suffixText="%"
                            />
                            <InputField
                              label="연 배당률"
                              type="number"
                              step="0.1"
                              value={isa.dividendYield}
                              onChange={(e) => handleUpdateIsaAccount(isa.id, 'dividendYield', Number(e.target.value))}
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
                  <InputField
                    label="월 예상 소득"
                    // 이 시뮬레이터는 기타소득에 세금을 매기지 않는다. 소득원 설명이 자유 입력이라
                    // 월세인지 근로소득인지 알 수 없고, 사용자가 세전/세후 중 무엇을 넣었는지도
                    // 알 수 없다. 모르는 상태에서 세금을 물리면 임의로 소득을 깎는 것이므로,
                    // "세후를 넣어 달라"고 명시해 현재 동작을 의도된 계약으로 만든다.
                    labelSecondary="세금·공과금을 뺀 실수령액"
                    type="text"
                    value={income.monthlyAmount === 0 ? '0' : income.monthlyAmount.toLocaleString()}
                    onChange={(e) => {
                      const rawValue = e.target.value.replace(/,/g, '');
                      const numValue = rawValue === '' ? 0 : Number(rawValue);
                      if (!isNaN(numValue)) {
                        handleUpdateOtherIncome(income.id, 'monthlyAmount', numValue);
                      }
                    }}
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
