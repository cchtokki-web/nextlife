import { TaxLawVersion, TaxSettings } from '../../entities/types';
import { TaxLawProfile, resolveTaxLawProfile } from './taxLawProfiles';
import { resolveTaxSettings } from './taxRates';

// 한 번의 시뮬레이션이 쓰는 과세 규칙 전체.
//
// 두 축이 있고 성격이 다르다:
//   - profile  : 세법이 정하는 값(세율표·한도·구간). 사용자가 고르는 것은 "어느 세법 버전인가"뿐이다.
//   - settings : 사용자가 고급 설정에서 직접 조정하는 값(세율 오버라이드, 항목별 on/off).
//
// ## 왜 묶어서 넘기는가
//
// 예전에는 taxRates.ts가 모듈 로드 시점에 `TAX_LAW_PROFILES.current`를 평평한 상수로
// 재노출하고 TaxEngine이 그 상수를 import했다. 그래서 `params.taxLawVersion`은 고급 설정에서
// 저장은 되지만 계산에는 **한 번도 도달하지 않았다** — resolveTaxLawProfile의 호출자가
// 테스트밖에 없었다. 버전 축이 있는 척하는 죽은 구조였다.
//
// 프로필을 인자로 받게 하면 그 경로가 실제로 이어지고, 동시에 세율표를 참조하는 코드가
// 어디인지 시그니처에 드러난다. 개정안 프로필을 추가할 때 무엇을 고쳐야 하는지 컴파일러가
// 알려준다는 뜻이다.
export interface TaxContext {
  profile: TaxLawProfile;
  settings: Required<TaxSettings>;
}

// 저장된 시나리오에 taxLawVersion이나 taxSettings가 없어도(구 데이터) 항상 완전한 컨텍스트를
// 돌려준다 — 두 resolve 함수 모두 자체 폴백을 갖고 있다.
export function resolveTaxContext(
  taxSettings?: Partial<TaxSettings>,
  taxLawVersion?: TaxLawVersion
): TaxContext {
  return {
    profile: resolveTaxLawProfile(taxLawVersion),
    settings: resolveTaxSettings(taxSettings),
  };
}
