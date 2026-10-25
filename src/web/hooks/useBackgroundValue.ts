'use client';

import { startTransition, useEffect, useState } from 'react';

// 값을 "한 커밋 뒤"로 미루고, 아직 따라잡지 못했는지를 함께 알려 준다.
//
// useDeferredValue를 연쇄해서는 이것을 만들 수 없다. React 19의 updateDeferredValueImpl은
// 현재 렌더가 이미 비긴급(지연) 렌더이면 새 값을 그대로 반환하므로, 첫 useDeferredValue가
// 만든 지연 렌더 안에서 두 번째 useDeferredValue는 항상 no-op이 된다. 그 결과
// `second !== first`로 만든 로딩 상태는 프로덕션에서 단 한 번도 true가 되지 않는다
// (테스트만 prop을 직접 주입해 통과하고 있었다).
//
// 대신 "커밋된 뒤에 트랜지션으로 따라가기" 파이프라인을 쓴다:
//   렌더 1 — 새 value로 커밋. deferred는 아직 이전 값이고 isPending이 true다.
//   이펙트  — startTransition 안에서 deferred를 최신 value로 올린다.
//   렌더 2 — 비긴급 우선순위로 무거운 계산이 돈다. 타이핑 등 긴급 입력이 이를 중단시킨다.
//
// 이렇게 해야 (1) 렌더 1이 관측 가능해져 로딩 UI가 실제로 뜨고 (2) 무거운 계산이
// 앞 단계 계산과 같은 렌더 패스에서 실행되지 않는다.
export function useBackgroundValue<T>(value: T): readonly [T, boolean] {
  const [deferred, setDeferred] = useState(value);

  useEffect(() => {
    // 이미 같은 값이면 상태를 건드리지 않는다 — 불필요한 트랜지션 렌더를 막는다.
    if (Object.is(deferred, value)) return;
    startTransition(() => setDeferred(value));
    // deferred를 의존성에 넣으면 따라잡은 직후 이펙트가 한 번 더 도는데, 위 가드가
    // 즉시 반환하므로 무해하다. 넣지 않으면 stale closure 경고가 난다.
  }, [value, deferred]);

  return [deferred, !Object.is(deferred, value)] as const;
}
