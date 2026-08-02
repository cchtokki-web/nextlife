"use client";

import React, { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'theme';
// NextLife의 기본 외관은 다크다. 저장된 값이 없으면 이 값을 쓴다.
const DEFAULT_THEME: Theme = 'dark';

// localStorage는 React 바깥의 저장소다. 마운트 이펙트에서 읽어 setState하면 "서버 값으로 한 번
// 커밋 → 이펙트 → 다시 렌더"가 되어 렌더가 한 번 더 돌고, 그 사이의 잘못된 테마를 가리려고
// 화면 전체를 opacity로 덮어야 했다. useSyncExternalStore는 그 저장소를 직접 구독한다.
//
// 같은 탭의 변경에는 storage 이벤트가 오지 않으므로(다른 탭에서만 발화한다) 자체 리스너를 함께 둔다.
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener('storage', onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

function getThemeSnapshot(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' ? saved : DEFAULT_THEME;
}

// 서버에는 localStorage가 없다. 하이드레이션이 어긋나지 않으려면 서버 렌더와 클라이언트의 첫
// 렌더가 같은 값을 봐야 하므로 기본값을 돌려준다. 저장된 값이 다르면 하이드레이션 직후 한 번
// 갱신되는데, 그 순간을 아래 hydrated 게이트가 덮는다.
function getThemeServerSnapshot(): Theme {
  return DEFAULT_THEME;
}

// "하이드레이션이 끝났는가". 상태와 이펙트 없이 같은 판정을 얻는 표준 관용구다 —
// 서버 스냅샷은 false, 클라이언트 스냅샷은 true이므로 하이드레이션 직후 true로 바뀐다.
const noopSubscribe = () => () => {};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getThemeSnapshot, getThemeServerSnapshot);
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  // data-theme은 CSS 변수를 갈아 끼우는 DOM 부수 효과라 이펙트가 제자리다(상태를 만들지 않는다).
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const next: Theme = getThemeSnapshot() === 'light' ? 'dark' : 'light';
    localStorage.setItem(STORAGE_KEY, next);
    // 같은 탭에서는 storage 이벤트가 오지 않으므로 직접 알린다.
    listeners.forEach((listener) => listener());
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <div style={{ opacity: hydrated ? 1 : 0, width: '100%', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
