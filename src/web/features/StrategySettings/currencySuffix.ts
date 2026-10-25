import { AssetCurrency } from '../../../core/entities/types';

// 표시 통화(displayCurrency)로 해석되는 금액 입력의 단위 표기.
//
// 어떤 금액 필드가 이 함수를 써야 하는지는 "엔진이 그 값을 무엇과 비교하는가"로 갈린다.
// 엔진은 자산·연금 흐름을 전부 displayCurrency로 환산한 뒤(SimulationEngine.convertValue)
// 목표 생활비·의료비·목표 상속자산과 맞대므로, 그 세 부류는 displayCurrency 단위다.
// 반대로 국민연금 예상액·저율과세 한도·적용 환율은 한국 제도/환율 그 자체라 언제나 KRW이며,
// 그 필드들은 '원'을 그대로 적는다.
//
// 단위를 KRW로 고정해 두면 USD 표기로 바꾼 사용자가 달러 값을 넣으면서 '원'을 보게 되고,
// 화면 표기와 엔진 해석이 어긋난다 — 이 브랜치가 반복해서 걷어낸 결함 형태다.
export function currencySuffix(displayCurrency: AssetCurrency): string {
  return displayCurrency === 'KRW' ? '원' : displayCurrency;
}
