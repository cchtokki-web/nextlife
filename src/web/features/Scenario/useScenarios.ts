import { useState, useEffect, useCallback, useRef } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { SimulationParams, ScenarioModel } from '../../../core/entities/types';
import type { EncryptedData } from '../../../core/utils/crypto';
import { useIsHydrated } from '../../hooks/useBrowserEnvironment';
import { loadParams, saveParams, initialParams } from '../../../infrastructure/storage/localStore';
import {
  normalizeSimulationParamsWithIssues,
  reportNormalizationIssues,
} from '../../../infrastructure/storage/normalizeSimulationParams';
import { describeIssue, financialIssues } from '../../../infrastructure/storage/normalizationIssues';
import { activeScenarioKeyName, e2eeKeyName, e2eeBackedUpKeyName, LOCAL_ANALYZED_AT_KEY, LOCAL_ANALYZED_PARAMS_HASH_KEY } from '../../../infrastructure/storage/storageKeys';
import { scenarioAnalysisHash } from '../../../core/utils/scenarioAnalysisHash';
import { encryptData, decryptData, isEncryptedPayload, generateBackupKey } from '../../../core/utils/crypto';
import { MAX_SCENARIO_COUNT } from '../../../core/utils/scenarioLimits';
import { MAX_COMPARE_SCENARIO_COUNT } from '../../../core/utils/compareScenarios';
import { migrateRetirementGoals } from '../../../core/usecases/goals/retirementGoalAdapter';

// GET /api/scenarios 응답. data의 각 항목은 평문(SimulationParams)일 수도, E2EE로 암호화된
// 형태일 수도 있어 소비처가 복호화를 시도하며 좁힌다.
interface ScenarioListResponse {
  data?: Array<Omit<ScenarioModel, 'data'> & { data: unknown }>;
  // 이 계정이 보안키로 잠겨 있는지. payload 모양과 독립적인 서버 기록이라, 평문 행이 섞여
  // 있어도 키 요구가 사라지지 않는다.
  e2eeEnabled?: boolean;
  // 이 계정이 마지막으로 선택한 시나리오. 계정에 붙어 있으므로 다른 기기에서 로그인해도 온다.
  lastActiveScenarioId?: string | null;
  // 이 계정이 함께 비교하던 시나리오들. 같은 이유로 계정에 붙어 있다.
  compareScenarioIds?: string[];
}

class ScenarioRequestError extends Error {
  constructor(readonly status: number) {
    super(`서버 응답 오류 (HTTP ${status})`);
    this.name = 'ScenarioRequestError';
  }
}

const convertToRepresentativeAssets = (params: SimulationParams): SimulationParams => {
  if (!params.assets) return params;
  let changed = false;
  const convertedAssets = params.assets.map(asset => {
    if (asset.ticker === '안전자산' || asset.name === '예금/채권 혼합') {
      changed = true;
      const avgPrice = 35000;
      const qty = Math.max(1, Math.floor(asset.averagePrice / avgPrice));
      return {
        ...asset,
        ticker: '069500',
        name: 'KODEX 200',
        quantity: qty,
        averagePrice: avgPrice,
        totalReturn: 5.0,
        dividendYield: 2.0,
        currency: 'KRW' as const,
        assetMarket: 'KR_ETF' as const
      };
    }
    if (asset.ticker === '혼합자산' || asset.name === '배당ETF/채권 혼합') {
      changed = true;
      const avgPrice = 15000;
      const qty = Math.max(1, Math.floor(asset.averagePrice / avgPrice));
      return {
        ...asset,
        ticker: '360750',
        name: 'TIGER 미국S&P500',
        quantity: qty,
        averagePrice: avgPrice,
        totalReturn: 8.0,
        dividendYield: 1.5,
        currency: 'KRW' as const,
        assetMarket: 'KR_ETF' as const
      };
    }
    if (asset.ticker === '성장자산' || asset.name === '성장형 ETF') {
      changed = true;
      const avgPrice = 15000;
      const qty = Math.max(1, Math.floor(asset.averagePrice / avgPrice));
      return {
        ...asset,
        ticker: '133690',
        name: 'TIGER 미국나스닥100',
        quantity: qty,
        averagePrice: avgPrice,
        totalReturn: 9.0,
        dividendYield: 0.5,
        currency: 'KRW' as const,
        assetMarket: 'KR_ETF' as const
      };
    }
    return asset;
  });
  return changed ? { ...params, assets: convertedAssets } : params;
};

/**
 * 로드된 시나리오를 지금 버전이 쓰는 모양으로 맞춘다.
 *
 * 로드 경로 다섯 곳이 전부 이 함수를 지나므로, 저장 데이터의 «정제»도 여기서 한다. 예전에는
 * 로컬 저장소도 서버 payload도 검사 없이 `as SimulationParams`로 캐스팅됐고, 문자열 수량이나
 * NaN 이율이 그대로 엔진까지 갔다. 복호화된 payload도 마찬가지다 —
 * `decryptData<SimulationParams>`의 제네릭은 아무것도 검사하지 않는다.
 *
 * 그래서 인자를 unknown으로 받는다. 타입을 좁혀 받으면 「이미 검증된 값」이라는 거짓말이
 * 호출부마다 다시 생긴다.
 */
const migrateParams = (raw: unknown, tickers: string[]): SimulationParams => {
  const { params, issues } = normalizeSimulationParamsWithIssues(raw);
  reportNormalizationIssues('시나리오 로드', issues);
  let changed = false;
  const migratedAssets = params.assets.map(asset => {
    if (asset.type === 'etf' && tickers.includes(asset.ticker) && asset.name !== asset.ticker) {
      changed = true;
      return { ...asset, name: asset.ticker };
    }
    return asset;
  });
  const withAssets = changed ? { ...params, assets: migratedAssets } : params;
  return migrateRetirementGoals(withAssets);
};

const fetchLatestParamsInfo = async (params: SimulationParams): Promise<SimulationParams> => {
  const updatedParams = { ...params };
  
  // 1. Fetch latest USD/KRW exchange rate
  let baseExchangeRate = params.baseExchangeRate;
  try {
    const rateRes = await fetch('https://open.er-api.com/v6/latest/USD');
    if (rateRes.ok) {
      const data = await rateRes.json();
      if (data && data.rates && typeof data.rates.KRW === 'number') {
        baseExchangeRate = Math.round(data.rates.KRW * 10) / 10;
      }
    }
  } catch (err) {
    console.error('Failed to fetch latest exchange rate:', err);
  }
  updatedParams.baseExchangeRate = baseExchangeRate;

  // 2. Fetch latest stock prices and info for each asset
  if (Array.isArray(updatedParams.assets)) {
    const updatedAssets = await Promise.all(
      updatedParams.assets.map(async (asset) => {
        if (!asset.ticker || asset.ticker === 'NEW') return asset;
        
        let fetchedPrice = asset.averagePrice;
        let fetchedGrowth = asset.totalReturn;
        let fetchedYield = asset.dividendYield;

        try {
          // Fetch price
          const priceRes = await fetch(`/api/stock-price?ticker=${encodeURIComponent(asset.ticker)}`);
          if (priceRes.ok) {
            const priceData = await priceRes.json();
            const fetchedCurrency = priceData.currency;
            // **통화를 모르면 가격을 쓰지 않는다.** 예전에는 `priceData.currency || 'USD'`로
            // 미국 달러라고 «가정»했는데, 이 값은 야후 응답의 meta.currency를 그대로 넘긴
            // 것이라(stock-price/route.ts) 응답 모양이 바뀌면 undefined가 된다. 그러면
            // 069500 같은 원화 종목의 ₩35,000이 USD로 읽혀 환율이 곱해지고, 한 주 단가가
            // ₩47,250,000이 된다 — 종목도 수량도 그대로라 화면에서는 아무것도 이상해
            // 보이지 않고, 자산 총액만 1,350배가 된다. 게다가 이 값은 자동 저장을 타고
            // 저장 데이터에 그대로 남는다.
            //
            // 저장된 단가를 그대로 두는 것이 안전한 실패다. 사용자가 직접 입력한 값이고,
            // 시세 갱신은 편의 기능이지 계산의 전제가 아니다.
            if (typeof priceData.price !== 'number') {
              // 가격 자체가 없는 경우. API가 404로 답하는 정상 경로라 조용히 넘어간다.
            } else if (fetchedCurrency !== 'USD' && fetchedCurrency !== 'KRW') {
              console.error(
                `[stock-price] ${asset.ticker}: 통화를 읽지 못해 시세 갱신을 건너뜁니다`,
                { currency: fetchedCurrency },
              );
            } else if (fetchedCurrency === 'USD' && asset.currency === 'KRW') {
              fetchedPrice = Math.round(priceData.price * baseExchangeRate);
            } else if (fetchedCurrency === 'KRW' && asset.currency === 'USD') {
              fetchedPrice = Math.round((priceData.price / baseExchangeRate) * 100) / 100;
            } else {
              fetchedPrice = priceData.price;
            }
          }
        } catch (err) {
          console.error(`Failed to fetch stock price for ${asset.ticker}:`, err);
        }

        try {
          // Fetch growth rate & dividend yield
          const infoRes = await fetch(`/api/stock-info?ticker=${encodeURIComponent(asset.ticker)}`);
          if (infoRes.ok) {
            const infoData = await infoRes.json();
            if (infoData.totalReturn !== undefined) {
              fetchedGrowth = infoData.totalReturn;
            }
            if (infoData.dividendYield !== undefined) {
              fetchedYield = infoData.dividendYield;
            }
          }
        } catch (err) {
          console.error(`Failed to fetch stock info for ${asset.ticker}:`, err);
        }

        return {
          ...asset,
          averagePrice: fetchedPrice,
          totalReturn: fetchedGrowth,
          dividendYield: fetchedYield,
        };
      })
    );
    updatedParams.assets = updatedAssets;
  }

  return updatedParams;
};

// 마지막으로 선택한 시나리오를 계정에 기록한다.
//
// 결과를 기다리지 않는다. 화면은 이미 그 시나리오로 바뀌어 있고, 이 기록은 다음 로그인에만
// 쓰이므로 실패해도 지금 사용자가 하는 일을 막을 이유가 없다. 실패한 값은 다음 선택이나 다음
// 로드의 정상화가 다시 올린다.
const persistActiveScenarioId = (scenarioId: string): void => {
  // 비로그인 세션이 만든 임시 id다. 서버에 대응하는 행이 없다.
  if (scenarioId.startsWith('local-')) return;
  fetch('/api/user/active-scenario', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenarioId }),
  })
    // 실패를 화면에 띄우지는 않지만 로그는 남긴다. 이 요청이 조용히 계속 실패하면 증상은
    // "다음 로그인에서 엉뚱한 시나리오가 열린다"뿐이라, 로그가 없으면 원인에 닿을 길이 없다.
    .then(res => {
      if (!res.ok) console.error('Failed to persist active scenario: HTTP', res.status);
    })
    .catch(err => console.error('Failed to persist active scenario:', err));
};

// 함께 비교 중인 시나리오 목록을 계정에 기록한다. 위와 같은 이유로 결과를 기다리지 않는다.
const persistCompareScenarioIds = (compareScenarioIds: string[]): void => {
  fetch('/api/user/active-scenario', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ compareScenarioIds }),
  })
    .then(res => {
      if (!res.ok) console.error('Failed to persist compare scenarios: HTTP', res.status);
    })
    .catch(err => console.error('Failed to persist compare scenarios:', err));
};

// 분석 요청이 실행된 사실과 그 입력 해시를 서버에 기록한다.
//
// 시나리오 «데이터»는 보내지 않는다. 다만 analyzedParamsHash는 그 데이터에서 유도된 값이라
// 이 요청이 E2EE와 완전히 무관하지는 않다 — 서버는 복원 불가능한 고정폭 해시만 보관한다는
// 것이 그 안전성의 근거다(scenarioAnalysisHash의 계약). 키가 없는 세션에서 안전한 이유는
// 여전히 같다: 보낼 평문이 없으므로 잠긴 계정을 덮어쓸 수 없다.
const persistScenarioAnalyzed = (scenarioId: string, analyzed: boolean, analyzedParamsHash: string | null): void => {
  fetch(`/api/scenarios/${scenarioId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      analyzed,
      // truthiness가 아니라 «값을 아느냐»로 보낸다. 예전에는 해시가 null이면 키를 통째로
      // 빼서 보냈는데, 서버는 키가 없으면 기존 값을 유지하므로(route.ts) analyzedAt만
      // 새로 찍히고 해시는 옛 것이 남았다. 그 시나리오는 다음 접속부터 영원히
      // 「재분석 필요」다. 모르면 모른다고(null) 명시적으로 말한다.
      ...(analyzedParamsHash !== undefined ? { analyzedParamsHash } : {}),
    }),
  })
    // 조용히 계속 실패하면 증상은 "다시 로그인하면 결과 화면이 비어 있다"뿐이다.
    .then(res => {
      if (!res.ok) console.error('Failed to persist analyzed mark: HTTP', res.status);
    })
    .catch(err => console.error('Failed to persist analyzed mark:', err));
};

// 발급된 보안키를 로그인 계정의 이메일로 보낸다.
//
// 훅 본문이 아니라 모듈 스코프에 두는 이유: 이 함수를 부르는 로딩 이펙트가 반환 객체보다
// 앞에 있어, 반환 객체 안에 선언하면 선언 전 참조가 된다(handleCreateScenario를 위로 끌어올린
// 것과 같은 이유).
const EMAIL_SEND_TIMEOUT_MS = 15000;

export interface SendKeyResult {
  success: boolean;
  error?: string;
}

// 서버가 준 문구를 모달에 그대로 띄워도 되는지 판단한다. 사용자용 문구는 우리가 쓴 짧은
// 한국어 문장이다 — 한글이 없거나(영문 내부 메시지), 구조화된 데이터의 흔적이 있거나
// (중괄호·대괄호·따옴표·URL), 한 문장을 넘길 만큼 길면 사용자에게 보여줄 문구가 아니다.
const isUserFacingMessage = (message: string): boolean =>
  message.length <= 120 && /[가-힣]/.test(message) && !/[{}[\]"<>]|https?:\/\//.test(message);

async function postBackupKey(key: string): Promise<SendKeyResult> {
  // 메일 서버가 응답하지 않으면 발급 모달이 '전송 중'에 영원히 갇힌다. 타임아웃을 두어
  // 반드시 실패 상태(= 키를 화면에 보여 주고 재시도를 제공하는 상태)로 빠져나오게 한다.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMAIL_SEND_TIMEOUT_MS);
  try {
    const res = await fetch('/api/user/send-backup-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) return { success: true };
    // 서버가 이유를 알려주면(레이트 리밋 429 등) 그대로 보여 준다. 사용자가 무엇을 기다려야
    // 하는지 아는 것과 모르는 것의 차이가 크다. 다만 모달에 띄우는 문구이므로 사용자용으로
    // 다듬어진 문장만 통과시킨다 — 예외 메시지나 외부 API 응답 본문이 새어 나오면
    // 사용자에게는 읽을 수 없는 잡음이고, 우리에게는 내부 사정의 노출이다.
    const reason = typeof data.error === 'string' && isUserFacingMessage(data.error) ? data.error : undefined;
    return {
      success: false,
      error: reason ?? '이메일 전송에 실패했습니다.',
    };
  } catch (err) {
    console.error('Failed to send backup key by email:', err);
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    return { success: false, error: aborted ? '메일 서버가 응답하지 않습니다.' : '네트워크 오류가 발생했습니다.' };
  } finally {
    clearTimeout(timeoutId);
  }
}

// 보안키 발급 진행 상태. 사용자가 '확인'을 누르기 전까지 앱 진입을 막는 근거가 된다.
export type KeyIssuance =
  | { status: 'sending'; key: string }
  | { status: 'sent'; key: string }
  | { status: 'failed'; key: string; error?: string };

// 발급 상태에 더해, "키는 있는데 백업이 확인되지 않은" 상태까지 포함한 모달 표시용 값.
export type KeyNotice = KeyIssuance | { status: 'unbacked'; key: string };

export function useScenarios() {
  const { data: session, status } = useSession();
  const [scenarios, setScenarios] = useState<ScenarioModel[]>([]);
  const [activeScenarioId, setActiveScenarioIdState] = useState<string | null>(null);
  const [compareScenarioIds, setCompareScenarioIds] = useState<string[]>([]);
  // 로딩 상태는 "무엇을 불러오려 했는가(loadRequestKey)"와 "무엇까지 불러왔는가"의 비교로
  // 얻는다. 상태로 들고 있으면 요청 조건이 바뀔 때마다 이펙트에서 false로 되돌려야 하는데,
  // 그 되돌림이 곧 렌더를 한 번 더 만든다(React Compiler의 set-state-in-effect).
  // 키가 바뀌는 순간 isLoaded는 저절로 false가 되므로 되돌릴 일이 없다.
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
  const [etfTickers, setEtfTickers] = useState<string[]>(['VOO', 'QQQ', 'SCHD', 'SPY', 'JEPI', 'TLT', 'VNQ', 'SPLG']);
  const lastSavedParamsRef = useRef<Record<string, string>>({});
  // handleRestoreKey에서 "키는 맞는데 이 시나리오만 데이터가 손상됨"으로 확인된 시나리오 ID.
  // 여기 포함된 시나리오는 로드 시 복호화가 계속 실패해도 needsKeyRestore를 다시 띄우지 않는다
  // (그렇지 않으면 방금 검증된 올바른 키를 사용자가 무한히 다시 요구받는 루프에 빠진다).
  const corruptedScenarioIdsRef = useRef<Set<string>>(new Set());
  // 탈퇴처럼 "떠나는 것이 확정된" 이동에서 미저장 경고를 끈다.
  //
  // state가 아니라 ref다. 이 값이 바뀔 때 리렌더할 이유가 없고, beforeunload 핸들러는
  // 이벤트마다 .current를 다시 읽으므로 재등록도 필요 없다.
  const unsavedGuardDisarmedRef = useRef(false);

  // Error & Retry States
  // 오류도 같은 방식이다. 어느 요청에서 난 오류인지 함께 들고 있으면, 요청 조건이 바뀐 뒤에
  // 낡은 오류가 화면에 남아 있는 일이 없다.
  const [loadErrorState, setLoadErrorState] = useState<{ key: string; message: string } | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // E2EE States
  const [localKey, setLocalKey] = useState<string | null>(null);
  const [needsKeyRestore, setNeedsKeyRestore] = useState(false);
  // 복구를 요구하면서도 대조할 암호문이 서버에 없는 상태. handleRestoreKey가 맞는 키조차
  // 받아들일 수 없으므로, 모달이 초기화 버튼을 처음부터 열어 두게 하는 근거가 된다.
  const [restoreUnverifiable, setRestoreUnverifiable] = useState(false);
  const [isBackupKeyBackedUp, setIsBackupKeyBackedUp] = useState(true);
  const [keyIssuance, setKeyIssuance] = useState<KeyIssuance | null>(null);
  // 복구 실패 사유. "키가 틀렸다"와 "검증할 암호문을 못 찾았다"는 사용자가 취해야 할 행동이
  // 다르므로 구분해서 전달한다.
  const [restoreError, setRestoreError] = useState<string | null>(null);
  // 이 사용자에게 보안키를 이미 발급했는지. 상태가 아니라 ref여야 한다 — StrictMode의 이펙트
  // 이중 실행은 같은 커밋의 같은 값을 두 클로저가 보므로 setState 가드로는 막히지 않고,
  // 그러면 키가 두 개 발급되어 이메일에 서로 다른 키가 두 번 도착한다.
  const keyIssuedForUserRef = useRef<string | null>(null);

  // Cloud Save States
  //
  // isSaving은 상태가 아니라 saveStatus에서 파생된다. 예전에는 둘이 따로 있었고, isSaving을
  // false로 되돌리는 곳이 디바운스 콜백의 finally 하나뿐이었다. 이펙트 cleanup이 그 타이머를
  // 지우면 finally는 영영 안 돌아 isSaving이 true로 굳었고, Header는 isSaving을 saveStatus보다
  // 먼저 보므로(Header.tsx) 저장에 실패한 화면에 "저장 중..."이 떠 있었다 — 사실과 정반대다.
  // 디바운스 1.5초 안에 값을 되돌리기만 해도 재현됐다.
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const isSaving = saveStatus === 'saving';
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // 이번에 불러와야 할 대상을 식별하는 키. 아래 로딩 이펙트의 의존성과 정확히 같은 값으로
  // 만들어야 한다 — 어긋나면 이펙트는 다시 도는데 isLoaded는 true로 남거나 그 반대가 된다.
  const loadRequestKey = `${status}:${localKey ?? ''}:${retryCount}`;
  const isLoaded = loadedRequestKey === loadRequestKey;
  const loadError = loadErrorState?.key === loadRequestKey ? loadErrorState.message : null;

  // 선택은 계산 결과를 바꾸는 사용자 의도이므로 새로고침 뒤에도, 다시 로그인한 뒤에도 유지한다.
  //
  // 두 군데에 적는다.
  //   계정(서버) — 진짜 출처. 로그인은 브라우저가 아니라 계정 단위의 사건이므로, 다른 기기나
  //     시크릿 창에서 들어와도 마지막 선택이 따라와야 한다.
  //   localStorage — 서버에 아직 값이 없는 계정(이 기능 이전부터 쓰던 사용자)을 위한 폴백.
  //     계정별 키를 써야 같은 브라우저에서 다른 계정으로 로그인했을 때 서로의 선택이 섞이지 않는다.
  const setActiveScenarioId = useCallback((id: string) => {
    setActiveScenarioIdState(id);
    const userId = session?.user?.id;
    if (status === 'authenticated' && userId) {
      localStorage.setItem(activeScenarioKeyName(userId), id);
      persistActiveScenarioId(id);
    }
  }, [session?.user?.id, status]);

  const restoreActiveScenarioId = useCallback((
    list: Array<{ id: string }>,
    userId: string,
    serverId: string | null | undefined,
  ) => {
    const inList = (id: string | null | undefined): id is string =>
      Boolean(id) && list.some(scenario => scenario.id === id);
    const storedId = localStorage.getItem(activeScenarioKeyName(userId));
    // 서버 값이 브라우저 값보다 우선한다 — 다른 기기에서 고른 선택은 여기에만 있고, 이 브라우저의
    // 기록은 그보다 낡았을 수 있다. 서버에 값이 없을 때만 localStorage로 내려간다.
    const restoredId = inList(serverId) ? serverId : inList(storedId) ? storedId : list[0]?.id;
    if (!restoredId) return;

    setActiveScenarioIdState(restoredId);
    // 삭제된 시나리오를 가리키는 낡은 값도 즉시 정상화한다.
    if (storedId !== restoredId) {
      localStorage.setItem(activeScenarioKeyName(userId), restoredId);
    }
    // 서버가 다른 값을 들고 있거나(삭제된 시나리오를 가리킴) 아직 아무 값도 없으면 지금 올린다.
    // 후자가 브라우저에만 있던 기존 사용자의 선택을 계정으로 옮기는 유일한 지점이다.
    if (serverId !== restoredId) {
      persistActiveScenarioId(restoredId);
    }
  }, []);

  // 계정에 기록된 비교 목록을 복원한다.
  //
  // 목록에 없는 id는 걸러 낸다 — 다른 기기에서 지운 시나리오가 남아 있으면 비교 계산이
  // 존재하지 않는 시나리오를 찾아 조용히 건너뛴다. 걸러 낸 결과가 서버 값과 다르면 지금
  // 정정해 올려, 다음 로그인에서 같은 정리를 반복하지 않는다.
  const restoreCompareScenarioIds = useCallback((
    list: Array<{ id: string }>,
    serverIds: string[] | undefined,
  ) => {
    if (!serverIds || serverIds.length === 0) return;
    const restored = serverIds
      .filter(id => list.some(scenario => scenario.id === id))
      .slice(0, MAX_COMPARE_SCENARIO_COUNT);
    setCompareScenarioIds(restored);
    if (restored.length !== serverIds.length) {
      persistCompareScenarioIds(restored);
    }
  }, []);

  // E2EE 키를 localStorage에서 읽어 온다.
  //
  // 이펙트가 아니라 세션이 바뀐 순간 렌더 중에 조정한다. 이펙트로 하면 키가 없는 상태로 한 번
  // 커밋되어, 그 사이에 도는 아래 로딩 이펙트가 "키 없음"으로 잘못 분기한다.
  // 서버에는 localStorage가 없으므로 하이드레이션이 끝난 뒤부터 읽는다.
  const hydrated = useIsHydrated();
  const sessionKey = `${status}:${session?.user?.id ?? ''}`;
  const [syncedSessionKey, setSyncedSessionKey] = useState<string | null>(null);
  if (hydrated && syncedSessionKey !== sessionKey) {
    setSyncedSessionKey(sessionKey);
    const userId = session?.user?.id;
    if (status === 'authenticated' && userId) {
      const key = localStorage.getItem(e2eeKeyName(userId));
      if (key) {
        setIsBackupKeyBackedUp(localStorage.getItem(e2eeBackedUpKeyName(userId)) === 'true');
        setLocalKey(key);
      } else {
        setLocalKey(null);
      }
    } else {
      setLocalKey(null);
      setNeedsKeyRestore(false);
    }
  }

  // 아래 로딩 이펙트가 이 함수를 부르므로 그보다 앞에 둔다. 뒤에 두면 const 선언 전에
  // 참조하게 되어(런타임에는 호출 시점이 늦어 동작했지만) React Compiler가 막는다.
  // 이 함수가 읽는 값은 모두 위쪽 상태 선언부에 있어 위치를 옮겨도 안전하다.
  // 만들어진 시나리오를 «돌려준다». 호출부가 이름으로 새 시나리오를 되찾으려 하면(프리셋은
  // 이름이 고정 리터럴이라 중복된다) 같은 이름의 옛 시나리오를 붙잡는다. id만이 신원이다.
  // 실패는 null이다 — 호출부가 성공과 구분해 사용자에게 말할 수 있어야 한다.
  const handleCreateScenario = async (
    name: string, data: SimulationParams, isDefault = false, overrideKey?: string,
  ): Promise<ScenarioModel | null> => {
    if (!isDefault && scenarios.length >= MAX_SCENARIO_COUNT) {
      alert(`시나리오는 최대 ${MAX_SCENARIO_COUNT}개까지만 생성할 수 있습니다.`);
      return null;
    }

    if (status === 'authenticated') {
      const keyToUse = overrideKey || localKey;
      const userId = session?.user?.id;
      // 키 없이 저장하면 서버에 평문이 남는다. 그 순간부터 이 계정은 어느 브라우저에서든 키 없이
      // 열리므로(E2EE가 조용히 꺼진다), 저장을 포기하는 쪽이 낫다.
      //
      // 키가 없는 인증 세션은 E2eeKeyManager가 발급 모달이나 복구 모달로 화면을 덮고 있어
      // 여기까지 오지 않는다(로딩 경로가 키를 쥐여 주기 때문이 아니다 — 잠긴 계정을 키 없는
      // 브라우저에서 열면 localKey는 계속 null이다). 걸린다면 그 게이트가 뚫린 것이다.
      if (!keyToUse || !userId) {
        console.error('[E2EE] Refusing to create scenario without a key');
        setSaveStatus('error');
        alert('보안키가 준비되지 않아 시나리오를 만들 수 없습니다. 페이지를 새로고침해 주세요.');
        return null;
      }
      try {
        const payloadToSave: EncryptedData = await encryptData(data, keyToUse, userId);
        const res = await fetch('/api/scenarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, data: payloadToSave, isDefault }),
        });
        // res.ok를 먼저 본다. 서버가 500을 주면 본문이 { error: ... }라 newScenario가
        // undefined가 되고, if 블록을 조용히 건너뛴 채 함수가 정상 종료했다. 그러면 시나리오가
        // 없는데 화면은 정상으로 보이고(activeParams가 initialParams로 폴백) 자동저장은
        // activeScenarioId가 null이라 한 번도 돌지 않는다 — 사용자가 입력한 것이 전부 사라진다.
        if (!res.ok) {
          throw new Error(`시나리오를 만들지 못했습니다 (HTTP ${res.status})`);
        }
        const { data: newScenario } = await res.json();
        if (newScenario) {
          // 서버가 반환한 payload는 방금 우리가 암호화해서 보낸 것과 동일하므로, 복호화에
          // 실패해도 암호문 blob을 그대로 SimulationParams 자리에 남기지 않고 원본 평문(data)으로
          // 폴백한다 (로드 경로의 initialParams 폴백과 동일한 안전장치).
          let decryptedData = newScenario.data;
          if (isEncryptedPayload(newScenario.data)) {
            try {
              decryptedData = await decryptData<SimulationParams>(newScenario.data, keyToUse, userId);
            } catch (err) {
              console.error('Failed to decrypt created scenario:', err);
              decryptedData = data;
              setNeedsKeyRestore(true);
            }
          }
          lastSavedParamsRef.current[newScenario.id] = JSON.stringify(decryptedData);
          const created: ScenarioModel = {
            ...newScenario,
            data: decryptedData,
            analyzedAt: newScenario.analyzedAt ?? null,
            analyzedParamsHash: newScenario.analyzedParamsHash ?? null,
          };
          setScenarios(prev => {
            const filtered = prev.filter(s => s.id !== newScenario.id && !(isDefault && s.isDefault));
            return [...filtered, created];
          });
          setActiveScenarioId(newScenario.id);
          return created;
        }
        return null;
      } catch (err) {
        console.error('Failed to create scenario:', err);
        // 조용히 넘어가면 사용자는 저장되고 있다고 믿은 채 계속 입력한다.
        setSaveStatus('error');
        alert('시나리오를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return null;
      }
    } else {
      const newId = 'local-' + generateId();
      const newScenario: ScenarioModel = {
        id: newId,
        name,
        isDefault,
        data,
        // 새로 만든 시나리오는 아직 분석한 적이 없다. 복제본도 마찬가지다 — 설정이 같아도
        // 「분석 시작」은 사용자가 그 시나리오에서 직접 누른 적이 있어야 한다.
        analyzedAt: null,
        analyzedParamsHash: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setScenarios(prev => [...prev, newScenario]);
      setActiveScenarioId(newId);
      return newScenario;
    }
  };

  // Fetch dynamic ETF tickers from API
  useEffect(() => {
    fetch('/api/etfs')
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data) {
          setEtfTickers(prev => Array.from(new Set([...prev, ...json.data])));
        }
      })
      .catch(err => console.error('Failed to load dynamic ETF tickers:', err));
  }, []);

  // ETF 티커 목록이 서버에서 도착하면 이미 불러온 시나리오를 다시 마이그레이션한다.
  //
  // 이펙트가 아니라 티커 목록이 바뀐 순간 렌더 중에 조정한다. 이펙트로 하면 옛 분류로 한 번
  // 커밋한 뒤 다시 렌더되어, 그 사이 대시보드가 잘못 분류된 자산으로 계산된다.
  // 루프는 migratedForTickers 래치가 막는다 — 같은 etfTickers 참조에 대해 한 번만 돈다.
  const [migratedForTickers, setMigratedForTickers] = useState<string[] | null>(null);
  if (isLoaded && scenarios.length > 0 && etfTickers.length > 10 && migratedForTickers !== etfTickers) {
    setMigratedForTickers(etfTickers);
    const updated = scenarios.map(s => {
      const migrated = migrateParams(s.data, etfTickers);
      // 참조가 아니라 «내용»으로 비교한다. migrateParams는 normalizeSimulationParams를 지나며
      // 언제나 새 객체를 만들므로, 참조 비교는 «바뀐 것이 없어도» 항상 다르다고 답한다.
      // 그러면 여기서 setScenarios가 매번 돌고, page.tsx가 `analysis.sourceParams ===
      // activeParams`로 분석의 신선도를 판정하므로 되돌아온 사용자의 대시보드가 아무것도
      // 건드리지 않았는데 「다시 분석해 주세요」로 바뀐다(PDF 버튼도 함께 잠긴다).
      //
      // 내용 비교가 안전한 이유: 정규화는 값에 대해 멱등이고(같은 입력 → 같은 출력),
      // lastSavedParamsRef도 이미 정규화된 JSON 문자열을 저장한다.
      return JSON.stringify(migrated) === JSON.stringify(s.data) ? s : { ...s, data: migrated };
    });
    // 변형 가능한 플래그를 쌓지 않고 결과만 비교한다 — 렌더 중 변수 변형은 컴파일러가 막는다.
    if (updated.some((next, i) => next !== scenarios[i])) {
      setScenarios(updated);
    }
  }

  // Helper to generate a local mock scenario ID
  const generateId = () => Math.random().toString(36).substr(2, 9);

  // 비로그인 사용자는 로컬 저장소의 값으로 기본 시나리오 하나를 만든다.
  //
  // 렌더 중 조정으로 옮겨 보았으나 되돌렸다. 이 블록은 lastSavedParamsRef에 "방금 불러온
  // 값"을 적어 둬야 하는데(그래야 로드 직후 불필요한 저장이 나가지 않는다) 렌더 중 ref 쓰기는
  // 컴파일러가 막는다(react-hooks/refs). 즉 setState만의 문제가 아니라 이 초기화가 본질적으로
  // 부수 효과를 포함한다 — 이펙트가 제자리다.
  useEffect(() => {
    if (status !== 'unauthenticated' || isLoaded) return;
    const loaded = loadParams();
    const migrated = migrateParams(loaded || initialParams, etfTickers);
    lastSavedParamsRef.current['local-default'] = JSON.stringify(migrated);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Local storage hydration is an external-system synchronization.
    setScenarios([{
      id: 'local-default',
      name: '기본 시나리오',
      isDefault: true,
      data: migrated,
      // 로그인 계정의 Scenario.analyzedAt에 해당한다. 이게 없으면 비로그인 사용자는
      // 새로고침 한 번에 결과 화면을 잃는다.
      analyzedAt: localStorage.getItem(LOCAL_ANALYZED_AT_KEY),
      analyzedParamsHash: localStorage.getItem(LOCAL_ANALYZED_PARAMS_HASH_KEY),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]);
    setActiveScenarioId('local-default');
    setLoadedRequestKey(loadRequestKey);
    // etfTickers/loadRequestKey are intentionally captured for this one-shot hydration;
    // later ticker normalization has its own guarded migration path above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isLoaded]);

  // Fetch scenarios when logged in
  useEffect(() => {
    const userId = session?.user?.id;
    // isLoaded를 가드와 의존성에 함께 둔다(바로 위 비로그인 이펙트와 같은 형태).
    //
    // 이게 없으면 handleRestoreKey가 요청 키를 무효화해도 이 이펙트를 다시 돌릴 방법이 없다.
    // 보통은 같은 함수의 setLocalKey가 의존성을 바꿔 주지만, 복구한 키가 이미 들고 있던 키와
    // 같으면(시나리오 하나만 손상돼 키 자체는 맞는 경우 — corruptedScenarioIdsRef가 다루는
    // 바로 그 상황) React가 bail-out해 의존성이 그대로다. 그러면 화면이 로딩에 갇힌다.
    if (isLoaded) return;
    if (status === 'authenticated') {
      if (userId) {
        const storedKey = localStorage.getItem(e2eeKeyName(userId));
        if (storedKey && !localKey) {
          // localKey는 이펙트가 아니라 렌더 중 조정(위 syncedSessionKey 블록)이 채운다. 그 커밋
          // 전에 이 이펙트가 먼저 돌면 "키 없음"으로 잘못 분기하므로 한 번 넘긴다.
          // 발급 직후에도 여기 걸린다(키는 localStorage에 있고 localKey는 아직 null) — 그때는
          // 발급 모달이 떠 있고 '확인'이 setLocalKey를 불러 다시 돈다.
          return;
        }
      }
      // Helper for retrying fetches (helps with NextJS rebuild/compilation delay)
      const fetchWithRetry = async (url: string, retries = 3, delay = 1500): Promise<ScenarioListResponse> => {
        try {
          const res = await fetch(url);
          if (!res.ok) {
            throw new ScenarioRequestError(res.status);
          }
          return await res.json();
        } catch (err) {
          // 401은 일시적인 서버 장애가 아니다. 특히 탈퇴 직후에는 DB의 User 행은 지워졌지만
          // JWT 쿠키가 브라우저에 잠시 남을 수 있다. 같은 요청을 반복해도 성공하지 않으므로
          // 재시도하지 않고 바깥에서 세션을 정리한다.
          if (err instanceof ScenarioRequestError && err.status === 401) {
            throw err;
          }
          if (retries > 0) {
            console.warn(`[useScenarios] Fetch failed, retrying in ${delay}ms... (${retries} left). Error:`, err);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(url, retries - 1, delay);
          }
          throw err;
        }
      };

      fetchWithRetry('/api/scenarios')
        .then(({ data, e2eeEnabled, lastActiveScenarioId, compareScenarioIds: serverCompareIds }) => {
          if (!userId) {
            setLoadedRequestKey(loadRequestKey);
            return;
          }
          const list = data ?? [];
          const keyName = e2eeKeyName(userId);
          const activeKey = localKey || localStorage.getItem(keyName);

          // 키를 요구할지는 서버 기록(e2eeEnabled)으로 판단한다. 예전에는 "받아 온 payload가
          // 암호문이냐"만 봤는데, 그러면 평문 행이 하나 생기는 순간 그 계정은 어느 브라우저에서든
          // 키 없이 열렸다.
          //
          // payload 판정은 e2eeEnabled 필드를 아예 모르는 응답(롤아웃 중의 구버전 서버, 캐시된
          // 응답)만을 위한 폴백이다. 필드가 오기만 하면 서버 판정이 이미 hasCiphertext를 포함하므로
          // (route.ts의 `Boolean(e2eeEnabledAt) || hasCiphertext`) 이 항이 false를 true로 뒤집을 일은
          // 없다.
          const hasCiphertext = list.some(s => isEncryptedPayload(s.data));
          const keyRequired = e2eeEnabled === true || hasCiphertext;

          if (!activeKey) {
            if (keyRequired) {
              // 잠긴 계정인데 이 브라우저에는 키가 없다. 시나리오 이름만 남기고 데이터는
              // 자리표시자로 덮어 복구를 요구한다 — 평문으로 남아 있던 행도 마찬가지다.
              setScenarios(list.map(s => {
                lastSavedParamsRef.current[s.id] = JSON.stringify(initialParams);
                return {
                  ...s,
                  name: s.isDefault ? '기본 시나리오' : s.name,
                  data: initialParams,
                  analyzedAt: s.analyzedAt ?? null,
                  analyzedParamsHash: s.analyzedParamsHash ?? null,
                };
              }));
              restoreActiveScenarioId(list, userId, lastActiveScenarioId);
              restoreCompareScenarioIds(list, serverCompareIds);
              setNeedsKeyRestore(true);
              // 잠겼다는데 대조할 암호문이 없으면 handleRestoreKey는 맞는 키도 받아들일 수 없다.
              // 그 상태를 모달에 알려 초기화 버튼을 처음부터 열어 준다 — 그렇지 않으면 사용자는
              // 맞는 키를 세 번 넣어 "틀렸다"는 거짓말을 세 번 듣고서야 탈출구를 본다.
              setRestoreUnverifiable(!hasCiphertext);
              setLoadedRequestKey(loadRequestKey);
              return;
            }

            // 키를 한 번도 발급받지 않은 계정 — 신규 가입이거나, E2EE 도입 이전에 만들어져
            // 평문만 갖고 있는 계정이다. 후자도 키를 받아야 평문이 암호화되지만, 이번 패스는
            // 아니다 — 아래 재암호화는 사용자가 '확인'을 눌러 setLocalKey가 불리고 이펙트가
            // 다시 돈 뒤에 돈다.
            //
            // 보안키는 시스템이 발급한다. 사용자가 직접 정하게 두면 111111 같은 키가 들어오는데,
            // 암호문은 로그인만 하면 통째로 받아갈 수 있어 오프라인 대입에 그대로 뚫린다.
            // generateBackupKey()는 모호한 0/O/1/I를 뺀 32자 집합에서 뽑아 32^6(약 30비트)를
            // 보장한다.
            if (keyIssuedForUserRef.current !== userId) {
              // await 이전에 래치를 건다 — StrictMode 이중 실행이 두 번 발급하는 것을 막는다.
              keyIssuedForUserRef.current = userId;
              const newKey = generateBackupKey();
              if (!newKey) {
                // window가 없으면 빈 문자열이 온다. 그대로 진행하면 빈 키로 암호화되어
                // 데이터를 영구히 잃는다.
                setLoadErrorState({ key: loadRequestKey, message: '보안키를 생성하지 못했습니다. 페이지를 새로고침해 주세요.' });
              } else {
                // 발급 즉시 기록한다. 확인 전에 창을 닫아도 다음 로그인이 같은 키로
                // 이어지고, 이메일에 서로 다른 키가 두 개 쌓이지 않는다.
                localStorage.setItem(keyName, newKey);
                localStorage.setItem(e2eeBackedUpKeyName(userId), 'false');
                setIsBackupKeyBackedUp(false);
                setKeyIssuance({ status: 'sending', key: newKey });
                postBackupKey(newKey).then(result => {
                  setKeyIssuance(result.success
                    ? { status: 'sent', key: newKey }
                    : {
                        status: 'failed',
                        key: newKey,
                        error: result.error,
                      });
                });
                // setLocalKey는 일부러 부르지 않는다. 사용자가 '확인'을 누를 때 비로소
                // 호출되고, 그때 이 이펙트가 다시 돌아 키가 있는 경로로 들어간다.
              }
            }
            setLoadedRequestKey(loadRequestKey);
            return;
          }

          // 여기부터는 이 브라우저에 키가 있다.
          if (list.length === 0) {
            setLocalKey(activeKey);
            const loaded = loadParams();
            const migrated = convertToRepresentativeAssets(migrateParams(loaded || initialParams, etfTickers));
            fetchLatestParamsInfo(migrated).then(latestParams => {
              lastSavedParamsRef.current['local-default'] = JSON.stringify(latestParams);
              handleCreateScenario('기본 시나리오', latestParams, true, activeKey);
            }).catch(err => {
              console.error('Failed to fetch initial parameters info:', err);
              lastSavedParamsRef.current['local-default'] = JSON.stringify(migrated);
              handleCreateScenario('기본 시나리오', migrated, true, activeKey);
            });
            setLoadedRequestKey(loadRequestKey);
            return;
          }

          const decryptAll = async () => {
            const decryptedList = [];
            let hasDecryptionFailure = false;
            // 서버에 평문으로 남아 있던 시나리오. 아래에서 즉시 암호화해 되돌린다.
            const plaintextIds: string[] = [];
            for (const s of list) {
              const displayName = s.isDefault ? '기본 시나리오' : s.name;
              if (isEncryptedPayload(s.data)) {
                try {
                  const decryptedData = await decryptData<SimulationParams>(s.data, activeKey, userId);
                  const migrated = convertToRepresentativeAssets(migrateParams(decryptedData, etfTickers));
                  decryptedList.push({ ...s, name: displayName, data: migrated, analyzedAt: s.analyzedAt ?? null, analyzedParamsHash: s.analyzedParamsHash ?? null });
                  lastSavedParamsRef.current[s.id] = JSON.stringify(migrated);
                } catch (err) {
                  console.error('Decryption failed for scenario', s.id, err);
                  // 이미 handleRestoreKey에서 "키는 맞지만 이 시나리오만 손상됨"으로 확인된
                  // 경우에는 키를 다시 요구하지 않는다 (무한 복구 루프 방지).
                  if (!corruptedScenarioIdsRef.current.has(s.id)) {
                    hasDecryptionFailure = true;
                  }
                  decryptedList.push({ ...s, name: displayName, data: initialParams, analyzedAt: s.analyzedAt ?? null, analyzedParamsHash: s.analyzedParamsHash ?? null });
                  lastSavedParamsRef.current[s.id] = JSON.stringify(initialParams);
                }
              } else {
                // E2EE 도입 이전에 저장된 평문 params, 또는 이 커밋 이전에 키 없는 세션이 덮어쓴
                // 평문. 새로 생기지는 않는다 — 저장 경로 셋 모두, 그리고 서버가 잠긴 계정에 대한
                // 평문 쓰기를 거부한다.
                // 캐스팅하지 않는다 — migrateParams가 unknown을 받아 정제까지 맡는다.
                const migrated = convertToRepresentativeAssets(migrateParams(s.data, etfTickers));
                decryptedList.push({ ...s, name: displayName, data: migrated, analyzedAt: s.analyzedAt ?? null, analyzedParamsHash: s.analyzedParamsHash ?? null });
                lastSavedParamsRef.current[s.id] = JSON.stringify(migrated);
                plaintextIds.push(s.id);
              }
            }
            setScenarios(decryptedList);
            setNeedsKeyRestore(hasDecryptionFailure);

            restoreActiveScenarioId(decryptedList, userId, lastActiveScenarioId);
            restoreCompareScenarioIds(decryptedList, serverCompareIds);
            setLoadedRequestKey(loadRequestKey);

            // 평문 행을 지금 암호화해 되돌린다. 다음 편집을 기다리면 그 사이에 다른 브라우저가
            // 이 계정을 키 없이 열 수 있다 — 편집은 며칠 뒤일 수도 있다.
            //
            // 단, 이 키로 암호문이 하나도 열리지 않았다면(hasDecryptionFailure) 이 키는 틀린
            // 키다. 틀린 키로 평문을 암호화하면 멀쩡히 읽히던 데이터가 아무도 못 여는 blob이
            // 된다 — 사용자가 곧 맞는 키를 넣어도 그때는 이미 늦다. 검증되지 않은 키로는
            // 아무것도 암호화하지 않는다.
            //
            // 열 암호문이 애초에 없었던 레거시 평문 계정은 hasDecryptionFailure가 false라
            // 정상적으로 통과한다 — 키와 어긋날 암호문 자체가 없기 때문이다.
            if (hasDecryptionFailure) return;

            // 화면을 그린 뒤에 돌린다. 실패해도 데이터는 읽히는 상태이므로 사용자를 막지 않는다.
            for (const id of plaintextIds) {
              const target = decryptedList.find(s => s.id === id);
              if (!target) continue;
              try {
                const encrypted = await encryptData(target.data, activeKey, userId);
                const res = await fetch(`/api/scenarios/${id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ data: encrypted }),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
              } catch (err) {
                console.error('Failed to re-encrypt plaintext scenario', id, err);
                // 위 루프가 이 행을 "저장됨"으로 적어 두었다. 그대로 두면 자동저장이 동일성
                // 비교에서 영원히 건너뛰어, 이 행은 사용자가 값을 고칠 때까지 평문으로 남는다
                // — 재암호화를 서두른 이유가 통째로 사라진다. 기록을 지워 재시도 경로를 연다.
                delete lastSavedParamsRef.current[id];
                // 계정이 아직 무방비라는 사실을 최소한 배지에는 남긴다.
                setSaveStatus('error');
              }
            }
          };
          // 이 안의 예외는 전부 개별 try가 받지만, 그 바깥에서 터지면 unhandled rejection이 된다.
          decryptAll().catch(err => {
            console.error('Failed to load scenarios:', err);
            setLoadErrorState({ key: loadRequestKey, message: '시나리오를 불러오지 못했습니다. 다시 시도해 주세요.' });
            setLoadedRequestKey(loadRequestKey);
          });
        })
        .catch(async err => {
          if (err instanceof ScenarioRequestError && err.status === 401) {
            // 서버가 더는 이 JWT의 사용자를 인정하지 않는다. 오류 화면에 가두면 "다시 시도"가
            // 영원히 같은 401만 만든다. 로컬 세션 쿠키를 지우고 재로그인할 수 있게 보낸다.
            await signOut({ callbackUrl: '/login?callbackUrl=/simulator' });
            return;
          }
          console.error('[useScenarios] Failed to load scenarios:', err);
          setLoadErrorState({ key: loadRequestKey, message: err.message || '시나리오 데이터를 가져오지 못했습니다.' });
          setLoadedRequestKey(loadRequestKey);
        });
    }
    // The request lifecycle is keyed by the explicit state values below. Adding callback
    // identities would restart decryption while a request is in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, localKey, retryCount, isLoaded]);

  // Get current active params
  const activeParams = scenarios.find(s => s.id === activeScenarioId)?.data || initialParams;

  // 발급 모달에 무엇을 보여 줄지. 발급이 진행 중이면 그것을, 아니면 "키는 있는데 백업이
  // 확인되지 않은" 상태를 보여 준다. 후자는 발급 도중 창을 닫았거나 이메일 전송이 실패한
  // 채로 넘어간 사용자를 다음 접속에서 자동으로 구제한다.
  const keyNotice: KeyNotice | null = keyIssuance
    ?? (localKey && !isBackupKeyBackedUp ? { status: 'unbacked', key: localKey } : null);

  // Auto-save debounced
  useEffect(() => {
    // 키가 없으면 서버 데이터를 기본값으로 덮어쓰지 않는다. 지켜야 할 대상은 암호문만이
    // 아니다 — 잠긴 계정의 아직 평문인 행도 자리표시자로 덮여 있어 똑같이 위험하다.
    if (needsKeyRestore) return;
    if (isLoaded && activeScenarioId) {
      const activeScenario = scenarios.find(s => s.id === activeScenarioId);
      // 방어선. 지금은 로드/생성 경로 모두 평문 params만 상태에 넣으므로 이 조건이 거짓이 될
      // 일은 없다(암호문이 상태에 남으면 그대로 다시 암호화되어 이중 암호문이 된다).
      if (activeScenario && !isEncryptedPayload(activeScenario.data)) {
        const currentDataStr = JSON.stringify(activeScenario.data);
        const lastSavedDataStr = lastSavedParamsRef.current[activeScenario.id];

        // Skip saving if data is identical to the last saved/loaded state
        if (currentDataStr === lastSavedDataStr) {
          return;
        }

        if (status === 'authenticated' && !activeScenarioId.startsWith('local-')) {
          const userId = session?.user?.id;
          // 키가 없으면 저장하지 않는다. 예전에는 조용히 평문으로 올렸는데, 그 한 번의 저장이
          // 계정의 E2EE를 영구히 꺼 버린다(그 뒤로는 어느 브라우저에서든 키 없이 열린다).
          if (!localKey || !userId) {
            console.error('[E2EE] Refusing to auto-save without a key');
            // eslint-disable-next-line react-hooks/set-state-in-effect -- This branch reports an external key-store invariant failure.
            setSaveStatus('error');
            return;
          }
          // 로그인 사용자의 데이터는 서버에 E2EE로 암호화되어 저장되므로,
          // 로컬 저장소에는 평문 폴백을 남기지 않는다(기기 탈취 시 평문 노출 방지).
          setSaveStatus('saving');
          const timeoutId = setTimeout(async () => {
            try {
              const payloadToSave: EncryptedData = await encryptData(activeScenario.data, localKey, userId);
              const res = await fetch(`/api/scenarios/${activeScenarioId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: payloadToSave }),
              });
              if (res.ok) {
                setSaveStatus('success');
                setLastSaved(new Date());
                lastSavedParamsRef.current[activeScenarioId] = currentDataStr;
              } else {
                setSaveStatus('error');
              }
            } catch (err) {
              console.error('Failed to save cloud data:', err);
              setSaveStatus('error');
            }
          }, 1500);
          // 예약만 해 두고 실행되지 않은 저장은 '저장 중'이 아니다. 여기서 되돌리지 않으면
          // 디바운스 안에 값을 되돌리거나 needsKeyRestore가 켜지는 순간 배지가 그대로 굳는다.
          return () => {
            clearTimeout(timeoutId);
            setSaveStatus(prev => (prev === 'saving' ? 'idle' : prev));
          };
        } else {
          // Unauthenticated or local scenario - saved to local storage instantly
          saveParams(activeScenario.data);
          setSaveStatus('success');
          setLastSaved(new Date());
          lastSavedParamsRef.current[activeScenarioId] = currentDataStr;
        }
      }
    }
  }, [activeParams, isLoaded, status, activeScenarioId, scenarios, localKey, needsKeyRestore, session?.user?.id]);

  // Alert user when they try to leave the page with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // 탈퇴 직후의 이동에는 경고하지 않는다. 여기서 "머무르기"를 누르면 사용자는 이미
      // 삭제된 계정 위에 살아 있는 쿠키로 남고, 그 상태의 요청 하나가 계정을 부활시킨다.
      if (unsavedGuardDisarmedRef.current) return;
      if (isLoaded && activeScenarioId) {
        const activeScenario = scenarios.find(s => s.id === activeScenarioId);
        if (activeScenario) {
          const currentDataStr = JSON.stringify(activeScenario.data);
          const lastSavedDataStr = lastSavedParamsRef.current[activeScenario.id];
          if (currentDataStr !== lastSavedDataStr) {
            e.preventDefault();
            e.returnValue = ''; // Required for Chrome/Firefox
            return '';
          }
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [scenarios, activeScenarioId, isLoaded]);

  const handleUpdateActiveParams = useCallback((newParams: SimulationParams | ((prev: SimulationParams) => SimulationParams)) => {
    setScenarios(prev => prev.map(s => {
      if (s.id === activeScenarioId) {
        const nextData = typeof newParams === 'function' ? newParams(s.data) : newParams;
        return { ...s, data: nextData };
      }
      return s;
    }));
  }, [activeScenarioId]);


  const handleDuplicateScenario = async (
    id: string, copyName?: string, copyData?: SimulationParams,
  ): Promise<ScenarioModel | null> => {
    const source = scenarios.find(s => s.id === id);
    if (!source) {
      // 조용히 끝내면 「비교안 만들기」를 누른 사용자에게는 아무 일도 일어나지 않은 것처럼
      // 보인다. 다른 기기에서 지웠거나 목록을 다시 불러오는 사이 사라진 경우가 실제로 있다.
      console.error('Cannot duplicate a scenario that no longer exists:', id);
      alert('복제할 시나리오를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.');
      return null;
    }
    // Deep copy to prevent reference sharing in state
    const clonedData = copyData
      ? JSON.parse(JSON.stringify(copyData))
      : JSON.parse(JSON.stringify(source.data));
    return handleCreateScenario(copyName?.trim() || `${source.name} (복사본)`, clonedData);
  };

  const handleDeleteScenario = async (id: string) => {
    const target = scenarios.find(s => s.id === id);
    if (!target) return;
    if (target.isDefault) {
      alert('기본 시나리오는 삭제할 수 없습니다.');
      return;
    }

    // 지운 시나리오를 빼고 남는 첫 시나리오. scenarios[0]을 그대로 쓰면 지운 것이 첫 항목일 때
    // 이미 없는 시나리오를 선택한 채로 남는다 — 이제 그 값은 계정에도 기록되므로(404가 나고,
    // 다음 로그인의 복원 대상이 어긋난다) 남는 것 중에서 고른다.
    const fallback = scenarios.find(s => s.id !== id);
    const selectFallback = () => {
      if (activeScenarioId === id && fallback) setActiveScenarioId(fallback.id);
    };

    if (status === 'authenticated' && !id.startsWith('local-')) {
      try {
        const res = await fetch(`/api/scenarios/${id}`, { method: 'DELETE' });
        if (res.ok) {
          setScenarios(prev => prev.filter(s => s.id !== id));
          selectFallback();
          setCompareScenarioIds(prev => prev.filter(compId => compId !== id));
        }
      } catch (err) {
        console.error('Failed to delete scenario:', err);
      }
    } else {
      setScenarios(prev => prev.filter(s => s.id !== id));
      selectFallback();
      setCompareScenarioIds(prev => prev.filter(compId => compId !== id));
    }
  };

  const handleRenameScenario = async (id: string, newName: string) => {
    setScenarios(prev => prev.map(s => s.id === id ? { ...s, name: newName } : s));
    if (status === 'authenticated' && !id.startsWith('local-')) {
      try {
        await fetch(`/api/scenarios/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName }),
        });
      } catch (err) {
        console.error('Failed to rename scenario:', err);
      }
    }
  };

  // 다음 값을 «업데이터 밖에서» 계산한다. 예전에는 setState 업데이터 안에서 계산하며 한도
  // 초과 시 alert까지 띄웠는데, 업데이터는 StrictMode에서 두 번 불리므로 경고가 두 번 뜬다.
  // 이제는 서버 기록까지 따라붙어 요청도 두 번 나갈 자리다.
  const toggleCompareScenario = (id: string) => {
    let next: string[];
    if (compareScenarioIds.includes(id)) {
      next = compareScenarioIds.filter(compId => compId !== id);
    } else {
      if (compareScenarioIds.length >= MAX_COMPARE_SCENARIO_COUNT) {
        alert(`비교 시나리오는 최대 ${MAX_COMPARE_SCENARIO_COUNT}개까지만 추가할 수 있습니다.`);
        return;
      }
      next = [...compareScenarioIds, id];
    }
    setCompareScenarioIds(next);
    // 비교 대상은 결과 화면을 바꾸는 결정이므로 다음 로그인까지 남아야 한다.
    if (status === 'authenticated') persistCompareScenarioIds(next);
  };

  /**
   * 이 시나리오의 분석 요청 실행과 입력 해시를 기록한다(또는 그 기록을 지운다).
   *
   * 분석 «결과»는 저장하지 않는다. 저장하는 것은 사실 하나뿐이고, 다음 접속에서 화면이
   * 저장된 params로 같은 계산을 다시 돌려 결과를 세운다(Scenario.analyzedAt 주석 참조).
   *
   * data 참조는 절대 건드리지 않는다. 화면의 대시보드는 activeParams의 참조 비교로 결과가
   * 최신인지 판정하므로(page.tsx의 analysisIsCurrent), 여기서 새 params 객체를 만들면
   * 「분석 시작」을 누른 바로 그 순간 결과가 stale로 판정되어 대시보드가 사라진다.
   */
  const setScenarioAnalyzed = useCallback((id: string, analyzed: boolean, params?: SimulationParams) => {
    const analyzedAt = analyzed ? new Date().toISOString() : null;
    const analyzedParamsHash = analyzed && params ? scenarioAnalysisHash(params) : null;
    setScenarios(prev => prev.map(s => (s.id === id ? { ...s, analyzedAt, analyzedParamsHash } : s)));

    if (id.startsWith('local-')) {
      // 비로그인 세션에는 서버에 대응하는 행이 없다. 브라우저 저장소가 그 자리를 대신한다.
      if (analyzedAt) localStorage.setItem(LOCAL_ANALYZED_AT_KEY, analyzedAt);
      else localStorage.removeItem(LOCAL_ANALYZED_AT_KEY);
      if (analyzedParamsHash) localStorage.setItem(LOCAL_ANALYZED_PARAMS_HASH_KEY, analyzedParamsHash);
      else localStorage.removeItem(LOCAL_ANALYZED_PARAMS_HASH_KEY);
      return;
    }
    if (status === 'authenticated') persistScenarioAnalyzed(id, analyzed, analyzedParamsHash);
  }, [status]);

  const handleUpdateScenarioData = useCallback(async (id: string, newData: SimulationParams) => {
    setScenarios(prev => prev.map(s => {
      if (s.id === id) {
        return { ...s, data: newData };
      }
      return s;
    }));

    if (status === 'authenticated' && !id.startsWith('local-')) {
      const userId = session?.user?.id;
      // 자동저장과 같은 이유로 평문 저장을 거부한다.
      if (!localKey || !userId) {
        console.error('[E2EE] Refusing to save imported scenario without a key');
        setSaveStatus('error');
        alert('보안키가 준비되지 않아 저장할 수 없습니다. 페이지를 새로고침해 주세요.');
        return;
      }
      try {
        const payloadToSave: EncryptedData = await encryptData(newData, localKey, userId);
        const res = await fetch(`/api/scenarios/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: payloadToSave }),
        });
        // res.ok를 보지 않으면 500/401/409에도 아래 "저장됨" 기록이 남는다. 그러면 자동저장은
        // 동일성 비교에서 건너뛰고 beforeunload 경고도 뜨지 않아, 사용자는 가져온 시나리오가
        // 사라진 것을 다음 접속에야 안다(handleCreateScenario가 같은 이유로 res.ok를 먼저 본다).
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        lastSavedParamsRef.current[id] = JSON.stringify(newData);
        setSaveStatus('success');
        setLastSaved(new Date());
      } catch (err) {
        console.error('Failed to save imported scenario data:', err);
        setSaveStatus('error');
        alert('가져온 시나리오를 저장하지 못했습니다. 화면의 내용은 아직 서버에 반영되지 않았습니다. 잠시 후 다시 시도해 주세요.');
      }
    } else {
      saveParams(newData);
      lastSavedParamsRef.current[id] = JSON.stringify(newData);
    }
  }, [status, localKey, session]);

  // 파일 불러오기도 다른 로드 경로와 같은 정제(migrateParams)를 지나야 한다. 예전에는
  // ScenarioManager가 `json.userProfile`의 존재만 확인하고 handleUpdateScenarioData로
  // 직행했다 — 조작된 JSON의 expectancy: 1e9가 상태·엔진·E2EE 저장소까지 그대로 들어가고,
  // 그 값은 오류 없이 10억 번 도는 루프가 된다(normalizeSimulationParams의 humanAge 주석).
  //
  // raw를 unknown으로 받는 이유는 migrateParams와 같다: 타입을 좁혀 받으면 「이미 검증된
  // 값」이라는 거짓말이 호출부마다 다시 생긴다.
  const importScenarioData = useCallback((id: string, raw: unknown) => {
    return handleUpdateScenarioData(id, migrateParams(raw, etfTickers));
  }, [handleUpdateScenarioData, etfTickers]);

  return {
    scenarios,
    activeScenarioId,
    setActiveScenarioId,
    compareScenarioIds,
    toggleCompareScenario,
    setScenarioAnalyzed,
    activeParams,
    handleUpdateActiveParams,
    handleUpdateScenarioData,
    importScenarioData,
    handleCreateScenario,
    handleDuplicateScenario,
    handleDeleteScenario,
    handleRenameScenario,
    isLoaded,
    localKey,
    needsKeyRestore,
    restoreError,
    handleRestoreKey: async (enteredKey: string) => {
      // 길이만 본다. 예전에 사용자가 직접 정한 키에는 생성기가 쓰지 않는 0/O/1/I가 들어갈 수
      // 있으므로 문자셋으로 좁히면 그 사용자들이 자기 데이터를 못 연다.
      const cleanKey = enteredKey.trim().toUpperCase();
      if (cleanKey.length !== 6) {
        setRestoreError('보안키는 6자리입니다.');
        return false;
      }
      const userId = session?.user?.id;
      if (!userId) return false;
      setRestoreError(null);

      // Verify key correctness by attempting to decrypt the encrypted scenarios on the server
      try {
        const res = await fetch('/api/scenarios');
        if (!res.ok) throw new Error('Failed to fetch scenarios');
        const { data } = await res.json();

        const encryptedItems: Array<{ id: string; data: unknown }> = (Array.isArray(data) ? data : [])
          .filter((s: { data: unknown }) => isEncryptedPayload(s.data));

        // 검증할 암호문이 하나도 없으면 이 키가 맞는지 확인할 방법이 없다.
        //
        // 예전에는 이 경우 검증 블록을 통째로 건너뛰고 아래로 흘러내려, 사용자가 입력한 아무
        // 6자리 문자열이나 정답으로 저장했다. 그 키로 이후 데이터가 암호화되면 사용자는 자기
        // 데이터를 영원히 열 수 없다.
        //
        // 예전 주석은 "복구 모달이 떴다는 것은 애초에 암호문이 있었다는 뜻"이라고 적었지만
        // 더는 참이 아니다. 서버 플래그(e2eeEnabled)만으로도 모달이 뜨므로, 행이 전부 평문인
        // 계정도 여기에 도달한다. 그 계정에서는 맞는 키도 여기서 막히므로 restoreUnverifiable로
        // 모달에 알려 초기화 버튼을 처음부터 열어 둔다. 그 초기화는 읽히는 평문을 보존한다.
        if (encryptedItems.length === 0) {
          setRestoreUnverifiable(true);
          setRestoreError('서버에서 암호화된 데이터를 찾지 못해 보안키를 확인할 수 없습니다. 아래에서 데이터를 유지한 채 새 보안키를 발급받을 수 있습니다.');
          return false;
        }

        let decryptedSuccessfully = false;
        const failedScenarioIds: string[] = [];

        for (const s of encryptedItems) {
          try {
            await decryptData(s.data as EncryptedData, cleanKey, userId);
            decryptedSuccessfully = true;
          } catch {
            failedScenarioIds.push(s.id);
          }
        }

        if (!decryptedSuccessfully) {
          // 암호화된 시나리오가 있는데 단 하나도 복호화되지 않았다면 키 자체가 틀린 것이다.
          setRestoreError('보안키가 올바르지 않습니다.');
          return false;
        }

        if (failedScenarioIds.length > 0) {
          // 키는 맞지만(다른 시나리오는 복호화됨) 일부 시나리오만 복호화에 실패했다면,
          // 그건 키 문제가 아니라 해당 시나리오 데이터 자체가 손상된 것이다. 이후 로드에서
          // 같은 키를 다시 요구하는 무한 루프에 빠지지 않도록 손상된 것으로 기록해둔다.
          failedScenarioIds.forEach((id) => corruptedScenarioIdsRef.current.add(id));
          alert(`일부 시나리오(${failedScenarioIds.length}개)는 데이터가 손상되어 복구할 수 없습니다. 해당 시나리오는 기본값으로 표시됩니다. 필요하면 삭제 후 다시 만들어주세요.`);
        }
      } catch (err) {
        console.error('Verification of restore key failed:', err);
        setRestoreError('시나리오를 불러오지 못해 보안키를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
        return false;
      }

      setRestoreError(null);
      localStorage.setItem(e2eeKeyName(userId), cleanKey);
      localStorage.setItem(e2eeBackedUpKeyName(userId), 'true');
      setLocalKey(cleanKey);
      setIsBackupKeyBackedUp(true);
      setNeedsKeyRestore(false);
      setRestoreUnverifiable(false);
      // 요청 키를 무효화해 재적재를 촉발한다. 로딩 이펙트가 isLoaded를 의존성으로 갖고
      // 있으므로, 위 setLocalKey가 값을 바꾸지 않는 경우(같은 키로 복구)에도 다시 돈다.
      setLoadedRequestKey(null);
      return true;
    },
    loadError,
    handleRetryLoad: () => {
      setRetryCount(prev => prev + 1);
    },
    // 탈퇴가 signOut으로 페이지를 떠나기 직전에 부른다. 위 beforeunload 주석 참조.
    disarmUnsavedGuard: () => {
      unsavedGuardDisarmedRef.current = true;
    },
    isSaving,
    saveStatus,
    lastSaved,
    keyNotice,
    // 발급된 키를 사용자가 확인했다. 여기서 비로소 setLocalKey가 불리고, 그 결과
    // loadRequestKey가 바뀌어 로딩 이펙트가 다시 돈다. 이번에는 키가 있으므로 시나리오가
    // 없으면 기본 시나리오를 만들고, 평문 행이 있으면 그것을 암호화해 되돌린다 — 어느 쪽이든
    // 생성/재암호화 로직을 여기에 복제하지 않는다.
    handleAcknowledgeKey: () => {
      const userId = session?.user?.id;
      const key = keyNotice?.key;
      if (!userId || !key) return;
      localStorage.setItem(e2eeBackedUpKeyName(userId), 'true');
      setIsBackupKeyBackedUp(true);
      setKeyIssuance(null);
      setLocalKey(key);
      // localKey가 이미 같은 값이면(unbacked 경로) setLocalKey가 bail-out해 의존성이
      // 그대로이므로, handleRestoreKey와 같은 방식으로 요청 키를 무효화해 재적재를 보장한다.
      setLoadedRequestKey(null);
    },
    // 같은 키를 다시 보낸다. 새 키를 만들면 이미 발송된 키로 암호화된 데이터를 열 수 없게 된다.
    handleRetrySendKey: async (): Promise<SendKeyResult> => {
      const key = keyNotice?.key;
      if (!key) return { success: false, error: '보낼 보안키가 없습니다.' };
      setKeyIssuance({ status: 'sending', key });
      const result = await postBackupKey(key);
      if (result.success) {
        const userId = session?.user?.id;
        if (userId) localStorage.setItem(e2eeBackedUpKeyName(userId), 'true');
        setIsBackupKeyBackedUp(true);
      }
      setKeyIssuance(result.success
        ? { status: 'sent', key }
        : {
            status: 'failed',
            key,
            error: result.error,
          });
      return result;
    },
    // 복구를 요구받으면서도 대조할 암호문이 없는 상태인지. true면 모달이 초기화 버튼을
    // 처음부터 연다 — 그 상태에서는 맞는 키를 넣어도 검증이 불가능하기 때문이다.
    restoreUnverifiable,
    // 보안키를 잊은 사용자의 마지막 탈출구: 열 수 없는 데이터를 버리고 새 키를 발급받는다.
    //
    // "열 수 없는"이 중요하다. 예전에는 기본 시나리오를 무조건 initialParams로 덮었는데, 서버
    // 행이 평문이라 멀쩡히 읽히던 계정에서도 그랬다. 그 계정이 이 경로에 오는 이유는 바로
    // 검증할 암호문이 없어 맞는 키가 거부됐기 때문이므로, 탈출구가 곧 데이터 파괴였다.
    // 이제 암호문 행만 버리고 평문 행은 새 키로 암호화해 살린다.
    //
    // 상태의 scenarios가 아니라 서버를 다시 읽는다. 잠긴 계정을 키 없이 연 경로는 평문 행까지
    // 자리표시자(initialParams)로 덮어 두었으므로, 상태에는 살릴 원본이 남아 있지 않다.
    //
    // page.tsx에 있던 handleResetAllScenarios를 옮겨 왔다. 초기화 후 이메일 전송이 실패하면
    // 최초 발급과 똑같은 모달(키 노출 + 재시도)을 띄워야 하는데, 그 상태가 이 훅에 있어
    // 바깥에서는 건드릴 수 없었기 때문이다.
    handleResetAndReissueKey: async () => {
      const userId = session?.user?.id;
      if (!userId) return;
      const newKey = generateBackupKey();
      if (!newKey) {
        alert('보안키를 생성하지 못했습니다. 페이지를 새로고침해 주세요.');
        return;
      }

      let serverRows: Array<{ id: string; isDefault: boolean; data: unknown }>;
      try {
        const res = await fetch('/api/scenarios');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { data } = await res.json();
        serverRows = Array.isArray(data) ? data : [];
      } catch (err) {
        // 서버 상태를 모르는 채 진행하면 무엇을 살리고 무엇을 버릴지 판단할 수 없다.
        // 새 키를 기록하기 전에 멈춘다 — 여기서 멈추면 옛 상태 그대로다.
        console.error('Failed to read scenarios before reset:', err);
        alert('시나리오를 불러오지 못해 초기화를 진행할 수 없습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }

      // 재암호화 PUT보다 먼저 기록한다. 중간에 실패하면 아무도 모르는 키로 암호화된 데이터가
      // 서버에 남는다.
      localStorage.setItem(e2eeKeyName(userId), newKey);
      localStorage.setItem(e2eeBackedUpKeyName(userId), 'false');
      setIsBackupKeyBackedUp(false);

      try {
        const defaultRow = serverRows.find(s => s.isDefault) || serverRows[0];
        for (const s of serverRows) {
          // 평문 행은 읽히므로 버릴 이유가 없다. 새 키로 잠가서 그대로 살린다.
          const survives = !isEncryptedPayload(s.data);
          if (!survives && s.id !== defaultRow?.id) {
            await fetch(`/api/scenarios/${s.id}`, { method: 'DELETE' });
            continue;
          }
          // **여기서만 정제 결과가 저장 데이터를 «덮는다».** 다른 호출부는 읽기 시점의
          // 교정이라 원본이 서버에 남지만, 이 PUT은 정제된 값을 새 키로 잠가 되쓰므로
          // 정제 전 바이트가 사라진다. 통화를 읽지 못해 USD가 KRW로 바뀐 계좌가 있다면
          // 그 오독이 영구화된다.
          //
          // 그래서 계산에 닿는 값이 바뀐 행은 정제 «전» 값으로 잠근다. 새 키로 열리게
          // 한다는 이 함수의 목적은 그대로 달성되고, 교정은 다음 로드 때 읽기 시점에
          // 다시 일어난다 — 원본을 지우지 않고서도 같은 화면을 얻는다.
          let payload: unknown = initialParams;
          if (survives) {
            const { params, issues } = normalizeSimulationParamsWithIssues(s.data);
            const risky = financialIssues(issues);
            if (risky.length > 0) {
              console.error(
                `[정제] 시나리오 ${s.id}: 계산에 쓰이는 값 ${risky.length}건이 정제로 달라져 `
                + '원본을 그대로 재암호화합니다',
                risky.map(describeIssue),
              );
              payload = s.data;
            } else {
              payload = params;
            }
          }
          const encrypted = await encryptData(payload, newKey, userId);
          const res = await fetch(`/api/scenarios/${s.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: encrypted }),
          });
          // 여기서 조용히 넘어가면 옛 키로 암호화된 행이 남는데 새 키는 이미 기록돼 있다
          // — 아무도 못 여는 계정이 된다.
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        console.error('Failed to reset scenarios:', err);
        alert('초기화 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }

      // 옛 키 기준의 "손상됨" 판정은 새 키에서 무의미하다. 남겨 두면 정당한 복구 요구를 막는다.
      corruptedScenarioIdsRef.current.clear();
      // 재적재 후 이 사용자에게 또 발급이 나가지 않도록 래치를 채운다.
      keyIssuedForUserRef.current = userId;
      setNeedsKeyRestore(false);
      setRestoreUnverifiable(false);
      setRestoreError(null);

      setKeyIssuance({ status: 'sending', key: newKey });
      const result = await postBackupKey(newKey);
      setKeyIssuance(result.success
        ? { status: 'sent', key: newKey }
        : {
            status: 'failed',
            key: newKey,
            error: result.error,
          });

      // window.location.reload() 대신 handleRestoreKey와 같은 재적재 경로를 쓴다.
      // 전체 리로드는 방금 세팅한 발급 모달까지 날려 버린다.
      setLocalKey(newKey);
      setLoadedRequestKey(null);
    },
  };
}
