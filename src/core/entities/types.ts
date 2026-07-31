import { RetirementGrade } from './retirementGrade';

export interface UserProfile {
  currentAge: number;
  retirementAge: number;
  expectancy: number;
  targetMonthlySpending: number; // 기준 통화 기준
  // 기대수명 시점에 남기고 싶은 목표 상속자산(기준 통화 기준). 미지정 시 UtilityEngine의 기존
  // 공식(목표 월생활비 * appropriateBequestMonths)으로 적정 잔여자산을 대신 추정한다. 0으로
  // 설정하면 "상속하지 않고 다 쓰고 간다"는 명시적 목표를 의미한다.
  targetBequest?: number;
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

// PrivatePension/IsaAccount가 공유하는 계좌 내 운용 방식. 이름 있는 타입으로 추출해 두 곳이
// 같은 개념을 공유한다는 것을 명시하고, 한쪽만 variant가 추가되는 drift를 막는다.
export type AccountInvestmentType = 'custom' | 'deposit' | 'etf';

export interface PrivatePension {
  id: string;
  type: PrivatePensionType;
  investmentType?: AccountInvestmentType;
  ticker?: string;
  name?: string;
  balance: number;
  monthlyContribution: number;
  annualReturn: number; // % 단위 (ETF인 경우 연 성장률로 사용)
  dividendYield?: number; // % 단위 (ETF인 경우 연 배당률)
  currency: AssetCurrency;
  // 사적연금 조기수령 채널링(Phase 4) 전용 내부 필드. true면 55세(PRIVATE_PENSION_MIN_START_AGE)부터
  // retirementAge 이전(재직 중)에도 저율과세 한도 내에서 조기 인출해 ISA로 재투자한다. AI 추천
  // 엔진(PrivatePensionChannelingOptimizer)만 설정하며, 사용자가 직접 켜는 입력 폼 필드가 아니다.
  //
  // true는 "허용"일 뿐 발동을 보장하지 않는다 — 실제 발동 조건(재직 중/55세 이상/잔액 존재/ISA
  // 계좌 존재)은 SimulationEngine.ts의 브릿지 분기(earlyChannelingEnabled 사용처)를 source of
  // truth로 삼는다. 여기서 조건을 다시 나열하지 않는 이유는, 두 곳을 강제로 동기화하는 장치가
  // 없어 SimulationEngine.ts 쪽 조건이 바뀌면 이 주석만 조용히 stale해지기 때문이다. 조건을
  // 하나라도 못 채우면 조기 인출은 조용히 발동하지 않는다(경고/에러 없이 무시).
  earlyChannelingEnabled?: boolean;
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
  privatePensionMonthlyTarget?: number; // 월 목표 인출액(KRW 기준, 세전). 계좌 합산 기준, 잔액 한도 내에서 제한
  nationalPensionStartAge?: number; // 국민연금 수령 개시 나이 (60~70, 미지정 시 65 = 기존 동작과 동일)
  assetSellOrderStrategy?: AssetSellOrderStrategy; // 자산 매도 순서 (미지정 시 'input_order' = 기존 동작과 동일)
  isaMaturityDestination?: IsaMaturityDestination; // ISA 만기 자금 이동 목적지 (미지정 시 'pension' = 기존 동작과 동일)
  generalAssetWithdrawalStartAge?: number; // 일반자산(주식/ETF) 인출 개시 나이 (미지정 시 retirementAge = 기존 동작과 동일)
  // 목표 생활비(userProfile.targetMonthlySpending) 배수 조정 (미지정 시 1 = 기존 동작과 동일).
  // 다른 필드와 달리 "언제/어떤 순서로 인출하느냐"가 아니라 "얼마나 쓰느냐"를 조정하지만,
  // SimulationEngine 변경 없이 RecommendationEngine이 targetMonthlySpending을 스케일링한
  // params로 재시뮬레이션하는 방식으로 지원하기 위해 여기 포함한다.
  monthlySpendingMultiplier?: number;
}

// StrategyCandidateGenerator가 만드는 후보처럼 필드가 모두 채워진 "완결된" 인출 전략.
// WithdrawalPlan은 "부분 override 패치"(일부 필드만 지정)로도 쓰이는 반면, 이 타입은 그 의미를
// 컴파일 타임에 구분하기 위한 것이다 (예: StrategyRecommendation.recommendedPlan).
export type CompleteWithdrawalPlan = Required<WithdrawalPlan>;

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
  enablePensionComprehensiveComparison?: boolean; // 사적연금 한도초과 시 분리과세(16.5%)와 종합소득세 누진세율
                                                    // 단순비교 중 유리한 쪽 선택 여부 (default: true).
                                                    // enablePrivatePensionTax가 false면 이 값과 무관하게 초과세 자체가 없다.
}

// 사적연금 한도초과세 적용 방식. 'none'은 한도 이하이거나 enablePrivatePensionTax=false인 경우.
export type PrivatePensionTaxationMethod = 'none' | 'separate' | 'comprehensive';

export type IsaAccountType = 'general' | 'low_income';

export interface IsaAccount {
  id: string;
  type: IsaAccountType;
  investmentType?: AccountInvestmentType;
  ticker?: string;
  name?: string;
  balance: number;
  monthlyContribution: number;
  annualReturn: number; // % 단위
  dividendYield: number; // % 단위
  currency: AssetCurrency;
  maturityYears: number; // 기본 3년
}

// 자산/사적연금별 "사용자 프리셋"(직접입력 수익률) 스냅샷. 시장 수익률 프리셋(보수적/기본값/
// 공격적)으로 전환하면 자산의 annualGrowthRate/annualReturn이 프리셋 값으로 덮어써지므로, 그
// 직전 시점의 직접입력 값을 id 기준으로 보존해 두었다가 "사용자 프리셋" 재선택 시 되돌린다.
export interface CustomYieldSnapshot {
  assets: Record<string, number>; // InvestmentAsset.id -> annualGrowthRate
  privatePensions: Record<string, number>; // PrivatePension.id -> annualReturn
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
  customYieldSnapshot?: CustomYieldSnapshot; // "사용자 프리셋" 복원용 저장값
  spendingStrategy?: SpendingStrategy; // 목표 생활비 달성 전략
  taxSettings?: TaxSettings; // 고급 세금 설정
  withdrawalPlan?: WithdrawalPlan; // 인출 정책 및 생활비 조정 (미지정 시 기존 균등분할 인출 로직 사용)
  strategy?: RetirementStrategy; // 은퇴 전략 설정 (미지정 시 compileStrategy가 입력을 그대로 통과)
  spouse?: SpouseProfile;
  healthcare?: HealthcareAssumptions;
  taxLawVersion?: TaxLawVersion;
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
  privatePensionTaxMethod: PrivatePensionTaxationMethod; // 사적연금 한도초과세 적용 방식

  spending: number; // 연간 총 생활비 인출
  hasTaxWarning: boolean; // 연간 금융소득이 2,000만원 초과 여부

  // 해당 연도 배우자 생존 여부. 배우자 미설정이면 항상 false다
  // (배우자가 없는 것과 사망한 것을 결과 타입에서 구분하지 않는다 —
  //  구분이 필요한 소비처는 params.spouse를 함께 본다).
  spouseAlive: boolean;
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
  // 연금 활용도(pensionUtilization) 서브 지표 가중치 (합 = 1). 국민연금 수급 여부 +
  // 사적연금 실인출 활용도 + 저율과세 한도 준수도를 종합해 15점 배점 안에서 재분배한다.
  pensionUtilizationSubWeights: {
    nationalPension: number; // 국민연금 수급 연도 비율 (기본 0.4)
    privatePensionWithdrawal: number; // 사적연금 실인출 연도 비율 (기본 0.4)
    privatePensionTaxEfficiency: number; // 사적연금 저율과세 한도 준수도 (기본 0.2)
  };
  privatePensionEffectiveTaxCeiling: number; // 사적연금 실효세율(연금세/(순인출+연금세))이 이 값에 도달하면
                                              // privatePensionTaxEfficiency 서브점수가 0이 됨 (기본 0.10)
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
  recommendedPlan: CompleteWithdrawalPlan | null;
  // assetId -> 권장 reinvestDividend 값(Phase 3: 배당 재투자 최적화). recommendedPlan과 달리
  // WithdrawalPlan이 아니라 은퇴 "전" 축적기 파라미터(자산 배열 내부 값)라 별도 필드로 분리했다.
  // 변경 권장이 없으면(자산 없음/개선 없음/통합 검증 실패) null.
  recommendedAssetReinvestment: Record<string, boolean> | null;
  // 사적연금 조기수령 채널링(Phase 4-A) 권장 여부. 채택되면 true, 아니면 null(전제 조건
  // 불충족 또는 개선 없음). recommendedPlan/recommendedAssetReinvestment와 마찬가지로 독립된
  // 축(축적기 파라미터 중에서도 은퇴 전 인출이라는 새로운 층위)이다.
  // false는 생산되지 않는다 — 사용자가 직접 켤 수 있는 설정이 아니므로 "끄라는 추천"이 존재할 수 없다
  // (사용자 설정값을 뒤집을 수 있는 recommendedAssetReinvestment와의 결정적 차이).
  recommendedPrivatePensionChanneling: true | null;
  // 신규 연금계좌 추가 납입(Phase 4-B) 권장 여부. 채택되면 true, 아니면 null.
  // 채널링과는 완전히 독립된 후보로 각각 baseline 대비 평가된다.
  recommendedNewPensionContribution: true | null;
  // 채널링(Phase 4-A) 채택 시 "기존 연금 계좌 납입 중단 후 새 계좌로 이전" 행동이 실제로
  // 포함되는지. recommendedPrivatePensionChanneling이 true일 때만 의미가 있고, 그 외에는 false다
  // (채널링 대상 계좌 전부가 이미 납입 0이면 이전용 계좌가 생기지 않는다).
  channelingIncludesAccountTransfer: boolean;
  improved: boolean; // recommendedUtility.score > currentUtility.score 여부를 미리 계산해 둔 값. 소비처마다 재계산하지 않는다.
  reasons: string[];
  deltas: {
    lifetimeConsumption: number; // 평생 소비(생활비 인출) 총액 변화
    totalTax: number; // 평생 총세금 변화
    endingAssets: number; // 사망 시 잔여 자산 변화
    pensionEndingBalance: number; // 사망 시 연금잔액 변화
    comprehensiveTaxYears: number; // 금융소득종합과세 발생 연수 변화
    healthInsuranceTotal: number; // 평생 건강보험료(추가분) 변화
    nationalPensionTotal: number; // 평생 국민연금 총 수령액 변화
  };
  totalCandidateCount: number; // 평가를 시도한 후보 전략 수 (탐색할 차원이 없으면 0)
  failedCandidateCount: number; // 그중 SimulationEngine 실행이 실패해 건너뛴 후보 수
  // 추천 전략(recommendedPlan) 적용 시 전체 연도별 시뮬레이션 결과. improved가 false이면
  // baseline과 동일한 결과(currentUtility를 만든 결과)가 그대로 채워진다. 결과 화면의
  // Before(baseline)/After(recommendedResult) 비교에 사용한다.
  recommendedResult: SimulationResult;
  // 개별 변경 항목의 독립적(marginal) 효과 목록. 두 종류의 항목이 섞여 있고 기준점(reference)이
  // 서로 다르다:
  //   (1) 인출계획(Phase 1/2) 항목: recommendedPlan이 identityPlan 대비 실제로 바뀐 필드 각각에
  //       대해, "그 필드 하나만 진짜 baseline에 적용했을 때"의 효과 (기준점 = 진짜 baseline).
  //   (2) 배당 재투자(Phase 3) 항목: 이미 인출계획이 최적화된 상태(bestResult) 대비 각 자산의
  //       reinvestDividend 반전 효과 (기준점 = 인출계획 최적화 후 상태, 진짜 baseline 아님).
  // 각 단계의 고유 기여분을 분리해 두 단계가 telescope되도록 하려는 의도적 설계다(phase1/2-delta
  // + phase3-delta ≈ total-delta). 필드/자산 간 상호작용도 반영하지 않으므로, 이 배열의
  // utilityDelta 합계는 (recommendedUtility.score - currentUtility.score)를 근사할 뿐 정확히
  // 일치하지 않을 수 있다. improved가 false이면 빈 배열이다.
  itemizedContributions: ItemizedContribution[];
}

export interface ItemizedContribution {
  label: string; // 사용자 친화적 문구 (예: "국민연금을 70세까지 연기 수령")
  // 이 변경 하나만 적용했을 때의 Utility 증가분(marginal). 기준점은 항목 종류에 따라 다르다:
  // 인출계획(Phase 1/2) 항목은 진짜 baseline 대비, 배당 재투자(Phase 3) 항목은 인출계획이
  // 최적화된 상태(bestResult) 대비다(itemizedContributions 필드 주석 참고).
  utilityDelta: number;
  // 동일 변경의 절세/자산증가 등 전체 delta. utilityDelta와 동일한 기준점을 사용한다.
  deltas: StrategyRecommendation['deltas'];
}

// ── 은퇴 전략 설정 ────────────────────────────────────────────────────────
// 아래 enum들은 "사용자 언어"이며 SimulationEngine은 이 타입들을 알지 못한다.
// compileStrategy()가 저수준 파라미터(withdrawalPlan/taxSettings/yieldPreset 등)로
// 번역한 뒤에야 엔진에 들어간다.

export type StrategyMode = 'simple' | 'standard' | 'expert';

// 모든 계산의 목적 함수. UtilityConfig.weights 프리셋으로 번역된다.
export type ObjectivePriority =
  | 'lifetime_spending'
  | 'tax_minimization'
  | 'wealth_maximization'
  | 'bequest_maximization'
  | 'ai_recommended';

// 엔진의 SpendingStrategy 3종 + 'ai'. 'ai'는 엔진에 없는 값이라 compileStrategy가
// 'target'으로 내리고, AI가 제안한 생활비는 화면에 힌트로만 노출한다.
// 선택 상태 자체는 strategy.spendingChoice에 남으므로 화면에서 사라지지 않는다.
export type SpendingStrategyChoice = SpendingStrategy | 'ai';

export type BequestStrategy = 'spend_all' | 'leave_some' | 'maximize' | 'target_amount';

export type NationalPensionStrategy =
  | 'normal' | 'defer_1y' | 'defer_2y' | 'defer_max' | 'ai_optimized';

export type PrivatePensionStrategy =
  | 'tax_first' | 'spending_first' | 'growth_first' | 'minimum' | 'ai_optimized';

export type RiskProfile = 'conservative' | 'neutral' | 'aggressive' | 'ai_recommended';

export type EconomicScenario =
  | 'long_term_average' | 'recession' | 'high_inflation' | 'low_growth' | 'ai_recommended';

// 현재는 'current' 하나뿐이다. 실제 개정안이 확정되면 프로필을 추가한다
// (허구의 개정안을 지어내지 않는다는 것이 설계 결정이다).
export type TaxLawVersion = 'current';

export interface RetirementStrategy {
  mode: StrategyMode;
  objective: ObjectivePriority;
  spendingChoice: SpendingStrategyChoice;
  bequestStrategy: BequestStrategy;
  nationalPensionStrategy: NationalPensionStrategy;
  privatePensionStrategy: PrivatePensionStrategy;
  preferIsaFirst: boolean;
  reinvestDividends: boolean;
  riskProfile: RiskProfile;
  economicScenario: EconomicScenario;
}

// 배우자. 자산/ISA/사적연금 계좌는 가구 합산 하나로 유지하고, 여기서는 생존 기간과
// 국민연금만 분리한다(설계 결정: 계좌 소유자 분리는 이번 범위 밖).
export interface SpouseProfile {
  enabled: boolean;
  currentAge: number;
  expectancy: number;
  nationalPensionMonthlyAmount: number; // 65세 기준 금액 (본인과 동일 해석)
  nationalPensionStartAge: number; // 60~70
}

export interface HealthcareAssumptions {
  enabled: boolean;
  costGrowthRate: number; // 의료비 증가율 %
  baseMonthlyCost: number; // 은퇴 시점 기준 월 의료비 (오늘 화폐가치)
  longTermCareEnabled: boolean;
  longTermCareStartAge: number;
  longTermCareMonthlyCost: number;
  shockEnabled: boolean;
  shockAge: number;
  shockAmount: number; // 일회성 목돈
}

export interface ScenarioModel {
  id: string;
  name: string;
  isDefault: boolean;
  data: SimulationParams;
  createdAt: string;
  updatedAt: string;
}
