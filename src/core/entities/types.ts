export interface UserProfile {
  currentAge: number;
  retirementAge: number;
  expectancy: number;
  targetMonthlySpending: number; // 기준 통화 기준
}

export type AssetCurrency = 'KRW' | 'USD';

export type AssetMarket = 'US_ETF' | 'KR_ETF' | 'IRP' | 'PENSION' | 'OTHER';

export interface InvestmentAsset {
  id: string;
  type: 'stock' | 'etf';
  ticker: string;
  name: string;
  quantity: number;
  averagePrice: number;
  annualGrowthRate: number; // % 단위, 예: 8% -> 8
  dividendYield: number; // % 단위, 예: 3% -> 3
  contributionPeriod?: 'daily' | 'weekly' | 'monthly';
  contributionAmount?: number;
  monthlyContribution: number;
  reinvestDividend: boolean;
  currency: AssetCurrency;
  assetMarket?: AssetMarket; // 과세 체계 기준
}

export type PrivatePensionType = 'irp' | 'savings' | 'retirement';

export interface PrivatePension {
  id: string;
  type: PrivatePensionType;
  investmentType?: 'custom' | 'deposit' | 'etf';
  ticker?: string;
  name?: string;
  balance: number;
  monthlyContribution: number;
  annualReturn: number; // % 단위 (ETF인 경우 연 성장률로 사용)
  dividendYield?: number; // % 단위 (ETF인 경우 연 배당률)
  currency: AssetCurrency;
}

export interface NationalPension {
  expectedMonthlyAmount: number; // KRW 기준 고정
}

export interface OtherIncome {
  id: string;
  label: string;
  monthlyAmount: number;
  currency: AssetCurrency;
}

export type SpendingStrategy = 'target' | 'dividend_only' | 'max_sustainable';

export interface TaxSettings {
  enableComprehensiveTax: boolean;
  enableHealthInsurance: boolean;
  usDividendTaxRate: number; // % (default: 15)
  domesticDividendTaxRate: number; // % (default: 15.4)
  comprehensiveTaxRate: number; // % (초과분 단순화 세율, default: 15)
  healthInsuranceRate: number; // % (초과분 건보료 비율, default: 5)
  enablePrivatePensionTax?: boolean; // 사적연금 고세율 과세 반영 여부 (default: true)
  privatePensionLimit?: number; // 사적연금 저율과세 한도 (원, default: 15000000)
  privatePensionExcessTaxRate?: number; // 한도 초과 시 세율 (%, default: 16.5)
}

export type IsaAccountType = 'general' | 'low_income';

export interface IsaAccount {
  id: string;
  type: IsaAccountType;
  investmentType?: 'custom' | 'deposit' | 'etf';
  ticker?: string;
  name?: string;
  balance: number;
  monthlyContribution: number;
  annualReturn: number; // % 단위
  dividendYield: number; // % 단위
  currency: AssetCurrency;
  maturityYears: number; // 기본 3년
}

export interface SimulationParams {
  userProfile: UserProfile;
  assets: InvestmentAsset[];
  nationalPension: NationalPension;
  privatePensions: PrivatePension[];
  isaAccounts?: IsaAccount[];
  otherIncomes: OtherIncome[];
  inflationRate: number; // % 단위, 예: 2.5
  inflationMode: 'nominal' | 'real';
  baseExchangeRate: number; // 1 USD = N KRW (예: 1350)
  exchangeScenario: 'base' | 'usd_up' | 'usd_down'; // +10%, -10% 보정
  displayCurrency: AssetCurrency; // 최종 결과 표기용 통화 ('KRW' | 'USD')
  yieldPreset?: 'conservative' | 'base' | 'aggressive' | 'custom';
  spendingStrategy?: SpendingStrategy; // 목표 생활비 달성 전략
  taxSettings?: TaxSettings; // 고급 세금 설정
}

export interface SimulationYearlyResult {
  age: number;
  year: number;
  totalAssets: number; // 기말 자산액 (선택 표기 통화 기준)
  stockAssets: number; // 주식/ETF 자산
  pensionAssets: number; // 사적연금 자산
  dividendIncome: number; // 연간 세후 배당 수령액
  nationalPensionIncome: number; // 연간 세후 국민연금 수령액
  privatePensionIncome: number; // 연간 세후 사적연금 수령액
  pensionIncome: number; // 연간 세후 연금 수령액 (국민+사적)
  otherIncome: number; // 연간 세후 기타 소득
  totalIncome: number; // 연간 총 가처분 소득 (세후)
  
  // 세금 및 공과금 상세 내역
  preTaxTotalIncome: number; // 연간 세전 총소득
  dividendTaxPaid: number; // 배당소득세 납부액
  pensionTaxPaid: number; // 연금소득세 납부액
  nationalPensionTaxPaid: number; // 국민연금 세금 납부액
  healthInsurancePaid: number; // 건강보험료(추가분) 납부액
  comprehensiveTaxPaid: number; // 금융소득종합과세(추가분) 납부액
  
  spending: number; // 연간 총 생활비 인출
  hasTaxWarning: boolean; // 연간 금융소득이 2,000만원 초과 여부

}

export interface SimulationResult {
  yearlyResults: SimulationYearlyResult[];
  fireAge: number | null; // FIRE 달성(소득 >= 생활비) 가능 나이
  depletionAge: number | null; // 자산 고갈 나이 (0 이하가 되는 시점)
  endingAssets: number; // 기대수명(사망) 시점 잔여 자산
  retirementScore: number; // 0 ~ 100 점
  retirementGrade: string; // 점수 등급 (매우 안정, 안정, 보통, 주의, 위험)
  goalAchievementRate: number; // 은퇴 후 예상 월소득 / 목표 월소득 비율 (%)
  calculatedTargetSpending?: number; // 역산된 목표 생활비 (max_sustainable 모드 등에서 사용)
}

export interface ScenarioModel {
  id: string;
  name: string;
  isDefault: boolean;
  data: SimulationParams;
  createdAt: string;
  updatedAt: string;
}
