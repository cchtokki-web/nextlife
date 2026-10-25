'use client';

import { useCallback, useSyncExternalStore } from 'react';

// 브라우저에만 있는 값을 읽는 훅 모음.
//
// 이런 값을 "마운트 이펙트에서 읽어 setState"로 가져오면 서버 값으로 한 번 커밋한 뒤 다시
// 렌더된다. 사용자는 잘못된 화면을 한 프레임 보고, React Compiler도 그 형태를 막는다
// (set-state-in-effect). useSyncExternalStore는 그 저장소를 직접 구독하므로 상태도 이펙트도
// 필요 없다 — 서버 스냅샷과 클라이언트 스냅샷을 따로 주는 것이 이 API의 존재 이유다.

const noopSubscribe = () => () => {};

// 하이드레이션이 끝났는지. 서버 스냅샷이 false, 클라이언트 스냅샷이 true이므로
// 하이드레이션 직후 한 번 true로 바뀐다.
export function useIsHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

// CSS 미디어 쿼리 일치 여부. 창 크기가 바뀌면 함께 갱신된다.
//
// 서버에서는 판정할 수단이 없으므로 false를 돌려준다. 호출부는 "아직 모른다"를 어떻게 그릴지
// 정해야 한다 — 보통은 데스크톱 레이아웃을 기본으로 두고 하이드레이션 후 좁은 화면이면 접는다.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', onStoreChange);
    return () => list.removeEventListener('change', onStoreChange);
  }, [query]);

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
