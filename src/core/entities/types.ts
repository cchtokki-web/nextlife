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
  // 총 취득원가(자산 통화 기준). 양도소득세 과세표준(매도액 − 취득원가)에 쓴다.
  //
  // averagePrice는 취득단가가 **아니다** — 화면 라벨이 "현재 단가"이고 시세 조회 버튼이
  // 시장가로 덮어쓴다. 즉 이 앱에는 원래 취득원가 데이터가 존재하지 않았다.
  //
  // 미지정이면 엔진이 quantity × averagePrice(= 현재 평가액)를 취득원가로 본다. 그러면
  // 지금까지 쌓인 평가차익에는 세금이 붙지 않는다 — 확정되지 않은 숫자를 지어내는 대신
  // 사용자가 입력하지 않은 부분을 과세하지 않는 쪽을 택했다. 입력 폼에 그 뜻을 명시한다.
  acquisitionCostBasis?: number;
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

// 연도별 시장 수익률 충격(%p). 인덱스 y = 시뮬레이션 y번째 해(0 = 현재 나이).
//
// 모든 주식/ETF 자산·사적연금·ISA의 **연 수익률에 가산**된다. 배당수익률·현금 이자율·
// 물가·환율은 건드리지 않는다:
//   - 배당률: 주가보다 훨씬 안정적이고, 흔들면 소득 라인을 타고 종합과세·건보료·FIRE
//     판정까지 파급되어 폭발반경이 크다. 자산 평가액이 흔들리면 배당액은 어차피 함께 움직인다.
//   - 현금 이자율: 예금 이자이지 시장 수익률이 아니다.
//   - 물가: 8곳 이상(생활비·연금·기타소득·의료비·실질 차감)에 파급되어 별도 경로가 필요하다.
//   - 환율: exchangeScenario라는 3값 이산 모델이 이미 있다.
//
// 자산별로 다른 충격을 주지 않고 시장 요인 하나를 공유하는 이유: 이 앱에는 상관행렬
// 입력이 없다. 자산별 독립 충격을 주면 자산을 잘게 쪼갠 사용자일수록 분산 효과로 자동으로
// 안전해지는 가짜 결과가 나온다. computeSensitivityAnalysis.shiftReturn이 이미 쓰는
// "시장 전체가 함께 움직인다"는 관례를 따르되, 값을 고정하는 대신 해마다 다르게 한다.
//
// 가산(%p)이라 inflationMode와 무관하게 동작한다: 실질 모드의 (기본 − 물가) + 충격은
// 명목 모드의 (기본 + 충격) − 물가와 같다.
//
// 길이가 시뮬레이션 연수보다 짧으면 남은 해는 충격 0으로 본다(던지지 않는다).
export type ReturnShockPath = readonly number[];

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

// 추천 엔진이 다루는 계획. CompleteWithdrawalPlan과 달리 privatePensionMonthlyTarget만
// 없을 수 있다.
//
// 그 필드가 미지정일 때 엔진의 기본 동작은 "잔여 개월 균등분할"이라 특정 금액으로 표현할
// 수 없다. 사용자가 정액 인출을 지정하지 않았는데 임의의 값을 채우면, 기준선(identity plan)이
// 사용자의 실제 계획과 다른 계획이 되어 그 위에 쌓인 모든 비교가 틀어진다.
export type BaselineWithdrawalPlan =
  Omit<CompleteWithdrawalPlan, 'privatePensionMonthlyTarget'>
  & { privatePensionMonthlyTarget?: number };

export type ComprehensiveTaxMode = 'progressive_credit' | 'flat';

export interface TaxSettings {
  enableComprehensiveTax: boolean;
  enableHealthInsurance: boolean;
  usDividendTaxRate: number; // % (default: 15)
  domesticDividendTaxRate: number; // % (default: 15.4)
  // 금융소득종합과세 초과분을 어떻게 계산할 것인가.
  //
  // 'progressive_credit'(기본): 실제 세법과 같은 비교과세 구조. 초과분에 종합소득세 누진세율을
  //   적용한 뒤, 이미 원천징수된 세액을 기납부세액으로 공제한다. 배당 3,000만원이면 초과분
  //   1,000만원 × 6% = 60만원인데 원천징수 상당액이 154만원이라 추가 납부는 0원이다.
  // 'flat': 초과분에 comprehensiveTaxRate를 그대로 곱하는 예전 단순 모델. 원천징수를 공제하지
  //   않아 초과분에 이중으로 세금이 붙는다(15.4% + 15%). 값을 직접 지정해 비교해 보고 싶은
  //   사용자를 위해 남겨 둔다.
  comprehensiveTaxMode?: ComprehensiveTaxMode; // default: 'progressive_credit'
  comprehensiveTaxRate: number; // % (초과분 단순화 세율, 'flat' 모드에서만 쓰임, default: 15)
  healthInsuranceRate: number; // % (초과분 건보료 비율, default: 5)
  // 해외주식·ETF 양도소득세 반영 여부 (default: true).
  //
  // 기본값이 true인 이유: false로 두면 "가장 큰 누락"이 기본 경로에 그대로 남는다.
  // 은퇴 후 생활비를 자산 매도로 충당하는 계획에서 매도차익 과세가 0원이면 잔여자산과
  // 고갈 나이가 낙관 방향으로 계통 편향된다.
  enableCapitalGainsTax?: boolean;
  capitalGainsTaxRate?: number; // % (미지정 시 세법 프로필의 22%)
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

// 자산/사적연금/ISA별 "사용자 프리셋"(직접입력 수익률) 스냅샷. 시장 수익률 프리셋(보수적/기본값/
// 공격적)으로 전환하면 자산의 annualGrowthRate/annualReturn이 프리셋 값으로 덮어써지므로, 그
// 직전 시점의 직접입력 값을 id 기준으로 보존해 두었다가 "사용자 프리셋" 재선택 시 되돌린다.
export interface CustomYieldSnapshot {
  assets: Record<string, number>; // InvestmentAsset.id -> annualGrowthRate
  privatePensions: Record<string, number>; // PrivatePension.id -> annualReturn
  // IsaAccount.id -> annualReturn. ISA가 프리셋 대상에 들어오기 전에 저장된 스냅샷에는
  // 이 키가 없으므로 optional이다 — 필수로 바꾸면 이미 저장된 시나리오가 타입과 어긋난다.
  isaAccounts?: Record<string, number>;
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
  useLatestExchangeRate?: boolean; // 실시간 환율 자동 조회 여부 (미지정 시 true = 기존 동작)
  yieldPreset?: 'conservative' | 'base' | 'aggressive' | 'custom';
  customYieldSnapshot?: CustomYieldSnapshot; // "사용자 프리셋" 복원용 저장값
  spendingStrategy?: SpendingStrategy; // 목표 생활비 달성 전략
  // 상속 하한선(displayCurrency 기준). 총자산이 이 금액 아래로 내려가는 인출을 하지 않는다.
  // 미지정·0이면 하한선 없음(= 기존 동작과 비트 단위로 동일).
  //
  // withdrawalPlan이 아니라 최상위에 두는 이유: 이것은 "언제/어떤 순서로 인출하느냐"는
  // 결정이 아니라 시뮬레이션 전체에 걸린 제약이다. 후보 탐색은 withdrawalPlan을 통째로
  // 교체하므로(paramsWithBaselinePlan) 그 안에 두면 모든 후보 평가에서 조용히 사라진다.
  //
  // userProfile.targetBequest와 다르다. 그쪽은 채점 기준(적정선)이고 이쪽은 엔진 제약이다.
  // 기본 상속 전략('leave_some')은 targetBequest를 채우지만 하한선은 세우지 않는다 —
  // 세우면 전략을 저장한 적 없는 모든 시나리오의 곡선이 조용히 바뀐다.
  assetFloor?: number;
  // 쓰고 남은 현금(SimulationYearlyResult.cashAssets)에 붙는 연 수익률 %.
  // 미지정·0이면 이자가 붙지 않는다(= 기존 동작과 비트 단위로 동일).
  //
  // **기본값을 0이 아닌 값으로 바꾸면 안 된다.** 저장된 모든 시나리오가 0으로 계산돼 있어,
  // 기본값을 올리는 순간 사용자가 아무것도 건드리지 않았는데 숫자가 달라진다.
  //
  // inflationMode를 다른 자산과 똑같이 따른다: 실질 기준이면 물가를 뺀 만큼만 불어나고,
  // 물가보다 낮은 이율이면 실제로 줄어든다. 현금을 쌓아 두는 대가가 그대로 드러나야 한다.
  cashYieldRate?: number;
  taxSettings?: TaxSettings; // 고급 세금 설정
  withdrawalPlan?: WithdrawalPlan; // 인출 정책 및 생활비 조정 (미지정 시 기존 균등분할 인출 로직 사용)
  // 은퇴 전략 설정. 미지정이면 compileStrategy가 baseline 전략으로 컴파일한다.
  // "입력을 그대로 통과"하는 것은 이 필드가 없고 **동시에** 레거시 저수준 필드
  // (spendingStrategy='dividend_only'/'max_sustainable', userProfile.targetBequest)도
  // 없을 때뿐이다 — 그 씨앗이 하나라도 있으면 전략이 유도되어 저수준 필드가 실체화된다
  // (compileStrategy.seedStrategyFromLegacyParams 참조).
  strategy?: RetirementStrategy;
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
  // ISA 계좌 잔액. totalAssets에는 원래 포함돼 있었지만 별도 필드가 없어,
  // stockAssets + pensionAssets로 자산 구성을 재구성하는 소비처들이 ISA를 통째로 놓쳤다
  // (인플레이션 헤지 점수의 분자, 자산 추이 차트의 시리즈).
  isaAssets: number;
  // 쓰고 남은 현금. 성장하지 않고 표시 통화 그대로 쌓이며, 부족분이 생기면 가장 먼저 쓴다.
  //
  // 예전에는 잉여 현금을 assets[0]에 도로 집어넣었다. 그래서 "배당 재투자 끄기"가 실제로는
  // "첫 번째 자산에 재투자하기"였고, 자산이 하나면 켜나 끄나 결과가 비트 단위로 같았다 —
  // 화면의 스위치가 아무것도 하지 않았다. 성장률·원가까지 그 자산의 것으로 잡히는 부작용도
  // 있었다(팔지도 않은 배당금이 취득원가를 부풀렸다).
  cashAssets: number;
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
  // 그 해 건강보험료 부과 기준이 된 소득 = 금융소득(세전) + 공적연금 × 반영비율(50%).
  // 사적연금은 부과 대상이 아니라 포함되지 않는다.
  //
  // 납부액만으로는 이 값을 역산할 수 없다 — 문턱 이하인 해는 납부액이 0이라 "얼마나
  // 가까운지"를 알 수 없기 때문이다. 피부양자 자격 상실 절벽 근접 경고
  // (computeRiskAlerts)가 바로 그 구간을 봐야 해서 결과에 실어 보낸다.
  healthInsuranceIncomeBasis: number;
  comprehensiveTaxPaid: number; // 금융소득종합과세(추가분) 납부액
  // 해외주식·ETF 양도소득세 납부액. **전년도에 실현된** 차익에 대한 것이다
  // (실제 확정신고가 다음 해 5월이고, 같은 해 부과 시 '세금 내려고 판 자산이 또 차익을
  //  만드는' 순환이 생기기 때문 — SimulationEngine의 deferredCapitalGainKRW 참고).
  // 마지막 해에만 이월분과 당해 실현분을 함께 낸다.
  capitalGainsTaxPaid: number;
  privatePensionTaxMethod: PrivatePensionTaxationMethod; // 사적연금 한도초과세 적용 방식

  spending: number; // 연간 총 생활비 인출
  // 그 해 목표 생활비 중 재원이 모자라 채우지 못한 금액. 0이면 완전 충족이다.
  // spending에서 이미 깎여 나갔으므로 spending + unmetSpending = 그 해에 쓰려 했던 금액이다.
  //
  // 이 필드가 없으면 "자산은 남았는데 생활비를 못 쓴 해"가 보이지 않는다 — 인출 경로가
  // 잔액을 넘겨 인출하지 않아(모든 매도가 Math.min으로 막혀 있다) totalAssets가 음수가
  // 되지 않으므로, depletionAge만으로는 결손이 드러나지 않고 '고갈 위험 없음'으로 보고된다.
  // 민감도 분석이 여유 있는 계획에서 아무 정보도 주지 못했던 원인 중 하나다.
  unmetSpending: number;
  // 연간 의료비 지출. spending에 이미 포함된 금액 중 의료비분을 분해해 보여주기
  // 위한 정보성 필드다 (spending에서 빼면 안 된다).
  //
  // 생활비와 동일하게 그 해의 spendingFactor(생존 인원 계수)가 이미 곱해져 있다.
  // 소비처에서 다시 곱하면 이중 축소가 된다.
  //
  // 점수·효용 계산이 "목표 대비 얼마나 충족했는가"의 분모를 만들 때는 이 값을 목표에
  // 더해야 한다. 더하지 않으면 의료비를 켠 사용자의 spending만 커져서 "목표를 초과해
  // 소비했다"로 잘못 채점된다(spendingFactor와 같은 이유다).
  //
  // 예외 — 자산이 고갈된 해: 인출할 자산이 없으면 엔진이 실제 지출(spending)을 인출
  // 가능한 만큼으로 깎으므로 spending < healthcareSpending이 될 수 있다. 즉 이 해에는
  // "spending에 포함된 금액"이 아니라 "그 해에 나갔어야 할 명목 의료비"를 뜻한다.
  // 실제로 깎인 금액을 의료비/생활비로 나눠 역산하려면 인출 로직 전체를 헤집어야 하는
  // 반면, 점수 분모 쪽은 이 값을 목표에 더할수록 결손이 정확히 드러나므로 안전하다.
  // 표시 목적으로 쓰는 곳은 Math.min(spending, healthcareSpending)을 고려할 것.
  healthcareSpending: number;
  hasTaxWarning: boolean; // 연간 금융소득이 2,000만원 초과 여부

  // 해당 연도 배우자 생존 여부. 배우자 미설정이면 항상 false다
  // (배우자가 없는 것과 사망한 것을 결과 타입에서 구분하지 않는다 —
  //  구분이 필요한 소비처는 params.spouse를 함께 본다).
  spouseAlive: boolean;
  // 해당 연도에 적용된 가구 생활비 규모 계수(2인=1, 1인 생존=0.7, 배우자 미설정=1).
  // SimulationEngine이 목표 생활비에 곱한 바로 그 값을 그대로 노출한다.
  //
  // 점수·효용 계산이 "목표 대비 얼마나 충족했는가"의 분모를 만들 때 반드시 이 값을 곱해야 한다.
  // 곱하지 않으면 배우자 사망으로 줄어든 필요를 완벽히 충족한 계획이 영구적 결손으로 채점된다.
  // 계수를 소비처에서 재유도(resolveSpouse 재호출 등)하지 않고 결과에 실어 나르는 이유는,
  // 계수를 계산하는 곳을 엔진 한 곳으로 묶어 두 로직이 다시 어긋나지 못하게 하기 위해서다.
  spendingFactor: SpendingFactor;
}

// 생존 인원에 따른 가구 생활비 규모 계수가 실제로 가질 수 있는 값. number로 두면 오타
// (0.75 등)가 조용히 통과한다.
//
// 값의 출처는 usecases/spouse/spouseRules.computeSpendingFactor다:
//   1   = 본인·배우자 모두 생존(또는 배우자 미설정)
//   0.7 = 한 명만 생존(SINGLE_SURVIVOR_SPENDING_FACTOR)
//   0   = 모두 사망
// 여기서 SINGLE_SURVIVOR_SPENDING_FACTOR를 import하지 않고 리터럴을 직접 쓰는 이유는
// 계층 방향 때문이다 — entities가 usecases를 참조하면 의존 방향이 역전된다.
// 두 곳이 어긋나면 spouseRules 쪽에서 컴파일 에러가 난다(반환 타입이 이 타입이다).
export type SpendingFactor = 0 | 0.7 | 1;

export interface SimulationResult {
  yearlyResults: SimulationYearlyResult[];
  fireAge: number | null; // FIRE 달성(소득 >= 생활비) 가능 나이
  depletionAge: number | null; // 자산 고갈 나이 (0 이하가 되는 시점)
  endingAssets: number; // 시뮬레이션 종료 시점 잔여 자산. 배우자가 본인보다 오래 살면
                        // 본인 기대수명이 아니라 "둘 중 늦게 사망하는 쪽" 시점의 잔액이다.
  retirementScore: number; // 0 ~ 100 점
  retirementGrade: RetirementGrade; // 점수 등급 (매우 안정, 안정, 보통, 주의, 위험)
  goalAchievementRate: number; // 은퇴 후 예상 월소득 / 목표 월소득 비율 (%)
  calculatedTargetSpending?: number; // 역산된 목표 생활비 (max_sustainable 모드 등에서 사용)
  retirementAssetsAtRetirement: number; // 은퇴 시작 시점 총자산 (해석/배너 표시용)
  // 시뮬레이션이 실제로 돈 마지막 나이(본인 나이 기준) = computeHouseholdEndAge.
  // 배우자가 본인보다 오래 살면 userProfile.expectancy보다 크다.
  //
  // depletionAge는 이 나이까지의 루프에서 판정되므로 "고갈되었는가"를 묻는 모든 소비처는
  // 반드시 이 값과 비교해야 한다. 본인 기대수명과 비교하면 배우자 단독 생존 구간의 파산이
  // 통째로 숨어 "고갈 위험 없음"이라는 거짓 진술이 된다.
  // 규칙(둘 중 늦게 죽는 쪽)을 소비처마다 재유도하지 않도록 엔진이 결과에 실어 보낸다.
  householdEndAge: number;
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

export type UtilityAxis = keyof UtilityBreakdown['components'];

// 가중치를 곱하기 전의 축별 원점수(각 0~1). UtilityBreakdown['components']에서 키를 파생시켜
// 두 타입이 따로 놀 수 없게 한다 — 축을 추가하면 양쪽이 동시에 바뀐다.
//
// components(=round(raw × weight))와 의미가 다르다. raw는 목표(objective)와 무관하므로
// 한 번 계산해 두면 여러 목표로 재채점할 수 있다(UtilityEngine.computeUtilityRaws 참고).
export type UtilityRaws = Record<UtilityAxis, number>;

// AI 센티널 자동 채움 대상 축. 생활비 배수(monthlySpendingMultiplier)는 제외한다 —
// 그 값은 withdrawalPlan이 아니라 userProfile.targetMonthlySpending을 스케일링해야 반영되고,
// 조용히 적용하면 화면이 보여주는 목표 생활비와 엔진이 실제로 쓴 목표가 달라진다.
// 추천으로 제안은 하되(recommendedPlan) 적용은 사용자가 누른다.
export type SentinelAxisField = Exclude<keyof BaselineWithdrawalPlan, 'monthlySpendingMultiplier'>;

// 사용자의 인출계획 위에 얹을 값들. 키가 없으면 "건드리지 않음", 값이 undefined면
// "그 키를 지움"(= 엔진 기본 동작으로 되돌림)을 뜻한다.
export type SentinelOverlay = Readonly<Partial<Pick<BaselineWithdrawalPlan, SentinelAxisField>>>;

// 검증된 자동 채움 오버레이 사슬의 한 단계. planOverrides는 0번 단계부터 여기까지 **누적된**
// 값이고, utility는 그 누적 조합을 실제로 시뮬레이션해 얻은 값이다(축별 delta의 합이 아니다 —
// 효용은 축에 대해 가산적이지 않다).
export interface VerifiedSentinelStep {
  field: SentinelAxisField;
  planOverrides: SentinelOverlay;
  utility: UtilityBreakdown;
}

export interface StrategyRecommendation {
  currentUtility: UtilityBreakdown; // 기존 로직(baseline) Utility
  // 추천안 중 "사용자의 실제 인출계획 위에 얹어도 개선이 확인된" 축들의 누적 사슬.
  // 각 단계의 utility는 currentUtility와 같은 기준선에서 측정된 실측값이다.
  //
  // 추천 격자는 여러 필드를 **함께** 최적화하고 후보 평가는 withdrawalPlan을 통째로 교체하며
  // 이뤄지므로, 그중 일부만 떼어 사용자 계획에 이식하면 한 번도 평가된 적 없는 조합이 된다.
  // 그 조합이 baseline보다 나쁠 수 있어 별도 검증이 필요하다.
  //
  // 사슬(집합이 아니라 순서 있는 누적)인 이유: 자동 채움 시점의 params가 추천 계산 시점과
  // 다를 수 있어(화면이 추천을 한 커밋 뒤로 미룬다) 일부 축을 채우지 못할 수 있다. 그때
  // 앞에서부터 잘라 쓰면 남는 것이 여전히 "엔진이 실제로 평가한 조합"이다.
  // 중간을 건너뛰고 뒤의 축만 적용하면 다시 미검증 조합이 된다.
  //
  // 개선이 확인된 축이 하나도 없으면 빈 배열이다.
  verifiedSentinelPlan: readonly VerifiedSentinelStep[];
  recommendedUtility: UtilityBreakdown; // 최고점 후보 Utility
  // baseline보다 Utility가 개선되는 후보를 찾았을 때만 해당 WithdrawalPlan이 채워지고, 그렇지
  // 않으면 null(= baseline 유지 권장). "부분 override 패치"인 WithdrawalPlan과 달리 여기서는
  // "AI가 확정한 완결된 결정" 또는 "결정 없음"이라는 의미로만 쓰인다.
  recommendedPlan: BaselineWithdrawalPlan | null;
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

// 항목이 건드리는 축. 표시 계층이 "AI 센티널로 이미 자동 적용된 축"을 라벨 문자열 매칭 없이
// 가려내기 위해 필요하다 — 문구는 수치가 섞여 계속 바뀌므로 매칭 기준이 될 수 없다.
// 인출계획 필드 외에 Phase 3(배당 재투자)·Phase 4(사적연금 채널링/신규 납입) 항목이 있다.
export type ItemizedContributionField =
  | keyof CompleteWithdrawalPlan
  | 'assetReinvestment'
  | 'privatePensionChanneling'
  | 'newPensionContribution';

export interface ItemizedContribution {
  field: ItemizedContributionField;
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
  | 'early' | 'normal' | 'defer_1y' | 'defer_2y' | 'defer_max' | 'ai_optimized';

export type PrivatePensionStrategy =
  | 'tax_first' | 'spending_first' | 'growth_first' | 'minimum' | 'ai_optimized';

// 'custom'과 'ai_recommended'는 둘 다 "수익률 프리셋을 적용하지 않는다"는 같은 동작이지만
// 뜻이 다르다: 'custom'은 사용자가 자산별로 직접 넣은 값을 쓰겠다는 명시적 선택이고,
// 'ai_recommended'는 아직 정하지 않았다는 뜻이다.
export type RiskProfile = 'conservative' | 'neutral' | 'aggressive' | 'custom' | 'ai_recommended';

export type EconomicScenario =
  | 'long_term_average' | 'recession' | 'high_inflation' | 'low_growth' | 'ai_recommended';

// ISA 만기 자금의 행선지. 예전에는 boolean(preferIsaFirst)이었다.
//
// boolean에는 "미정"을 담을 자리가 없어서, 이 축만 AI 자동 채움에서 통째로 빠져 있었다 —
// 다른 축들이 'ai_*' 센티널로 미정을 표현하는 동안 여기만 false가 "연금으로"라는 확정
// 선택과 "아직 안 정했다"를 겸했다.
//
// 저장된 boolean은 resolveStrategy에서만 정규화한다(E2EE라 서버 마이그레이션이 불가능하다).
// **false는 'pension_first'로 보존하며 'ai_optimized'로 승격하지 않는다** —
// 승격하면 그 사용자의 저장된 선택이 AI 추천값으로 조용히 덮어써진다.
export type IsaFirstChoice = 'isa_first' | 'pension_first' | 'ai_optimized';

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
  preferIsaFirst: IsaFirstChoice;
  riskProfile: RiskProfile;
  economicScenario: EconomicScenario;
}

// 배우자. 자산/ISA/사적연금 계좌는 가구 합산 하나로 유지하고, 여기서는 생존 기간과
// 국민연금만 분리한다(설계 결정: 계좌 소유자 분리는 이번 범위 밖).
// 배우자 **명의**의 국민연금은 다루지 않는다. 설정 항목이 다섯 개로 늘면서 간편 모드까지
// 복잡해졌고, 그 대가로 얻는 것이 "배우자도 연금을 받는다"는 한 가지뿐이었다.
// 배우자 축이 실제로 결과를 바꾸는 지점(가구 종료 나이, 생활비 축소 계수, 본인 연금의
// 유족연금 승계)은 아래 세 필드만으로 전부 성립한다.
export interface SpouseProfile {
  enabled: boolean;
  currentAge: number;
  expectancy: number;
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
