import { SimulationYearlyResult } from './types';

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

export interface MonteCarloBandYear {
  age: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface MonteCarloResult {
  trials: number;
  seed: number;
  // 성공 판정 기준 나이 = 시뮬레이션 종료 나이(본인 기대수명). 결정론 시뮬레이션의
  // 고갈 판정과 같은 나이를 써야 성공률과 화면 문구가 어긋나지 않는다.
  //
  // 다만 나이는 같아졌어도 경계 연산자는 아직 다르다. 성공 판정은 depletionAge > successAge,
  // 화면의 상태 판정(resolvePlanAssetStatus)은 depletionAge < expectancy를 고갈로 본다.
  // 그래서 정확히 expectancy에 고갈되는 경로는 몬테카를로에서 실패, 화면에서는 유지로 갈린다.
  // 어느 쪽 경계가 옳은지는 아직 정하지 않았다.
  successAge: number;
  // successAge까지 자산이 고갈되지 않은 시행의 비율(0~1).
  successRate: number;
  // 목표 생활비를 한 해도 빠짐없이 온전히 쓴 시행의 비율(0~1).
  //
  // successRate만으로는 "자산은 남았지만 목표의 70%로 버틴" 시행이 성공으로 집계된다.
  // 인출 경로가 잔액을 넘겨 인출하지 않아 그런 해에도 totalAssets가 0이 되지 않기 때문이다
  // (SimulationYearlyResult.unmetSpending 주석).
  fullSpendingRate: number;
  endingAssets: { p10: number; p50: number; p90: number; mean: number };
  // 연도별 총자산 분위수. 팬 차트용.
  assetBand: MonteCarloBandYear[];
  depletion: {
    count: number;
    earliestAge: number | null;
    medianAge: number | null;
  };
  // 결정론 실행(충격 없음)의 기말자산.
  //
  // 팬 차트에 겹쳐 그려 **변동성 손실**을 드러낸다: 충격의 기대값이 0이어도 복리로 굴리면
  // 기하평균 < 산술평균이라 p50이 이 값보다 낮게 나온다. 그것이 이 기능의 존재 이유다.
  deterministicEndingAssets: number;
  // 최악 10분위에 해당하는 대표 경로 하나. 밴드만으로는 "실제로 이런 인생"이 보이지 않는다.
  worstDecilePath: SimulationYearlyResult[];
}
