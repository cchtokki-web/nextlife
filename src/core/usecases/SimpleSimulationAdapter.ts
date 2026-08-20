import { SimulationParams, InvestmentAsset, UserProfile } from '../entities/types';
import { v4 as uuidv4 } from 'uuid';
import { resolveTaxSettings } from './tax/taxRates';
import { DEFAULT_PLAN_HORIZON_AGE } from './planHorizon';

export type InvestmentPropensity = 'conservative' | 'neutral' | 'aggressive';

export interface SimpleSimulationInput {
  currentAge: number;
  retirementAge: number;
  currentAssets: number; // 원 단위
  monthlyInvestment: number; // 원 단위
  nationalPension: number; // 월 수령액 (원 단위)
  targetMonthlySpending: number; // 월 목표 생활비 (원 단위)
  propensity: InvestmentPropensity;
}

export class SimpleSimulationAdapter {
  static adapt(input: SimpleSimulationInput): SimulationParams {
    const {
      currentAge,
      retirementAge,
      currentAssets,
      monthlyInvestment,
      nationalPension,
      targetMonthlySpending,
      propensity
    } = input;

    // 기본 가정치 설정
    //
    // 기대수명은 제품 전체가 쓰는 기본값을 그대로 쓴다. 여기에 따로 적어 두면 랜딩이
    // 세운 계획과 시뮬레이터가 이어받는 계획이 서로 다른 기간을 뜻하게 된다.
    const expectancy = DEFAULT_PLAN_HORIZON_AGE;
    const inflationRate = 2.0; // 연 물가상승률 2%
    const inflationMode = 'real'; // 실질가치 기준
    const baseExchangeRate = 1400; // 환율 무관 (KRW로만 계산)

    // 성향에 따른 수익률 및 배당률 설정 (안전추구, 중립, 공격형)
    let totalReturn = 0;
    let dividendYield = 0;
    
    switch (propensity) {
      case 'conservative':
        // 예적금, 채권 위주
        totalReturn = 4.0; // 예전 성장률 1.0 + 배당 3.0 (총수익률 표기로 이관)
        dividendYield = 3.0; // 이자 수익
        break;
      case 'neutral':
        // 배당 ETF, 채권 혼합
        totalReturn = 7.0; // 예전 성장률 3.0 + 배당 4.0 (총수익률 표기로 이관)
        dividendYield = 4.0;
        break;
      case 'aggressive':
        // 성장형 ETF
        totalReturn = 9.5; // 예전 성장률 8.0 + 배당 1.5 (총수익률 표기로 이관)
        dividendYield = 1.5;
        break;
    }

    // 투자 자산으로 매핑
    const asset: InvestmentAsset = {
      id: uuidv4(),
      type: 'etf', // 단순화를 위해 etf 타입으로 취급
      ticker: propensity === 'conservative' ? '안전자산' : (propensity === 'neutral' ? '혼합자산' : '성장자산'),
      name: propensity === 'conservative' ? '예금/채권 혼합' : (propensity === 'neutral' ? '배당ETF/채권 혼합' : '성장형 ETF'),
      quantity: 1, // 수량 1개로 통치고 단가 = 총자산
      averagePrice: currentAssets,
      totalReturn,
      dividendYield,
      monthlyContribution: monthlyInvestment,
      reinvestDividend: true, // 배당 재투자 가정
      currency: 'KRW',
      assetMarket: 'KR_ETF', // 과세 체계는 국내 상장 기준으로 단순화
    };

    const userProfile: UserProfile = {
      currentAge,
      retirementAge,
      expectancy,
      targetMonthlySpending,
    };

    const defaultTaxSettings = resolveTaxSettings();

    return {
      userProfile,
      assets: currentAssets > 0 || monthlyInvestment > 0 ? [asset] : [],
      nationalPension: { expectedMonthlyAmount: nationalPension },
      privatePensions: [],
      isaAccounts: [],
      otherIncomes: [],
      inflationRate,
      inflationMode,
      baseExchangeRate,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
      spendingStrategy: 'target', // 고정 생활비
      taxSettings: defaultTaxSettings,
    };
  }
}
