import type { GoalSuccessConditions } from '../usecases/goals/goalSuccessConditions';

// 몬테카를로 시뮬레이션의 입력과 결과.
//
// **MonteCarloConfig를 SimulationParams에 넣지 않는 이유**: SimulationParams는 결정론
// 엔진의 입력이자 E2EE로 저장되는 것이라, 여기에 MC 노브를 넣으면 저장된 모든 시나리오가
// 그것을 들고 다니고 compileStrategy·robustness·RecommendationEngine이 그 필드를 어떻게
// 다룰지 매번 결정해야 한다. 대신 params에서 유도한다(resolveMonteCarloConfig).
export interface MonteCarloConfig {
  trials: number;
  // 고정 상수여야 한다. 시각 기반이면 사용자가 아무것도 바꾸지 않았는데 새로고침마다
  // 성공률이 88%↔91%로 흔들려 그 숫자를 믿을 수 없게 된다. 표본오차가 편향으로 굳는
  // 대가를 치르지만, 1000회에서 성공률의 표준오차는 약 0.95%p라 1%p 표시에서 안정적이다.
  seed: number;
  // 연 수익률의 표준편차(%p). 시장 요인 하나를 모든 위험자산이 공유한다(ReturnShockPath 주석).
  annualStdDev: number;
}

// 연도별 하방 지점. p50/p90도 함께 들고 있었지만 차트가 세 선에서 한 선으로 줄면서
// 소비처가 없어졌다 — 계산해서 워커 경계 너머로 실어 보내는 비용만 남아 있었다.
export interface MonteCarloDownsideYear {
  age: number;
  p10: number;
}

// goalSuccessProbability의 세 판정 조건별 실패 시행 수. 판정식은 runMonteCarlo 한 곳에만
// 있고 여기에는 그 결과만 집계한다.
export interface GoalFailureBreakdown {
  // 은퇴 후 어느 해든 목표 생활비를 1만원 이상 채우지 못한 시행 수.
  spendingShortfall: number;
  // 기대수명 전에 자산이 고갈된 시행 수.
  assetDepletion: number;
  // 기말자산이 목표(targetBequest 또는 assetFloor)에 못 미친 시행 수.
  terminalShortfall: number;
  // 생활비 미달이 **처음 발생한 나이**의 중앙값. 미달 시행이 없으면 null.
  // "언제부터 무너지는가"는 원인 지목에 필요한 최소 정보다 — 은퇴 직후부터면 계획 자체가
  // 과하고, 20년 뒤부터면 인출 경로나 장수 위험이다.
  medianFirstShortfallAge: number | null;
  // 세 번째 조건이 실제로 쓴 기말자산 목표액. 0이면 그 조건은 사실상 없다.
  terminalAssetGoal: number;
}

export interface MonteCarloResult {
  trials: number;
  seed: number;
  // 화면·PDF에서 결과 가정을 숨기지 않기 위한 실제 연 변동성(%p).
  annualStdDev?: number;
  // 성공 판정 기준 나이 = 시뮬레이션 종료 나이(본인 기대수명). 결정론 시뮬레이션의
  // 고갈 판정과 같은 나이를 써야 성공률과 화면 문구가 어긋나지 않는다.
  //
  // 다만 나이는 같아졌어도 경계 연산자는 아직 다르다. 성공 판정은 depletionAge > successAge,
  // 화면의 상태 판정(resolvePlanAssetStatus)은 depletionAge < expectancy를 고갈로 본다.
  // 그래서 정확히 expectancy에 고갈되는 경로는 몬테카를로에서 실패, 화면에서는 유지로 갈린다.
  // 어느 쪽 경계가 옳은지는 아직 정하지 않았다.
  successAge: number;
  // **자산 보존 성공률.** successAge까지 자산이 고갈되지 않은 시행의 비율(0~1).
  successRate: number;
  // **생활 유지 성공률.** 계획한 생활비를 한 해도 줄이지 않은 시행의 비율(0~1).
  //
  // successRate만으로는 "자산은 남았지만 계획의 70%로 버틴" 시행이 성공으로 집계된다.
  // 인출 경로가 잔액을 넘겨 인출하지 않아 그런 해에도 totalAssets가 0이 되지 않기 때문이다
  // (SimulationYearlyResult.unmetSpending 주석).
  //
  // **자산 고갈 여부와 독립적으로 센다.** 예전 정의(fullSpendingRate)는 자산이 살아남은
  // 시행 안에서만 결손 없음을 셌다. 그래서 국민연금 같은 종신소득이 생활비를 덮는 경로 —
  // 투자자산은 바닥나지만 생활은 무너지지 않는 경로 — 가 통째로 실패로 집계됐다. 실제
  // 리포트에서 79세에 투자자산이 소진되고도 연금 잉여로 현금이 다시 쌓이던 계획이 그 모양이다.
  //
  // 그 결과 두 비율은 더 이상 포함 관계가 아니다(spendingSuccessRate <= successRate가
  // 성립하지 않는다). 어느 쪽이 큰지가 그 계획의 성격을 말한다 — 생활 유지가 더 높으면
  // 종신소득이 두꺼운 계획이고, 자산 보존이 더 높으면 상속 여력은 있으나 생활수준을 깎아
  // 버틴 계획이다. 화면은 반드시 둘을 함께 보여줘야 한다.
  //
  // **54인 페르소나 실측(`npm run harness:personas`).** 두 비율이 1%p 이상 갈린 페르소나는
  // 2명이고 **둘 다 자산 보존 > 생활 유지** 방향이었다(상속 목표가 인출을 막는 계획):
  // 「60대 중 상속 우선」이 자산 100% / 생활 32.8%로 최대 격차 67.2%p. 옛 화면은 그 사람에게
  // "성공률 100%"라고 말했지만, 실제로는 세 번 중 두 번 계획한 생활비를 못 쓴다.
  //
  // 반대 방향(생활 유지 > 자산 보존)은 54명 중 0명이었다. 인출 경로가 매달
  // `min(잔액, 필요액)`으로 깎기 때문에, 적자 구간에서 자산이 0에 닿는 해는 거의 언제나 그
  // 해에 결손도 함께 낸다. 그럼에도 접합을 없앤 이유는 숫자가 아니라 정의다 — "쓰기로 한
  // 만큼 쓰며 살았는가"에 "그리고 돈이 남았는가"를 덧붙일 근거가 없고, 기대수명에 정확히
  // 고갈되는 경계 시행에서는 실제로 갈린다(successAge 주석의 경계 불일치 참조).
  spendingSuccessRate: number;
  // 사용자가 입력한 목표 생활비, 기대수명까지 자산 생존, 명시된 기말자산 목표를 같은
  // 시행에서 모두 만족한 비율. 두 주변확률의 최솟값으로 추정하지 않고 시행별 교집합을
  // 직접 센다. 정량 판정 기준이 아직 없는 정성 목표는 이 확률에 포함하지 않는다.
  //
  // optimizer가 쓰는 이름(spendingSuccessProbability, terminalAssetMedian 등)은 여기 두지
  // 않는다. 그 값들은 이미 successRate/spendingSuccessRate/endingAssets에 있고, 같은 수를 두
  // 필드에 저장하면 둘이 어긋날 수 있다. 이름 변환은 MonteCarloEngine.validate가 담당한다.
  goalSuccessProbability: number;
  // goalSuccessProbability가 낮을 때 **무엇이 그 값을 떨어뜨렸는지**. 확률 하나만 보여주면
  // 사용자는 언제나 "자산이 모자란다"로 읽지만, 실제로는 자산이 남아도는데 인출이 막혀
  // 목표 생활비를 못 채우는 계획이 같은 2%를 받는다(사적연금 「최소 인출」이 그렇다:
  // 저율과세 한도의 25%가 월 인출 상한이 되어, 일반계좌가 마른 뒤로는 목표를 채울 방법이
  // 없는데 연금 잔액은 그대로 남아 고갈로도 잡히지 않는다).
  //
  // 한 시행이 여러 원인에 동시에 해당할 수 있으므로 세 값의 합은 (trials - 성공 시행 수)와
  // 같지 않다.
  goalFailure: GoalFailureBreakdown;
  // 위 확률이 **무엇을 판정한 것인지**. 선택한 목표에서 유도한 조건인지, 판정 가능한 목표가
  // 없어 계획의 기본 조건으로 되돌아갔는지, 그리고 어떤 목표가 이 확률에 반영되지 않았는지.
  // 숫자만 보여주면 사용자는 자기가 고른 목표 전부가 반영됐다고 읽는다.
  goalConditions: GoalSuccessConditions;
  // 위 두 비율이 판정 기준으로 삼은 월 생활비(freezeSpendingPlan이 고정한 값).
  //
  // 「평생 소비 최적화」에서 이 값은 사용자가 입력한 목표(예: 월 350만원)가 아니라 엔진이
  // 역산한 지속가능액(예: 월 223만원)이다(freezeSpendingPlan.ts). 밝히지 않으면 화면의
  // "생활비를 한 해도 줄이지 않을 확률"을 사용자는 자기 목표 기준으로 읽는다.
  plannedMonthlySpending: number;
  endingAssets: { p10: number; p50: number; p90: number };
  // 연도별 총자산의 하위 10% 지점. 자산 추이 차트의 「나쁜 경우」 선이 유일한 소비처다.
  //
  // **각 해의 값은 서로 다른 시행에서 온다** — 이 배열은 어느 한 시행의 경로가 아니다.
  // 화면도 그 사실을 문구로 밝힌다(AssetGrowthChart의 DOWNSIDE_NOTE).
  assetDownside: MonteCarloDownsideYear[];
  depletion: {
    count: number;
    earliestAge: number | null;
    medianAge: number | null;
  };
  // 결정론 실행(충격 없음)의 기말자산.
  //
  // **변동성 손실**을 드러내는 값이다: 충격의 기대값이 0이어도 복리로 굴리면 기하평균 <
  // 산술평균이라 p50이 이 값보다 낮게 나온다. MonteCarloSection이 두 값을 나란히 인쇄해
  // 그 차이를 설명한다(Pro 한정).
  deterministicEndingAssets: number;
}

/**
 * Compact contract consumed by the strategy optimizer after deterministic shortlisting.
 *
 * The legacy dashboard result above is intentionally retained. These explicit names keep
 * optimizer ranking independent from chart-oriented fields and avoid changing persisted or UI
 * contracts while the goal-based recommendation flow is introduced.
 */
export interface StrategyMonteCarloValidationResult {
  trials: number;
  seed: number;
  goalSuccessProbability: number;
  spendingSuccessProbability: number;
  assetSurvivalProbability: number;
  terminalAssetMedian: number;
  terminalAssetP10: number;
  terminalAssetP90: number;
  shortfallProbability: number;
}
