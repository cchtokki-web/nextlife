import { RetirementGrade } from './retirementGrade';

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

export type AssetSellOrderStrategy = 'input_order' | 'low_dividend_first' | 'high_dividend_first';
export type IsaMaturityDestination = 'pension' | 'asset';

export interface WithdrawalPlan {
  privatePensionStartAge?: number; // 사적연금 인출 개시 나이 (미지정 시 retirementAge)
  privatePensionMonthlyTarget?: number; // 월 목표 인출액(KRW 기준, 세전). 계좌 합산 기준, 잔액 한도 내에서 제한
  nationalPensionStartAge?: number; // 국민연금 수령 개시 나이 (60~70, 미지정 시 65 = 기존 동작과 동일)
  assetSellOrderStrategy?: AssetSellOrderStrategy; // 자산 매도 순서 (미지정 시 'input_order' = 기존 동작과 동일)
  isaMaturityDestination?: IsaMaturityDestination; // ISA 만기 자금 이동 목적지 (미지정 시 'pension' = 기존 동작과 동일)
  generalAssetWithdrawalStartAge?: number; // 일반자산(주식/ETF) 인출 개시 나이 (미지정 시 retirementAge = 기존 동작과 동일)
}

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
  limitPrivatePensionToTaxLimit?: boolean; // 사적연금 저율과세 한도 내 인출 여부 (default: false)
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
  withdrawalPlan?: WithdrawalPlan; // 사적연금 인출 정책 (미지정 시 기존 균등분할 인출 로직 사용)
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
  retirementGrade: RetirementGrade; // 점수 등급 (매우 안정, 안정, 보통, 주의, 위험)
  goalAchievementRate: number; // 은퇴 후 예상 월소득 / 목표 월소득 비율 (%)
  calculatedTargetSpending?: number; // 역산된 목표 생활비 (max_sustainable 모드 등에서 사용)
  retirementAssetsAtRetirement: number; // 은퇴 시작 시점 총자산 (해석/배너 표시용)
  utility?: UtilityBreakdown; // Lifetime Utility Score
  recommendation?: StrategyRecommendation; // AI 추천 전략 (별도 계산 시에만 채워짐)
}

export interface UtilityConfig {
  weights: {
    consumption: number; // 생활수준 유지 + 소비 만족도 (기본 35점)
    depletionSafety: number; // 자산 고갈 방지 (기본 20점)
    pensionUtilization: number; // 연금 활용 효율 (기본 15점)
    taxEfficiency: number; // 세금 효율 (기본 10점)
    taxationRisk: number; // 금융소득종합과세/건강보험료 위험 (기본 10점)
    bequestAdequacy: number; // 상속 자산 적정성 (기본 10점)
  };
  appropriatePensionBalanceMonths: number; // 사망 시 적정 연금잔액 = 월 목표생활비 * N개월 (기본 12)
  appropriateBequestMonths: number; // 사망 시 적정 총자산 = 월 목표생활비 * N개월 (기본 24)
  taxBurdenCeiling: number; // 평생 세부담률이 이 값에 도달하면 taxEfficiency 0점 (기본 0.3)
  healthInsuranceCeiling: number; // 건강보험료/총소득 비율이 이 값에 도달하면 taxationRisk 산식의 건보료
                                   // 페널티 하위항목(가중치 0.3)이 최대치가 됨(taxationRisk 전체가 0점이
                                   // 되는 건 아니며, hasTaxWarning 비율(가중치 0.7)에도 함께 영향받음) (기본 0.05)
}

export interface UtilityBreakdown {
  score: number; // 0~100 Lifetime Utility Score
  components: {
    consumption: number;
    depletionSafety: number;
    pensionUtilization: number;
    taxEfficiency: number;
    taxationRisk: number;
    bequestAdequacy: number;
  };
}

export interface StrategyRecommendation {
  currentUtility: UtilityBreakdown; // 기존 로직(baseline) Utility
  recommendedUtility: UtilityBreakdown; // 최고점 후보 Utility
  // baseline보다 Utility가 개선되는 후보를 찾았을 때만 해당 WithdrawalPlan이 채워지고, 그렇지
  // 않으면 null(= baseline 유지 권장). "부분 override 패치"인 WithdrawalPlan과 달리 여기서는
  // "AI가 확정한 완결된 결정" 또는 "결정 없음"이라는 의미로만 쓰인다.
  recommendedPlan: WithdrawalPlan | null;
  improved: boolean; // recommendedUtility.score > currentUtility.score 여부를 미리 계산해 둔 값. 소비처마다 재계산하지 않는다.
  reasons: string[];
  deltas: {
    lifetimeConsumption: number; // 평생 소비(생활비 인출) 총액 변화
    totalTax: number; // 평생 총세금 변화
    endingAssets: number; // 사망 시 잔여 자산 변화
    pensionEndingBalance: number; // 사망 시 연금잔액 변화
    comprehensiveTaxYears: number; // 금융소득종합과세 발생 연수 변화
    healthInsuranceTotal: number; // 평생 건강보험료(추가분) 변화
  };
}

export interface ScenarioModel {
  id: string;
  name: string;
  isDefault: boolean;
  data: SimulationParams;
  createdAt: string;
  updatedAt: string;
}
