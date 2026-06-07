import React, { useState, useRef, useCallback } from 'react';
import { SimulationParams, InvestmentAsset, PrivatePension, OtherIncome, AssetCurrency } from '../../../core/entities/types';
import { InputField } from '../../components/InputField';
import { SelectField } from '../../components/SelectField';
import styles from './AssetForm.module.css';
import compStyles from '../../styles/components.module.css';
import { Plus, Trash2, User, Landmark, PiggyBank, DollarSign, ExternalLink, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { PredefinedAsset, predefinedAssets } from './predefinedAssets';

const convertAmountOnPeriodChange = (amount: number, fromPeriod: 'daily' | 'weekly' | 'monthly', toPeriod: 'daily' | 'weekly' | 'monthly'): number => {
  let monthlyAmount = amount;
  if (fromPeriod === 'daily') {
    monthlyAmount = amount * 365 / 12;
  } else if (fromPeriod === 'weekly') {
    monthlyAmount = amount * 52 / 12;
  }
  
  if (toPeriod === 'daily') {
    return monthlyAmount * 12 / 365;
  } else if (toPeriod === 'weekly') {
    return monthlyAmount * 12 / 52;
  } else {
    return monthlyAmount;
  }
};

const calculateMonthlyFromPeriod = (amount: number, period: 'daily' | 'weekly' | 'monthly'): number => {
  if (period === 'daily') {
    return amount * 365 / 12;
  } else if (period === 'weekly') {
    return amount * 52 / 12;
  } else {
    return amount;
  }
};

interface AssetFormSectionProps {
  params: SimulationParams;
  onChangeParams: (newParams: SimulationParams) => void;
}

type TabType = 'profile' | 'stocks' | 'pensions' | 'other';

export const AssetFormSection: React.FC<AssetFormSectionProps> = ({ params, onChangeParams }) => {
  const [activeTab, setActiveTab] = useState<TabType>('profile');
  const [expandedAssets, setExpandedAssets] = useState<Record<string, boolean>>({});
  const [expandedPensions, setExpandedPensions] = useState<Record<string, boolean>>({});
  const [fetchingPriceMap, setFetchingPriceMap] = useState<Record<string, boolean>>({});
  const [focusedAssetId, setFocusedAssetId] = useState<string | null>(null);
  const [realtimeSuggestions, setRealtimeSuggestions] = useState<Record<string, any[]>>({});
  const [isSearching, setIsSearching] = useState<Record<string, boolean>>({});

  const searchTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});

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
        (onChangeParams as any)((prevParams: SimulationParams) => {
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

  // 1. User Profile update
  const handleProfileChange = (key: keyof SimulationParams['userProfile'], value: number) => {
    onChangeParams({
      ...params,
      userProfile: {
        ...params.userProfile,
        [key]: value,
      },
    });
  };

  // 2. National Pension update
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
    const newId = `asset-${Date.now()}`;
    
    const newAsset: InvestmentAsset = {
      id: newId,
      type: 'etf',
      ticker: 'NEW',
      name: '신규 자산',
      quantity: 0,
      averagePrice: 0,
      annualGrowthRate: 6,
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


  const handleUpdateAsset = (id: string, updates: Partial<InvestmentAsset> | keyof InvestmentAsset, value?: any) => {
    const updated = params.assets.map((asset) => {
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
                averagePrice = Math.round(averagePrice * params.baseExchangeRate);
                monthlyContribution = Math.round(monthlyContribution * params.baseExchangeRate);
                contributionAmount = Math.round(contributionAmount * params.baseExchangeRate);
              } else if (prevCurrency === 'KRW' && nextCurrency === 'USD') {
                averagePrice = Math.round((averagePrice / params.baseExchangeRate) * 100) / 100;
                monthlyContribution = Math.round((monthlyContribution / params.baseExchangeRate) * 100) / 100;
                contributionAmount = Math.round((contributionAmount / params.baseExchangeRate) * 100) / 100;
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
      ? updates === 'annualGrowthRate'
      : 'annualGrowthRate' in updates;
    const presetUpdate = isGrowthRateChanged ? { yieldPreset: 'custom' as const } : {};
    onChangeParams({ ...params, assets: updated, ...presetUpdate });
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
      id: `pension-${Date.now()}`,
      type: 'irp',
      balance: 0,
      monthlyContribution: 0,
      annualReturn: 5,
      currency: 'KRW',
    };
    onChangeParams({
      ...params,
      privatePensions: [...params.privatePensions, newPension],
      yieldPreset: 'custom',
    });
  };

  const handleUpdatePrivatePension = (id: string, key: keyof PrivatePension, value: any) => {
    const updated = params.privatePensions.map((p) => {
      if (p.id === id) {
        if (key === 'currency') {
          const prevCurrency = p.currency;
          const nextCurrency = value as AssetCurrency;
          if (prevCurrency !== nextCurrency) {
            let balance = p.balance;
            let monthlyContribution = p.monthlyContribution;
            if (prevCurrency === 'USD' && nextCurrency === 'KRW') {
              balance = Math.round(balance * params.baseExchangeRate);
              monthlyContribution = Math.round(monthlyContribution * params.baseExchangeRate);
            } else if (prevCurrency === 'KRW' && nextCurrency === 'USD') {
              balance = Math.round((balance / params.baseExchangeRate) * 100) / 100;
              monthlyContribution = Math.round((monthlyContribution / params.baseExchangeRate) * 100) / 100;
            }
            return { ...p, currency: nextCurrency, balance, monthlyContribution };
          }
        }
        return { ...p, [key]: value };
      }
      return p;
    });
    const presetUpdate = key === 'annualReturn' ? { yieldPreset: 'custom' as const } : {};
    onChangeParams({ ...params, privatePensions: updated, ...presetUpdate });
  };

  const handleDeletePrivatePension = (id: string) => {
    onChangeParams({
      ...params,
      privatePensions: params.privatePensions.filter((p) => p.id !== id),
      yieldPreset: 'custom',
    });
  };

  // 5. Other Incomes actions
  const handleAddOtherIncome = () => {
    const newIncome: OtherIncome = {
      id: `income-${Date.now()}`,
      label: '신규 월 소득',
      monthlyAmount: 0,
      currency: 'KRW',
    };
    onChangeParams({
      ...params,
      otherIncomes: [...params.otherIncomes, newIncome],
    });
  };

  const handleUpdateOtherIncome = (id: string, key: keyof OtherIncome, value: any) => {
    const updated = params.otherIncomes.map((income) => {
      if (income.id === id) {
        if (key === 'currency') {
          const prevCurrency = income.currency;
          const nextCurrency = value as AssetCurrency;
          if (prevCurrency !== nextCurrency) {
            let monthlyAmount = income.monthlyAmount;
            if (prevCurrency === 'USD' && nextCurrency === 'KRW') {
              monthlyAmount = Math.round(monthlyAmount * params.baseExchangeRate);
            } else if (prevCurrency === 'KRW' && nextCurrency === 'USD') {
              monthlyAmount = Math.round((monthlyAmount / params.baseExchangeRate) * 100) / 100;
            }
            return { ...income, currency: nextCurrency, monthlyAmount };
          }
        }
        return { ...income, [key]: value };
      }
      return income;
    });
    onChangeParams({ ...params, otherIncomes: updated });
  };

  const handleDeleteOtherIncome = (id: string) => {
    onChangeParams({
      ...params,
      otherIncomes: params.otherIncomes.filter((income) => income.id !== id),
    });
  };

  return (
    <div className={styles.formContainer}>
      {/* Tab Menu */}
      <div className={styles.tabList}>
        <button
          className={`${styles.tabButton} ${activeTab === 'profile' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          <User size={16} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
          기본 인적사항
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === 'stocks' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('stocks')}
        >
          <Landmark size={16} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
          주식 & ETF <span className={styles.numberBadge}>{params.assets.length}</span>
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === 'pensions' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('pensions')}
        >
          <PiggyBank size={16} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
          연금 자산 <span className={styles.numberBadge}>{params.privatePensions.length + 1}</span>
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === 'other' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('other')}
        >
          <DollarSign size={16} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
          기타 소득 <span className={styles.numberBadge}>{params.otherIncomes.length}</span>
        </button>
      </div>

      {/* Tab Panels */}
      <div className={styles.tabContent}>
        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div className={compStyles.grid}>
            <InputField
              label="현재 나이"
              type="number"
              value={params.userProfile.currentAge}
              onChange={(e) => handleProfileChange('currentAge', Number(e.target.value))}
              suffixText="세"
            />
            <InputField
              label="목표 은퇴 나이"
              type="number"
              value={params.userProfile.retirementAge}
              onChange={(e) => handleProfileChange('retirementAge', Number(e.target.value))}
              suffixText="세"
            />
            <InputField
              label="기대 수명"
              type="number"
              value={params.userProfile.expectancy}
              onChange={(e) => handleProfileChange('expectancy', Number(e.target.value))}
              suffixText="세"
            />
            <InputField
              label="은퇴 후 목표 월 생활비"
              labelSecondary="(선택 통화 기준)"
              type="text"
              value={params.userProfile.targetMonthlySpending === 0 ? '0' : params.userProfile.targetMonthlySpending.toLocaleString()}
              onChange={(e) => {
                const rawValue = e.target.value.replace(/,/g, '');
                const numValue = rawValue === '' ? 0 : Number(rawValue);
                if (!isNaN(numValue)) {
                  handleProfileChange('targetMonthlySpending', numValue);
                }
              }}
              suffixText={params.displayCurrency === 'KRW' ? '원' : params.displayCurrency}
            />
          </div>
        )}

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
                <div key={asset.id} className={`${styles.assetCard} ${isExpanded ? styles.assetCardExpanded : ''}`}>
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
                            const val = e.target.value;
                            handleUpdateAsset(asset.id, 'name', val);
                            if (searchTimeoutRef.current[asset.id]) {
                              clearTimeout(searchTimeoutRef.current[asset.id]);
                            }
                            searchTimeoutRef.current[asset.id] = setTimeout(() => {
                              fetchRealtimeSuggestions(asset.id, val);
                            }, 300);
                          }}
                          onFocus={() => setFocusedAssetId(asset.id)}
                          onBlur={() => setTimeout(() => setFocusedAssetId(null), 200)}
                        />
                        {focusedAssetId === asset.id && asset.name && (
                          (() => {
                            const matchingPredefined = predefinedAssets.filter(pa => 
                              pa.name.toLowerCase().includes(asset.name.toLowerCase()) ||
                              pa.ticker.toLowerCase().includes(asset.name.toLowerCase())
                            );
                            
                            const rsList = realtimeSuggestions[asset.id] || [];
                            const predefinedTickers = new Set(matchingPredefined.map(p => p.ticker));
                            const additionalRealtime = rsList
                              .filter((rs: any) => !predefinedTickers.has(rs.ticker))
                              .map((rs: any) => ({
                                ...rs,
                                annualGrowthRate: rs.type === 'etf' ? 7.0 : 6.0,
                                dividendYield: rs.type === 'etf' ? 1.5 : 1.0,
                              }));
                              
                            const combined = [...matchingPredefined, ...additionalRealtime].slice(0, 8);
                            const searching = isSearching[asset.id];
                            
                            if (combined.length === 0 && !searching) return null;
                            
                            return (
                              <div className={styles.autocompleteDropdown}>
                                {combined.map(pa => (
                                  <div
                                    key={pa.ticker}
                                    className={styles.autocompleteItem}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      handleUpdateAsset(asset.id, {
                                        name: pa.name,
                                        ticker: pa.ticker,
                                        type: pa.type,
                                        currency: pa.currency,
                                        annualGrowthRate: pa.annualGrowthRate,
                                        dividendYield: pa.dividendYield,
                                      });
                                      setFocusedAssetId(null);
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
                            size={14}
                            className={fetchingPriceMap[asset.id] ? styles.spinner : ''}
                          />
                        </button>
                      </div>
                      <InputField
                        label="연 성장률"
                        type="number"
                        step="0.1"
                        value={asset.annualGrowthRate}
                        onChange={(e) => handleUpdateAsset(asset.id, 'annualGrowthRate', Number(e.target.value))}
                        suffixText="%"
                      />
                      <InputField
                        label="연 배당률"
                        type="number"
                        step="0.1"
                        value={asset.dividendYield}
                        onChange={(e) => handleUpdateAsset(asset.id, 'dividendYield', Number(e.target.value))}
                        suffixText="%"
                      />
                      <SelectField
                        label="적립 주기"
                        value={asset.contributionPeriod || 'monthly'}
                        onChange={(e) => {
                          const newPeriod = e.target.value as 'daily' | 'weekly' | 'monthly';
                          const currentPeriod = asset.contributionPeriod || 'monthly';
                          const currentAmount = asset.contributionAmount ?? asset.monthlyContribution;

                          let newAmount = convertAmountOnPeriodChange(currentAmount, currentPeriod, newPeriod);
                          if (asset.currency === 'KRW') {
                            newAmount = Math.round(newAmount);
                          } else {
                            newAmount = Math.round(newAmount * 100) / 100;
                          }

                          const newMonthly = calculateMonthlyFromPeriod(newAmount, newPeriod);
                          const roundedMonthly = asset.currency === 'KRW' 
                            ? Math.round(newMonthly) 
                            : Math.round(newMonthly * 100) / 100;

                          handleUpdateAsset(asset.id, {
                            contributionPeriod: newPeriod,
                            contributionAmount: newAmount,
                            monthlyContribution: roundedMonthly,
                          });
                        }}
                        options={[
                          { value: 'daily', label: '매일' },
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
                            const monthlyVal = calculateMonthlyFromPeriod(numValue, period);
                            const roundedMonthly = asset.currency === 'KRW' 
                              ? Math.round(monthlyVal) 
                              : Math.round(monthlyVal * 100) / 100;

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
                          const monthlyVal = calculateMonthlyFromPeriod(nextAmount, period);
                          const roundedMonthly = asset.currency === 'KRW' 
                            ? Math.round(monthlyVal) 
                            : Math.round(monthlyVal * 100) / 100;

                          handleUpdateAsset(asset.id, {
                            contributionAmount: nextAmount,
                            monthlyContribution: roundedMonthly,
                          });
                        }}
                        onStepDown={() => {
                          const currentAmount = asset.contributionAmount ?? asset.monthlyContribution;
                          const nextAmount = Math.max(0, currentAmount - 5000);
                          const period = asset.contributionPeriod || 'monthly';
                          const monthlyVal = calculateMonthlyFromPeriod(nextAmount, period);
                          const roundedMonthly = asset.currency === 'KRW' 
                            ? Math.round(monthlyVal) 
                            : Math.round(monthlyVal * 100) / 100;

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
              <div key={pension.id} className={`${styles.assetCard} ${isExpanded ? styles.assetCardExpanded : ''}`}>
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
                    label="통화(Currency)"
                    value={pension.currency}
                    onChange={(e) => handleUpdatePrivatePension(pension.id, 'currency', e.target.value)}
                    options={[
                      { value: 'KRW', label: 'KRW (원)' },
                      { value: 'USD', label: 'USD ($)' },
                    ]}
                  />
                  <InputField
                    label="현재 적립 잔액"
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
                  <InputField
                    label="연 기대 수익률"
                    type="number"
                    step="0.1"
                    value={pension.annualReturn}
                    onChange={(e) => handleUpdatePrivatePension(pension.id, 'annualReturn', Number(e.target.value))}
                    suffixText="%"
                  />
                </div>
                )}
              </div>
            )})}
            <button className={styles.addButton} onClick={handleAddPrivatePension}>
              <Plus size={16} /> 사적연금 추가
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
    </div>
  );
};
export default AssetFormSection;
