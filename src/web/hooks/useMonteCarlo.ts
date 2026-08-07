'use client';

import { useEffect, useRef, useState } from 'react';
import { SimulationParams } from '../../core/entities/types';
import { MonteCarloResult } from '../../core/entities/montecarlo';
import { resolveMonteCarloConfig } from '../../core/usecases/montecarlo/volatilityPresets';
import { MonteCarloRequest, MonteCarloResponse } from '../workers/monteCarloProtocol';

export type MonteCarloStatus = 'idle' | 'running' | 'done' | 'error' | 'unsupported';

export interface UseMonteCarloResult {
  result: MonteCarloResult | undefined;
  status: MonteCarloStatus;
}

interface UseMonteCarloOptions {
  // 워커 생성을 주입 가능하게 둔다 — jsdom에는 Worker가 없어 테스트가 실제 워커를 띄울 수 없다.
  createWorker?: () => Worker;
  debounceMs?: number;
}

// Turbopack/webpack 모두 이 형태의 new Worker(new URL(...))를 정적 분석해 별도 청크로
// 번들한다(Next 16 문서: magic comments가 dynamic import()·require()·new Worker() 표현식에
// 적용된다). **리터럴 URL이어야 한다** — 문자열 경로나 변수로 주면 정적 분석이 깨진다.
function defaultCreateWorker(): Worker {
  return new Worker(new URL('../workers/monteCarlo.worker.ts', import.meta.url), { type: 'module' });
}

const DEFAULT_DEBOUNCE_MS = 400;

// 몬테카를로를 워커에서 돌리고 상태를 함께 돌려준다.
//
// **자동 실행이다(버튼 뒤에 숨기지 않는다).** 워커는 메인 스레드를 구조적으로 막지 않으므로,
// useBackgroundValue가 트랜지션 강등이라는 간접 수단으로 달성하려던 것을 직접 달성한다.
// 버튼 뒤에 두면 "기대수명까지 자산이 남을 확률"이라는 헤드라인 지표가 기본 화면에서
// 사라진다.
//
// **취소는 디바운스 + terminate()다.** 워커 안에서 시행을 청크로 쪼개고 최신 requestId를
// 검사하는 협조적 취소도 가능하지만, 그러면 워커 코드에 스케줄링 상태가 들어오고 그것이
// 옳은지 검증하려면 타이머를 흉내 내는 테스트가 필요해진다. 워커 생성 비용은 수 ms이고
// 디바운스 덕에 실제 재생성은 입력이 멈춘 뒤 한 번뿐이다.
export function useMonteCarlo(
  params: SimulationParams | undefined,
  options: UseMonteCarloOptions = {}
): UseMonteCarloResult {
  const { createWorker = defaultCreateWorker, debounceMs = DEFAULT_DEBOUNCE_MS } = options;

  const [result, setResult] = useState<MonteCarloResult | undefined>(undefined);
  const [status, setStatus] = useState<MonteCarloStatus>('idle');

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  // 옵션을 ref로 들고 있는 이유: 호출부가 인라인 객체로 넘기면 매 렌더 새 참조가 되어
  // 의존성 배열에 넣는 순간 이펙트가 무한히 재실행된다.
  //
  // 갱신을 이펙트에서 하는 이유: 렌더 중 ref 쓰기는 동시성 렌더에서 버려질 수 있는 작업에
  // 부수효과를 남긴다(react-hooks 규칙). 이 이펙트는 아래 메인 이펙트보다 먼저 선언되어
  // 먼저 실행되고, 첫 렌더에서는 useRef 초기값이 이미 옳다.
  const createWorkerRef = useRef(createWorker);
  useEffect(() => {
    createWorkerRef.current = createWorker;
  });

  // params 전체를 의존성으로 쓰면 참조가 매번 바뀌어 디바운스가 무의미해진다. 내용이
  // 같으면 같은 문자열이 되도록 직렬화한 값을 키로 쓴다 — MC 입력은 전부 평문 JSON이라
  // 안전하고, 이 저장소가 시나리오 저장에 이미 쓰는 방식이다(useScenarios의 lastSavedParams).
  const paramsKey = params ? JSON.stringify(params) : '';

  useEffect(() => {
    // params가 없으면 계산할 것이 없다. 여기서 setStatus를 부르지 않는 이유는 반환값
    // 주석 참고 — 이펙트 내 직접 setState는 연쇄 렌더를 만든다.
    if (!params) return;

    const timer = setTimeout(() => {
      // 이전 워커가 살아 있으면 종료한다. 입력이 바뀐 뒤의 계산 결과는 어차피 버려진다.
      workerRef.current?.terminate();
      workerRef.current = null;

      let worker: Worker;
      try {
        worker = createWorkerRef.current();
      } catch {
        // Worker가 없는 환경(구형 브라우저, 일부 테스트 환경)에서 화면이 죽으면 안 된다.
        setStatus('unsupported');
        return;
      }

      const requestId = ++requestIdRef.current;
      workerRef.current = worker;
      setStatus('running');

      worker.onmessage = (event: MessageEvent<MonteCarloResponse>) => {
        // terminate()가 이미 큐에 나간 메시지까지 막아 주지는 않으므로 얇은 방어를 남긴다.
        if (event.data.requestId !== requestIdRef.current) return;

        if (event.data.kind === 'done') {
          setResult(event.data.result);
          setStatus('done');
        } else {
          setStatus('error');
        }
      };

      const request: MonteCarloRequest = {
        kind: 'run',
        requestId,
        params,
        config: resolveMonteCarloConfig(params),
      };
      worker.postMessage(request);
    }, debounceMs);

    return () => clearTimeout(timer);
    // paramsKey가 내용 동등성을 대신한다(params 자체는 매 렌더 새 참조일 수 있다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, debounceMs]);

  // 언마운트 시 워커를 반드시 정리한다 — 남겨 두면 계산이 계속 돌며 CPU를 쓴다.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // params가 없는 동안의 'idle'은 상태로 저장하지 않고 렌더 시점에 파생한다.
  // 이펙트에서 setStatus('idle')을 부르면 렌더 → 이펙트 → 렌더의 연쇄가 생기고,
  // React 19의 set-state-in-effect 규칙이 정확히 그것을 금지한다.
  return { result, status: params ? status : 'idle' };
}
