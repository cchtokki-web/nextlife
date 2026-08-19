import React from 'react';
import { priceGrowthRate } from '../../../core/usecases/returns/decomposeReturn';
import styles from './AssetForm.module.css';

interface ReturnBreakdownHintProps {
  totalReturn: number;
  dividendYield: number;
}

/**
 * 입력한 총수익률이 엔진 안에서 어떻게 나뉘는지 입력칸 바로 아래에 보여준다.
 *
 * 이 표시가 필요한 이유가 이번 변경의 출발점이다 — 예전에는 화면이 "예상 연 수익률"이라
 * 부르는 값을 엔진이 가격상승률로 읽고 배당을 위에 얹었고, 사용자는 자기 시뮬레이션이
 * 실제로 몇 %로 돌았는지 알 방법이 없었다. 분해를 눈에 보이게 두면 같은 어긋남이
 * 다시 생겨도 즉시 드러난다.
 *
 * 계산은 엔진과 같은 함수(priceGrowthRate)를 쓴다. 여기서 따로 빼면 화면이 말하는
 * 가격상승률과 엔진이 쓰는 값이 갈라진다.
 */
export function ReturnBreakdownHint({ totalReturn, dividendYield }: ReturnBreakdownHintProps) {
  const growth = priceGrowthRate(totalReturn, dividendYield);

  return (
    <div className={styles.returnBreakdown}>
      → 가격상승 {formatPercent(growth)} + 배당 {formatPercent(dividendYield)}
      {growth < 0 && (
        <div className={styles.returnBreakdownNotice}>
          ⓘ 분배금이 총수익률보다 커서 NAV가 줄어드는 것으로 계산됩니다.
          커버드콜·고배당 ETF라면 정상입니다.
        </div>
      )}
    </div>
  );
}

/**
 * 부동소수 뺄셈(9.4 − 1.4 = 7.999999999999999)이 만드는 꼬리를 화면에 흘리지 않는다.
 * 입력 단위가 0.1%p라 소수 첫째 자리까지만 의미가 있다.
 *
 * 음수는 하이픈이 아니라 −(U+2212)로 적는다 — 좁은 폭에서 하이픈은 글머리표처럼 보인다.
 */
function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded < 0 ? '−' : ''}${Math.abs(rounded)}%`;
}
