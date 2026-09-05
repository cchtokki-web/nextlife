import { SimulationParams, InvestmentAsset, UserProfile } from '../entities/types';
import { v4 as uuidv4 } from 'uuid';
import { resolveTaxSettings } from './tax/taxRates';
import { DEFAULT_PLAN_HORIZON_AGE } from './planHorizon';

export type InvestmentPropensity = 'conservative' | 'neutral' | 'aggressive';

/** 투자 성향 하나가 뜻하는 수익률 가정. 단위는 %다(7% → 7). */
export interface PropensityReturnAssumption {
  /** 배당을 «포함한» 총수익률. [[총수익률과 배당수익률]] */
  totalReturn: number;
  /** 총수익률 «안에» 들어 있는 분배 성분. totalReturn과 더하지 않는다. */
  dividendYield: number;
}

/**
 * 랜딩 간단 시뮬레이터의 성향별 수익률 가정 — 이 표가 유일한 출처다.
 *
 * 화면의 결과 카드도 이 표를 읽는다. 예전에는 카드에 총수익률 이관(2026-08-19) 이전의
 * 성장률(1/3/8%)이 손으로 적혀 있었고, 어댑터만 총수익률로 옮겨져 화면과 엔진 입력이
 * 갈라졌다. 숫자를 두 곳에 적지 않는 것이 그 어긋남을 막는 유일한 방법이다.
 *
 * 숫자 자체는 이관 전후로 같은 포트폴리오를 뜻한다 — 예전 성장률 + 배당률이 지금의
 * totalReturn이다.
 */
export const PROPENSITY_RETURN_ASSUMPTIONS: Record<InvestmentPropensity, PropensityReturnAssumption> = {
  conservative: { totalReturn: 4.0, dividendYield: 3.0 }, // 예적금·채권 위주
  neutral: { totalReturn: 7.0, dividendYield: 4.0 },      // 배당 ETF·채권 혼합
  aggressive: { totalReturn: 9.5, dividendYield: 1.5 },   // 성장형 ETF
};

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
    const { totalReturn, dividendYield } = PROPENSITY_RETURN_ASSUMPTIONS[propensity];

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
