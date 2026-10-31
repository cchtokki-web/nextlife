import { RetirementGrade } from './retirementGrade';
import type { RetirementGoal } from './retirementGoal';

export type {
  RetirementGoal,
  RetirementGoalConstraintType,
  RetirementGoalType,
} from './retirementGoal';

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
  /** 배당을 포함한 연 총수익률. % 단위, 예: 10.5% -> 10.5 */
  totalReturn: number;
  /** 사용자가 켠 경우 수정 종가의 과거 연환산 수익률을 시나리오를 열 때 조회한다. */
  autoHistoricalReturn?: boolean;
  /**
   * totalReturn 중 «현금으로 분배되는» 비율. % 단위, 예: 3% -> 3
   *
   * 가격상승률은 `totalReturn - dividendYield`로 파생된다(priceGrowthRate). 이 값이
   * totalReturn보다 크면 가격상승률이 음수가 되며, 커버드콜·고배당 ETF에서 정상이다.
   */
  dividendYield: number;
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
  /** 배당을 포함한 연 총수익률. % 단위 */
  totalReturn: number;
  /**
   * 표시 전용. **엔진 계산에 쓰이지 않는다.**
   *
   * 연금 계좌 안에서는 배당세도 재투자 선택지도 없어 총수익률만이 결과를 결정한다.
   * 게다가 엔진의 두 월율 규약이 달라(성장은 기하 복리, 배당은 단리) 분해하면 의미
   * 변경을 넘어 산술까지 바뀐다. 그래서 이 값은 화면의 파생값 표시와 시세 조회
   * 일관성을 위해서만 존재한다.
   */
  dividendYield?: number;
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

// 엔진이 아는 생활비 전략 3종.
//
// **`'max_sustainable'`은 오늘 «내부 전용»이다.** 엔진에는 온전히 살아 있지만 현재 제품
// 경로에서는 «생성·저장·선택 중 어느 것도 되지 않는다». 잠그는 것이 셋이고, 셋 다 조건이 없다.
//
//  1. **고르는 화면이 없다.** 제품 계층(`src/web`·`src/app`) 전체에서 이 값이 나오는 자리는
//     둘뿐이고 «둘 다 비교»다 — PDF 라벨(`features/Pdf/buildReportHtml.ts`)과 AI 어드바이저
//     프롬프트의 전략 라벨(`app/api/ai-advisor/route.ts`). 이미 그 값인 계획을 알아보고 문구를
//     짓는 코드이지, 그 값을 만들거나 건네는 자리가 아니다.
//  2. **저장 시나리오가 가질 수 없다.** 로드 경로가 전부 지나는 `migrateRetirementGoals`
//     (`useScenarios.ts`의 migrateParams)가 `normalizeGoalDrivenParams`를 «조건 없이» 태워
//     `spendingChoice: 'target'`으로 고정한다. `retirementGoals` 키가 아예 없는 옛 시나리오도
//     예외가 아니다.
//  3. **추천 후보가 될 수 없다.** `StrategyGenerator`가 «모든» 격자 후보의
//     `spendingPolicy.mode`를 'target'으로 고정한다 — 후보끼리 비교하려면 생활비 기준이
//     같아야 하기 때문이다. 격자 밖의 「현상 유지」 후보 한 장은 씨앗을 그대로 복사하므로
//     예외처럼 보이지만, 그 씨앗이 곧 사용자의 현재 계획이라 2번이 이미 잠갔다.
//     `generateSpendingAdjustmentCandidates`도 'target'이 아닌 계획에는 아무 후보도 만들지
//     않는다(StrategyCandidateGenerator.ts).
//
// 2·3의 잠금은 'target'이 아닌 «모든» 선택지에 걸린다('dividend_only'도 같다). 1은
// max_sustainable에 대한 사실이다.
//
// 그래서 이 값에 도달하는 것은 엔진 단위 테스트와 정규화를 거치지 않은 입력(내부 최적화
// 엔진이 직접 만든 params)뿐이다. **제품에서 이 전략을 쓰는 사용자는 오늘 존재할 수 없다.**
// 계산을 바꾸면서 「저장 시나리오의 결과가 바뀐다」고 적으려는 사람은 여기서 멈춰야 한다 —
// 그것이 known-issues 13번이 잡아낸 틀린 전제다.
//
// 그래도 엔진에 두는 이유는 다시 노출될 때를 위한 «안전장치»이기 때문이다(13번 결정 (b)).
// 계산·경고·회귀 테스트는 그대로 유지한다. 세 잠금 중 하나라도 풀면
// `src/tests/core/usecases/goals/maxSustainableReachability.test.ts`가 먼저 깨진다.
//
// **「지속가능 생활비」라는 «지표»와 혼동하지 말 것.** 그 지표(`findMaxSustainableValue` →
// `SimulationResult.calculatedTargetSpending`)는 'target' 계획에서도 «항상» 계산되어 화면에
// 표시된다. 전략과 지표는 다른 것이고, 내부 전용인 것은 전략 쪽뿐이다
// (calculatedTargetSpending 주석에 그 경계를 적어 두었다).
export type SpendingStrategy = 'target' | 'dividend_only' | 'max_sustainable';

// 은퇴 후 목표 생활비의 연령대별 배분 모양. "얼마를 쓸지"가 아니라 "어떻게 나눠 쓸지"다.
export type SpendingShapePreset =
  | 'flat'          // 실질생활비 균등형 (기존 동작)
  | 'front_loaded'  // 활동기 집중형 — 건강할 때 더 쓰고 나이 들며 줄인다
  | 'care_heavy';   // 의료·돌봄 대비형 — 후반을 위해 초반을 아낀다

// 해소된 연령별 배수 곡선. 그 해 목표 = targetMonthlySpending × 물가계수 × 배수 + 의료비.
//
// **금액이 아니라 배수 벡터인 것이 설계의 핵심이다.** max_sustainable의 이진탐색이 성립하는
// 이유는 자유변수가 스칼라 하나(targetMonthlySpending)이기 때문인데, 연령별 금액을 각각
// 자유변수로 두면 벡터가 되어 그 구조를 못 쓴다. 모양을 고정하고 그 위에 스칼라 하나를
// 곱하면 총지출이 스칼라에 대해 단조라 기존 탐색이 그대로 성립한다.
//
// 미지정이면 전 구간 1.0이며, 그때는 이 필드 자체가 없어야 한다(resolveSpendingCurve 주석).
export interface SpendingCurve {
  // 오름차순. 각 값은 "그 나이부터 다음 구간"을 뜻한다(70이면 70세가 두 번째 구간의 첫 해).
  breakpointAges: readonly number[];
  // 길이 = breakpointAges.length + 1.
  multipliers: readonly number[];
}

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
export type AccountWithdrawalPolicy =
  | 'GENERAL_FIRST'
  | 'ISA_FIRST'
  | 'PENSION_FIRST'
  | 'TAX_OPTIMIZED'
  | 'PROPORTIONAL'
  | 'CUSTOM';
export type AccountWithdrawalType =
  | 'CASH'
  | 'GENERAL'
  | 'ISA'
  | 'PENSION_SAVINGS'
  | 'IRP'
  | 'PRIVATE_PENSION';

export interface WithdrawalPlan {
  // StrategyOptimizer가 선택해 전달하는 계좌군 인출 정책. 엔진은 추천하지 않고 그대로 평가한다.
  //
  // **미지정은 GENERAL_FIRST의 동의어가 아니다.** 예전 주석은 그렇게 적혀 있었지만 엔진은
  // 그렇게 동작한 적이 없다. 미지정 계획은 사적연금을 «정기 지급»으로 먼저 꺼내고
  // (잔여 개월 균등분할, 또는 privatePensionMonthlyTarget), 남은 부족분만 GENERAL_FIRST
  // 순서로 채운다. 그 정기 지급도 그 달의 필요액을 넘지는 않는다(SimulationEngine의
  // Math.min(evenSplit, needGross)) — 다른 점은 «금액»이 아니라 «순서»다. 사적연금이
  // 인출기의 계좌 순서에 참여하지 않고 그보다 먼저 소득처럼 도착한다.
  // 정책을 명시하면 그 정기 지급이 사라지고 인출기 한 경로가 순서를 정한다.
  // 즉 미지정은 「순서를 안 정했다」가 아니라 «다른 계획»이다 — 54 페르소나 중 50명의 원장이
  // GENERAL_FIRST를 써넣는 것만으로 움직인다(사적연금이 없는 4명만 같다).
  //
  // 그래서 어느 계층도 이 필드를 기본값으로 메우면 안 된다. 메우는 순간 사용자가 시뮬레이션한
  // 것과 «다른 계획»이 저장된다. 미지정을 그대로 두는 것이 「지금 계획을 유지한다」의 뜻이다.
  accountWithdrawalPolicy?: AccountWithdrawalPolicy;
  // CUSTOM일 때만 사용한다. 계좌 유형 또는 구체 계좌 id를 앞에서부터 우선한다.
  customWithdrawalOrder?: readonly (AccountWithdrawalType | string)[];
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
export type OptimizedWithdrawalPlan = Omit<
  WithdrawalPlan,
  'accountWithdrawalPolicy' | 'customWithdrawalOrder'
>;
export type CompleteWithdrawalPlan = Required<OptimizedWithdrawalPlan>;

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
  /** 배당을 포함한 연 총수익률. % 단위 */
  totalReturn: number;
  /** totalReturn 중 현금으로 분배되는 비율. % 단위 */
  dividendYield: number;
  currency: AssetCurrency;
  maturityYears: number; // 기본 3년
}

// 자산/사적연금/ISA별 "사용자 프리셋"(직접입력 수익률) 스냅샷. 시장 수익률 프리셋(보수적/기본값/
// 공격적)으로 전환하면 자산·연금·ISA의 totalReturn이 프리셋 값으로 덮어써지므로, 그
// 직전 시점의 직접입력 값을 id 기준으로 보존해 두었다가 "사용자 프리셋" 재선택 시 되돌린다.
export interface CustomYieldSnapshot {
  assets: Record<string, number>; // InvestmentAsset.id -> totalReturn
  privatePensions: Record<string, number>; // PrivatePension.id -> totalReturn
  // IsaAccount.id -> totalReturn. ISA가 프리셋 대상에 들어오기 전에 저장된 스냅샷에는
  // 이 키가 없으므로 optional이다 — 필수로 바꾸면 이미 저장된 시나리오가 타입과 어긋난다.
  isaAccounts?: Record<string, number>;
}

export interface SimulationParams {
  /** 현재 계획의 ETF 시세를 시나리오를 열 때 자동 반영한다. 미지정 시 꺼짐. */
  autoUpdateEtfPrices?: boolean;
  /** ETF의 과거 연환산 수익률을 공통으로 갱신한다. 미지정 시 기존 개별 설정을 유지한다. */
  autoUpdateEtfReturns?: boolean;
  /** 선택한 경우 현재 연도에서 빼어 연도 기준 나이를 계산한다. */
  birthYear?: number;
  /** 사용자가 확정한 최초 비교 기준. 현재 시뮬레이션 입력에는 사용하지 않는다. */
  investmentBaseline?: {
    capturedAt: string;
    params: Omit<SimulationParams, 'investmentBaseline'>;
  };
  userProfile: UserProfile;
  // 목표 기반 기본 입력. optional인 이유는 기존 로컬/E2EE 시나리오가 이 필드 없이 저장돼
  // 있기 때문이다.
  //
  // **방향에 주의한다.** 로드 경로의 migrateRetirementGoals는 저수준 필드에서 목표를 복원하지
  // 않는다(고르지 않은 목표를 지어내지 않는다는 원칙). 반대로 목표에서 저수준 필드를
  // 파생시킨다 — 은퇴 나이·목표 생활비·목표 상속자산이 그 대상이며, 계산 엔진은 계속 그
  // 저수준 필드를 소비한다(normalizeGoalDrivenParams).
  retirementGoals?: RetirementGoal[];
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
  // **계산에 쓰이지 않는다.** 자산 폼의 「수익률 일괄 채우기」가 마지막으로 채운 프리셋의
  // 표식이며, customYieldSnapshot 되돌리기의 기준이다. 수익률도 변동성도 이 값에서
  // 유도하지 않는다(2026-08-22 수익률 가정 축 분리).
  yieldPreset?: 'conservative' | 'base' | 'aggressive' | 'custom';
  customYieldSnapshot?: CustomYieldSnapshot; // "사용자 프리셋" 복원용 저장값
  spendingStrategy?: SpendingStrategy; // 목표 생활비 달성 전략
  // 은퇴 후 목표 생활비의 연령대별 배수. 미지정이면 전 구간 균등(= 기존 동작과 비트 단위로 동일).
  //
  // withdrawalPlan이 아니라 최상위에 두는 이유는 assetFloor와 같다: 후보 탐색이
  // withdrawalPlan을 통째로 교체하므로(paramsWithBaselinePlan) 그 안에 두면 모든 후보
  // 평가에서 조용히 사라진다.
  //
  // **이 값을 읽는 곳은 전부 같은 함수(spendingMultiplierForAge)를 써야 한다.** 엔진의 목표
  // 산출과 충당 검증, 채점 분모와 그 설명 문장, 달성률·FIRE 판정, 차트 목표선, KPI 금액이
  // 전부 그 함수를 거친다. 하나라도 빠지면 조용히 어긋난다 — 특히 meetsSustainabilityGoal에서
  // 빠지면 배수가 1을 넘는 구간이 항상 미충당으로 읽혀 max_sustainable 이진탐색이 0으로
  // 붕괴한다(실측: 월 438만원 → 0.37원).
  //
  // 호출부 개수를 여기 적지 않는 이유: 화면 쪽 소비처가 계속 늘어나므로 숫자를 적으면
  // 반드시 낡는다. 새 소비처를 만들 때는 `grep spendingMultiplierForAge`로 선례를 볼 것.
  // 유일한 의도적 예외는 computeRetirementTargetAssets(4% 룰)이며 그 이유는 그쪽 주석에 있다.
  spendingCurve?: SpendingCurve;
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
  // HARD 생활비 목표에서 유도된 월 생활비 바닥(displayCurrency 기준). 이 금액까지는
  // 전략 선호(계좌 순서·월 인출 목표·일반자산 개시 나이)와 세제 최적화(저율과세 한도)를
  // 깨고 채운다. 미지정이면 바닥이 없고 인출 동작은 기존과 비트 단위로 동일하다.
  //
  // **strategy.minMonthlySpending과 다르다.** 그쪽은 화면 경고용이며 엔진에 내려가지
  // 않는다(그 필드의 주석 참조). 한 이름에 두 뜻을 붙이지 않으려고 별도 필드를 둔다.
  //
  // assetFloor와 같은 이유로 withdrawalPlan이 아니라 최상위에 둔다 — 후보 탐색이
  // withdrawalPlan을 통째로 교체하므로 그 안에 두면 모든 후보에서 조용히 사라진다.
  hardSpendingFloor?: number;
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
  healthcare?: HealthcareAssumptions;
  taxLawVersion?: TaxLawVersion;
}

/**
 * 한 해의 총자산 회계 원장. 결과에 실린 스칼라 필드들이 **하나의 항등식**으로 설명되는지를
 * 직접 확인할 수 있는 유일한 자리다.
 *
 *   기말 총자산
 *   = 기초 총자산
 *   + 투자 총수익 (가격수익 + 배당 + 이자)
 *   + 진짜 외부 유입 (국민연금 세전 + 기타소득 + 신규 납입)
 *   − 생활비 − 세금 − 건강보험료
 *
 * **내부 이동은 이 식에 넣지 않는다.** 사적연금 인출, 일반계좌 ETF 매도, ISA 인출, 계좌
 * 이체는 자산의 «형태»만 바꾸므로 총자산 관점에서 손익이 아니다. 그 금액들은 아래
 * internalWithdrawals에 정보로만 싣는다 — 식에 넣는 순간 인출과 소비가 모두 자산 감소로
 * 계산되어 이중차감이 된다.
 *
 * 이 원장이 없던 동안 "60~64세 부족자금은 982만원인데 자산은 1.7억 줄었다"처럼 서로
 * 모순되어 보이는 두 숫자를 대조할 방법이 없었다. residual이 0이면 두 숫자는 모순이 아니다.
 */
/**
 * 그 해 인출이 «무엇을 깼고 무엇에 막혔는가»의 기록. 회계 항등식과는 분리된 서브객체다 —
 * 항등식(기말 = 기초 + 투자총수익 + 외부유입 − 생활비 − 세금 − 건보료)에는 들어가지 않는다.
 *
 * **엔진은 목표를 모른다.** 여기에는 엔진이 «아는 말»만 들어온다 — 「일반자산 개시 나이를
 * 깼다」, 「연금 개시 나이에 막혔다」. 그것을 목표 유형(HARD 생활비 ↔ HARD 상속 충돌 등)으로
 * 번역하는 것은 평가 계층(GoalEvaluationEngine)의 일이며, 이 파일에도 엔진에도 목표 이름을
 * 들이지 않는다. 그 분리를 깨면 목표 화면이 바뀔 때마다 계산 엔진이 따라 바뀐다.
 */
export interface YearLedgerDiagnostics {
  /**
   * HARD 생활비 바닥을 채우려고 «실제로 넘겨 인출한» 선호. 1단계가 돌았다는 사실만으로는
   * 기록하지 않는다 — 한도 안에서 끝난 달은 아무것도 깨지 않았다.
   */
  brokenPreferences: ReadonlyArray<
    'pensionTaxLimit' | 'pensionMonthlyTarget' | 'generalAssetStartAge' | 'assetFloor'>;
  /** 왜 깼는가. 지금 선호를 깰 수 있는 사유는 HARD 생활비 바닥 하나뿐이다. */
  overrideReason?: 'hardSpendingFloor';
  /** HARD 바닥 미달액(계층 1 실패). 바닥이 없는 계획에서는 항상 0이다. */
  unmetHardSpending: number;
  /** 목표 생활비 미달액(계층 3 실패). SimulationYearlyResult.unmetSpending과 같은 금액이다. */
  unmetTargetSpending: number;
  /** 잔액은 남았는데 꺼내지 못한 이유. 없으면 「꺼낼 것이 없었다」는 뜻이다. */
  blockedWithdrawalReason?: 'legalAge' | 'isaPrincipalExhausted' | 'assetFloor';
  /**
   * 계층 «밖» 사유로 assetFloor가 침범당했다.
   *
   * 세금 징수는 인출 엔진을 거치지 않고 자산을 직접 판다. 그래서 하한선을 지키지 않는다 —
   * 그리고 «그것이 옳다». 납세 의무는 목표가 우선순위로 깰 수 있는 계층 안이 아니라 물리적·
   * 법적 실행 가능성과 같은 계층 «밖»에 있다. 상속을 남기고 싶다는 이유로 세금을 안 낼 수는
   * 없으므로 세금이 이긴다. 결함은 그 침범이 «조용히» 일어나는 것뿐이라 여기에 적는다.
   *
   * brokenPreferences의 'assetFloor'와는 «다른» 사실이다. 그쪽은 HARD 생활비 바닥을 채우려고
   * 계층 1이 계층 2를 이긴 것이고, 이쪽은 어떤 목표도 이기지 않은 계층 밖의 침범이다. 한 해에
   * 둘이 함께 일어날 수 있으므로 자리를 나눠 둔다 — 한 자리에 겹쳐 적으면 평가 계층이
   * 「목표 충돌」과 「제도상 불가피」를 구분하지 못한다.
   */
  assetFloorBreachedBy?: 'taxObligation';
}

export interface YearlyLedger {
  age: number;
  beginningAssets: number;
  investmentReturn: {
    /** priceGain + dividend. 시장 연동 계좌 전체의 총수익이다. */
    total: number;
    // 가격수익 + 현금 이자 + 사적연금 총수익.
    //
    // **사적연금은 배당을 분해하지 않는다**(계좌 안에 배당세도 재투자 선택지도 없어
    // 총수익률만이 결과를 정한다 — decomposeReturn.ts 주석). 그래서 연금의 총수익은
    // dividend가 아니라 여기 들어온다. 연금 계좌의 배당을 배당소득으로 세지 않는다는
    // 규칙이 이 배치로 구조상 보장된다.
    priceGain: number;
    /** 일반계좌·ISA에서 발생한 **세전** 배당. 재투자 여부와 무관하게 전액이 여기 잡힌다. */
    dividend: number;
    // 세후 배당이 어디로 갔는가. 위 dividend(세전)에서 배당세를 뺀 몫이 이 둘로 갈린다.
    //
    // 둘을 나누는 이유는 «쓸 수 있는 돈인가»가 갈리기 때문이다. 계좌 밖으로 나온 배당만
    // 생활비 재원이 되고, 계좌 안에 남은 배당은 쓰려면 자산을 팔아야 한다(양도세가 붙는다).
    // 총자산 항등식에서는 둘 다 이미 위 dividend로 한 번 세어졌으므로, 이 두 값은 정보성이며
    // 항등식에 다시 넣지 않는다.
    /** 계좌 밖으로 «나온» 세후 배당. SimulationYearlyResult.dividendIncome과 같은 금액이다. */
    dividendPaidOutNet: number;
    /** 계좌 «안에» 남은 세후 배당(재투자분 + ISA 내부 배당). 생활비로 쓸 수 없다. */
    dividendRetainedNet: number;
  };
  /** 포트폴리오 밖에서 «새로» 들어온 돈. 계좌 간 이동은 절대 포함하지 않는다. */
  externalIncome: {
    total: number;
    /** 국민연금 세전 수령액. 세금은 아래 expenses.tax에서 한 번만 뺀다. */
    nationalPension: number;
    /** 임대소득 등 기타 외부소득. */
    other: number;
    /** 은퇴 전 신규 납입액(일반자산 + 사적연금 + ISA). 한도로 잘린 뒤의 실제 납입액이다. */
    contributions: number;
  };
  /**
   * 계좌 «안에서 밖으로» 나온 것이 아니라 계좌 «사이»를 옮긴 금액. 정보성이며 위 항등식에
   * 들어가지 않는다.
   */
  internalWithdrawals: {
    privatePension: number;
    taxableAccount: number;
    isa: number;
  };
  expenses: {
    living: number;
    tax: number;
    healthInsurance: number;
  };
  endingAssets: number;
  /**
   * endingAssets − (항등식이 예측한 기말자산). 정상이면 부동소수점 오차만 남는다.
   * 이 값이 커진다는 것은 어떤 현금흐름이 두 번 세어졌거나 어디론가 증발했다는 뜻이다.
   */
  residual: number;
  /**
   * 그 해 인출의 진단(YearLedgerDiagnostics 주석 참고). **항등식에는 들어가지 않는다** —
   * 그래서 회계 행에 필드를 섞지 않고 서브객체로 둔다.
   */
  diagnostics: YearLedgerDiagnostics;
}

export interface SimulationYearlyResult {
  age: number;
  year: number;
  /** 근로소득 모델이 추가되기 전까지 0. 근거 없는 소득을 추정하지 않는다. */
  employmentIncome: number;
  totalAssets: number; // 기말 자산액 (선택 표기 통화 기준)
  stockAssets: number; // 주식/ETF 자산
  pensionAssets: number; // 사적연금 자산
  // ISA 계좌 잔액. totalAssets에는 원래 포함돼 있었지만 별도 필드가 없어,
  // stockAssets + pensionAssets로 자산 구성을 재구성하는 소비처들이 ISA를 통째로 놓쳤다
  // (인플레이션 헤지 점수의 분자, 자산 추이 차트의 시리즈).
  isaAssets: number;
  // 쓰고 남은 가용현금과 다음 해 납부할 양도세 유보금. 둘 다 성장하지 않고 표시 통화 그대로
  // 쌓이지만, 유보금은 이미 확정된 세금 재원이므로 생활비 인출에는 다시 사용하지 않는다.
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
  /** 연령곡선·물가·의료비를 반영해 해당 연도에 쓰려 한 총액. */
  targetSpending: number;
  /** spending의 명시적 별칭. 새 단일전략 평가 계약에서 사용한다. */
  actualSpending: number;
  /** unmetSpending의 명시적 별칭. */
  shortfall: number;
  /** 생활비 재원 및 계획 집행으로 일반 투자자산에서 인출한 세전 총액. */
  generalAssetWithdrawal: number;
  /** ISA에서 인출한 총액. */
  isaWithdrawal: number;
  /** 사적연금 계좌에서 인출한 세전 총액. */
  privatePensionWithdrawal: number;
  /** 계좌별 사적연금 잔액 원장. 옛 결과와의 호환을 위해 optional이다. */
  privatePensionAccountLedgers?: PrivatePensionAccountLedger[];
  /** 모든 계좌 유형에서 인출한 세전 총액(현금 포함). */
  withdrawal: number;
  /** 엔진이 기록한 모든 세금과 추가 건강보험료의 합계. */
  taxes: number;
  /** 해당 연도 계산을 시작하기 직전의 총자산. */
  openingAssets: number;
  /** 현금·일반자산·ISA·사적연금의 평가수익 합계(배당소득 제외). */
  investmentReturn: number;
  /** totalAssets의 명시적 별칭. */
  closingAssets: number;
  
  // 세금 및 공과금 상세 내역
  preTaxTotalIncome: number; // 연간 세전 총소득
  dividendTaxPaid: number; // 배당소득세 납부액
  pensionTaxPaid: number; // 연금소득세 납부액
  nationalPensionTaxPaid: number; // 국민연금 세금 납부액
  /**
   * 사적연금 세금(pensionTaxPaid) 중 **연말에 자산에서 따로 걷힌** 몫.
   *
   * 사적연금은 인출할 때마다 연령별 저율(3.3~5.5%)로 원천징수하고, 연말에 그해 총 인출액을
   * 기준으로 실제 세액(분리과세 16.5% vs 종합과세 중 작은 쪽)을 다시 계산해 차액을 마저
   * 걷는다. 그 차액이 이 값이다.
   *
   * **왜 결과에 실어 보내는가.** 이 정산은 그해 생활비가 이미 지출된 «뒤에» 일어나고
   * 자산 매도로 납부된다. 그래서 화면의 사적연금 소득(privatePensionIncome)은 이 금액까지
   * 뺀 값인 반면, 그해 생활비를 실제로 채운 돈은 그보다 이만큼 크다. 두 숫자를 나란히 놓고
   * 빼면 맞지 않는데, 그 차이를 설명할 근거가 결과 어디에도 없었다 — 사용자에게는 계산
   * 오류로 보인다(describePrivatePensionTaxSettlement).
   *
   * pensionTaxPaid에 **이미 포함되어 있다.** 세금 합계에 다시 더하면 이중 계상이다.
   *
   * optional은 이 필드가 없던 저장 결과·테스트 픽스처의 역호환을 위한 것이다.
   */
  privatePensionYearEndTaxAdjustment?: number;
  healthInsurancePaid: number; // 건강보험료(추가분) 납부액
  // 그 해 건강보험료 부과 기준이 된 소득 = 금융소득(세전) + 공적연금 × 반영비율(50%).
  // 사적연금은 부과 대상이 아니라 포함되지 않는다.
  //
  // 납부액만으로는 이 값을 역산할 수 없다 — 문턱 이하인 해는 납부액이 0이라 "얼마나
  // 가까운지"를 알 수 없기 때문이다. 피부양자 자격 상실 절벽 근접 경고
  // (computeRiskAlerts)가 바로 그 구간을 봐야 해서 결과에 실어 보낸다.
  healthInsuranceIncomeBasis: number;
  /**
   * 실제 현금흐름용 소득·세금 값. 피부양자 판정 기준과 섞지 않는다.
   * optional은 이 구조가 없던 저장 결과·테스트 픽스처의 역호환을 위한 것이다.
   */
  cashFlowIncome?: {
    grossIncome: number;
    incomeTax: number;
    /** 현행 세율표에 포함되어 별도 분해할 수 없으므로 임의로 0을 만들지 않는다. */
    localIncomeTax: number | null;
    healthInsurancePremium: number;
    netCashIncome: number;
  };
  /** 건강보험 피부양자 위험 판정용 값. 세후 실수령액과 독립적이다. */
  healthInsuranceDependentAssessment?: {
    income: number;
    /** 현행 production 입력에는 재산 판정값이 없어 알 수 없다. */
    property: number | null;
    /** 소득으로 탈락이면 false, 그 외에는 재산 정보가 없어 null이다. */
    eligible: boolean | null;
    riskLevel: 'low' | 'boundary' | 'high' | 'unknown';
    incomeThreshold: number;
    /** production 입력 범위상 항상 소득 기준까지만 평가한다. */
    assessmentScope: 'income_only' | 'unavailable';
    /** 최종 자격 판정을 위해 아직 필요한 입력. */
    missingInputs: Array<'property'>;
  };
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
  // 점수·효용 계산이 "목표 대비 얼마나 충족했는가"의 분모를 만들 때는 이 값을 목표에
  // 더해야 한다. 더하지 않으면 의료비를 켠 사용자의 spending만 커져서 "목표를 초과해
  // 소비했다"로 잘못 채점된다.
  //
  // 예외 — 자산이 고갈된 해: 인출할 자산이 없으면 엔진이 실제 지출(spending)을 인출
  // 가능한 만큼으로 깎으므로 spending < healthcareSpending이 될 수 있다. 즉 이 해에는
  // "spending에 포함된 금액"이 아니라 "그 해에 나갔어야 할 명목 의료비"를 뜻한다.
  // 실제로 깎인 금액을 의료비/생활비로 나눠 역산하려면 인출 로직 전체를 헤집어야 하는
  // 반면, 점수 분모 쪽은 이 값을 목표에 더할수록 결손이 정확히 드러나므로 안전하다.
  // 표시 목적으로 쓰는 곳은 Math.min(spending, healthcareSpending)을 고려할 것.
  healthcareSpending: number;
  hasTaxWarning: boolean; // 연간 금융소득이 2,000만원 초과 여부
  /**
   * 그 해 총자산 흐름의 회계 원장(YearlyLedger 주석 참고). 엔진이 항상 채운다.
   *
   * 선택 필드인 이유는 손으로 만든 결과 객체(테스트 픽스처, 저장된 옛 결과)에는 이 값이
   * 없는 것이 정직하기 때문이다 — utility·calculatedTargetSpending과 같은 관례다.
   */
  ledger?: YearlyLedger;
}

export interface PrivatePensionAccountLedger {
  accountId: string;
  accountName?: string;
  beginningBalance: number;
  /** 신규 납입. ISA 만기 이전은 transferIn으로 분리한다. */
  contribution: number;
  transferIn: number;
  investmentReturn: number;
  /** 사용자가 받은 순액 또는 다른 계좌로 이동한 순액. */
  withdrawal: number;
  /** 원천징수와 이 계좌에서 직접 납부한 세금의 합. */
  tax: number;
  endingBalance: number;
  /** 정상이라면 부동소수점 오차만 남는다. */
  residual: number;
  /**
   * 소득세법 시행령 제40조의2의 연금수령한도 판정.
   *
   * 현행 production 입력에는 연금수령 기산연도·과세기간 개시일 평가액·2013년 이전 가입
   * 예외 정보가 없으므로 한도를 지어내지 않고 미판정으로 남긴다. optional은 옛 결과 호환용이다.
   */
  statutoryLimitAssessment?: {
    status: 'not_assessable' | 'limited' | 'not_limited';
    annualLimit: number | null;
    withinLimit: boolean | null;
    missingInputs: Array<'pensionCommencementYear' | 'taxPeriodOpeningBalance' | 'pre2013Exception'>;
  };
}

/**
 * `max_sustainable` 계획에서 **탐색값과 실제 전달된 계획이 갈라진 기록.**
 *
 * 둘이 갈라지는 것은 사고가 아니라 설계다. 탐색은 HARD 생활비 바닥을 떼고 돌아야 정직하고
 * (바닥을 남기면 이진탐색이 정확히 바닥으로 수렴해 사용자 입력을 측정값이라며 되돌려준다),
 * 전달되는 계획은 그 바닥을 존중해야 한다(계층 1 > 계층 5). 갈라진 폭이 곧 **「HARD 바닥이
 * 세제 선호를 얼마나 눌렀는가」**이므로, 남기지 않으면 다음에 이 숫자를 의심하는 사람이
 * 처음부터 다시 재야 한다.
 *
 * **연도별 원장(YearLedgerDiagnostics)이 아니라 결과 최상위에 둔다.** 이 사실은 한 해의
 * 인출이 아니라 «계획 하나»에 대한 것이고(탐색 한 번, 전달 계획 한 번), 40개 원장에 같은
 * 스칼라를 복사하면 서로 어긋날 수 있는 사본이 40벌 생긴다. 그 해에 «무엇을 깼는가»라는
 * 연도별 절반은 이미 원장이 적고 있다(brokenPreferences·overrideReason). 이 값은 자기가
 * 설명하는 숫자(calculatedTargetSpending) 바로 옆에 있어야 찾을 수 있다.
 *
 * 바닥이 구속하지 «않은» 계획에는 이 필드가 없다 — 갈라진 적이 없으므로 없는 것이 정직하다.
 */
export interface SustainableSpendingFloorOverride {
  /** 탐색값. 선호(세제 최적화·계좌 순서·월 인출 목표)를 지킬 때의 지속가능 생활비. */
  preferenceRespectingMonthly: number;
  /** 바닥을 존중한 실행에서의 지속가능 생활비. 이 값도 바닥의 «크기»에는 의존하지 않는다. */
  floorHonoringMonthly: number;
  /**
   * 실제로 전달된 계획의 월 생활비 = max(hardSpendingFloor, floorHonoringMonthly).
   * calculatedTargetSpending과 같은 값이며, 원장이 그 금액을 지급한다.
   * 바닥이 floorHonoringMonthly를 넘으면 이 계획은 지속 가능하지 «않다» — depletionAge를 볼 것.
   */
  deliveredMonthly: number;
  /** 그 계획의 HARD 생활비 바닥(SimulationParams.hardSpendingFloor). */
  hardSpendingFloor: number;
}

export interface SimulationResult {
  yearlyResults: SimulationYearlyResult[];
  fireAge: number | null; // FIRE 달성(소득 >= 생활비) 가능 나이
  depletionAge: number | null; // 자산 고갈 나이 (0 이하가 되는 시점)
  endingAssets: number; // 시뮬레이션 종료(기대수명) 시점 잔여 자산
  retirementScore: number; // 0 ~ 100 점
  retirementGrade: RetirementGrade; // 점수 등급 (매우 안정, 안정, 보통, 주의, 위험)
  // 은퇴 후 **연금·배당 등 소득만으로** 목표 생활비를 얼마나 채우는지의 비율(%).
  // 자산을 팔아 쓴 인출분은 분자에 넣지 않는다 — 그래서 원금을 계획적으로 헐어 쓰는
  // 정상적인 계획도 100%에 도달하지 않는다.
  //
  // 이 정의가 리포트에서 오해를 샀다. "은퇴 소득 달성률 62%"라는 이름만 보면 목표 생활비의
  // 62%밖에 못 쓴다는 뜻으로 읽히지만, 실제로는 자산 인출을 포함해 목표의 80%를 쓰고 있었다.
  // 이름과 분자·분모를 함께 드러내야 한다(아래 두 필드).
  goalAchievementRate: number;
  // 아래 두 필드는 엔진이 항상 채우지만 선택적이다 — calculatedTargetSpending·utility와 같은
  // 관례로, 손으로 만든 결과 객체(테스트 픽스처 등)에는 이 값이 존재하지 않는 것이 정직하다.
  // 화면은 없으면 비율만 보여준다.
  //
  // goalAchievementRate의 분자: 은퇴 후 연평균 월 «고정»소득(배당 + 국민연금 + 기타, 세후).
  // 사적연금 인출은 빠진다 — 연금계좌라는 자산을 헐어 쓰는 것이라 일반자산 매도와 실질이
  // 같고, 이 지표는 자산 매도·인출분을 제외한다고 스스로 선언한다.
  avgRetirementMonthlyIncome?: number;
  // goalAchievementRate의 분모: 은퇴 후 연평균 월 목표 생활비(연령대 배수·물가·의료비 반영).
  avgTargetMonthlySpending?: number;
  // 「지속가능 생활비」 — 이 계획의 제약 아래에서 «월 얼마까지 쓸 수 있는가».
  //
  // **전략이 아니라 지표다.** `max_sustainable` 전략이 내부 전용이 된 뒤에도 이 값은 그대로
  // 남는다(SpendingStrategy 주석). 두 값의 성격이 다르기 때문이다.
  //
  //  - `'target'`(오늘 제품의 모든 계획): `findMaxSustainableValue`가 «바닥을 뗀 채» 재는
  //    참고치다. 계획이 실제로 쓰는 금액이 아니라 「여기까지 가능하다」는 안내이고,
  //    KPI 카드·조언 배너·PDF가 이 값을 보여준다.
  //  - `'max_sustainable'`(내부 전용): 탐색값이 «곧» 그 계획의 생활비다
  //    (`findMaxSustainable`). 그래서 그 계획에는 「더 쓰세요/덜 쓰세요」 조언을 하지 않는다.
  //
  // 즉 전략을 걷어내는 논의가 이 필드까지 오면 안 된다. 지우면 'target' 계획의 표시가 함께
  // 사라진다.
  calculatedTargetSpending?: number;
  // 탐색값과 전달 계획이 갈라졌을 때만 채워진다(SustainableSpendingFloorOverride 주석).
  // 화면·리포트는 이 값으로 「왜 인출이 늘었는지」와 「이것은 권장액이 아니라 한계값」을 말한다.
  sustainableSpendingOverride?: SustainableSpendingFloorOverride;
  retirementAssetsAtRetirement: number; // 은퇴 시작 시점 총자산 (해석/배너 표시용)
  utility?: UtilityBreakdown; // Lifetime Utility Score
  recommendation?: StrategyRecommendation; // AI 추천 전략 (별도 계산 시에만 채워짐)
}

/**
 * Deterministic projection of one supplied strategy.
 * Goal scoring, grades, FIRE interpretation, utility and recommendations belong to evaluation.
 */
export interface StrategySimulationResult {
  yearlyResults: SimulationYearlyResult[];
  depletionAge: number | null;
  endingAssets: number;
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
  // 기대수명까지 «버티기는 했지만» 완충자본이 0인 계획의 depletionSafety 원점수 (기본 0.7).
  // 고갈 구간 [0, S]와 생존 구간 [S, 1]의 경계이며, 두 구간이 여기서 이어진다.
  survivalBaseScore: number;
  // depletionSafety가 만점이 되는 완충 여유(연). 기말자산 ÷ 연 목표생활비가 이 값에 도달하면
  // 그 위로는 더 오르지 않는다 — 완충은 변동성을 견디는 힘이지 많을수록 좋기만 한 것이
  // 아니고, 과다 잔여의 대가는 bequestAdequacy가 따로 매긴다 (기본 5).
  fullBufferYears: number;
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
  // 같은 축을 «사용자의 실제 계획» 위에서 다시 검증한 결과. 자동 채움(applyAiSentinels)이
  // 쓰는 유일한 값이다.
  //
  // recommendedAssetReinvestment는 Phase 1+2가 고른 인출계획(bestPlan) 위에서 평가된다.
  // 그 인출계획이 사용자에게 적용되지 않는 상태(사용자가 개시 나이를 직접 정해 둔 경우 등)에서
  // 배당 축만 떼어 오면 엔진이 한 번도 평가한 적 없는 조합이 되고, baseline보다 나빠질 수 있다 —
  // verifiedSentinelPlan이 인출계획 축에 대해 막고 있는 것과 같은 함정이다.
  // 그래서 identityPlan(= 사용자의 계획) 위에서 한 번 더 평가해, 사용자의 현재 효용을 실제로
  // 넘는 조합만 여기 담는다. 개선이 없거나 이 축이 센티널이 아니면 null.
  verifiedAssetReinvestment: Record<string, boolean> | null;
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
  // recommendedResult를 만든 «바로 그» params. improved가 false이면 사용자의 원본 params다.
  //
  // 추천은 여러 단계가 쌓인 결과다 — 인출계획(Phase 1/2)·생활비 배수·자산별 배당 재투자
  // (Phase 3)·사적연금 채널링과 신규 연금 납입(Phase 4). recommendedPlan 하나로는 그 조합을
  // 복원할 수 없어서, 결과를 재현하려면 단계가 늘 때마다 재현 코드를 따라 고쳐야 했다
  // (robustness.test.ts가 실제로 두 번 그렇게 깨졌다). 조합 자체를 돌려주면 그 추적이 끝난다.
  recommendedParams: SimulationParams;
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

/**
 * 배당을 다시 사들일지 현금으로 받을지.
 *
 * 저장소는 여전히 자산별 `InvestmentAsset.reinvestDividend`다. 이 축은 «누가 그 값을 정하는가»를
 * 말한다 — 'reinvest_all'/'cash_all'이면 compileStrategy가 전 자산을 그 값으로 덮어쓰고,
 * 'ai_optimized'이면 저장된 자산별 값을 기준선으로 두되 AI가 개선을 확인한 자산만 계산에서 뒤집는다.
 */
export type DividendStrategy = 'ai_optimized' | 'reinvest_all' | 'cash_all';

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

// 수익률을 «지배하는» 값(conservative/neutral/aggressive)은 2026-08-22에 제거됐다.
// 수익률의 유일한 출처는 사용자 입력이고, 프리셋은 자산 폼의 「일괄 채우기」 도우미와
// 민감도·강건성 렌즈로만 남는다. 남는 두 값의 차이는 강건성 검증 on/off 하나다.
export type RiskProfile = 'custom' | 'ai_recommended';

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
  // 아래 셋은 optional이다. 필수로 만들면 이미 저장된 시나리오의 strategy 객체가 타입과
  // 어긋나고, 전체 객체를 하드코딩한 테스트 픽스처가 전부 깨진다.
  //
  // 앞의 둘(spendingShape·bequestSafetyMarginRate)은 DEFAULT_RETIREMENT_STRATEGY가 메우므로
  // resolveStrategy를 거친 뒤에는 언제나 값이 있다. **minMonthlySpending은 일부러 메우지
  // 않는다** — undefined가 "경고 없음"이라는 유효한 상태이기 때문이다(compileStrategy.ts의
  // DEFAULT_RETIREMENT_STRATEGY 주석 참고). 이 셋을 싸잡아 non-null로 다루지 말 것.

  // 은퇴 후 생활비를 연령대별로 어떻게 배분할지. 미지정·'flat'이면 기존 동작(전 구간 균등).
  spendingShape?: SpendingShapePreset;
  // 목표 상속자산 위에 얹는 안전마진(%). 엔진 제약(assetFloor)만 부풀리고
  // 채점 기준(userProfile.targetBequest)은 건드리지 않는다 — 두 값의 역할 구분을 지킨다.
  // 미지정·0이면 기존 동작.
  bequestSafetyMarginRate?: number;
  // 배당 재투자를 누가 정하는가. 미지정이면 'ai_optimized'(기본)으로 해소된다.
  // 자산별 값을 지우지 않으므로, 이 축을 바꿔도 전문가가 손으로 넣은 값은 저장본에 남는다.
  dividendStrategy?: DividendStrategy;
  // 역산된 생활비가 이 값에 못 미치면 화면이 경고한다. **엔진 params로 내려가지 않는다** —
  // 시뮬레이션을 바꾸지 않고 판정만 하기 때문이다. 이진탐색의 성공 조건에 넣으면 계획
  // 전체가 실패로 떨어져 "얼마까지 쓸 수 있는가"라는 답 자체가 사라진다.
  minMonthlySpending?: number;
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
  /**
    * 이 시나리오의 분석 요청을 실행한 마지막 시각(ISO), 아직 실행하지 않았으면 null.
   *
   * 결과 화면을 복원하는 유일한 근거다. 결과 자체는 저장하지 않고 data로 다시 계산하므로
   * (Scenario.analyzedAt의 스키마 주석 참조), 이 값이 없으면 화면은 안내 문구로 시작한다.
   */
  analyzedAt: string | null;
  /**
    * 마지막 분석 요청의 입력을 식별하는 해시. 현재 입력과 비교해 「재분석 필요」 배지를 결정한다
   * (값 자체는 화면에 나오지 않는다). 이 필드가 생기기 전에 저장된 시나리오에는 없으며,
   * 없거나 버전이 다르면 «틀렸다»가 아니라 «알 수 없다»로 다룬다.
   */
  analyzedParamsHash?: string | null;
  createdAt: string;
  updatedAt: string;
}
