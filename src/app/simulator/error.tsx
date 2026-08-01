'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, RotateCcw } from 'lucide-react';

// /simulator 라우트의 에러 바운더리(App Router 규약).
//
// 이 앱에는 지금까지 error.tsx나 ErrorBoundary가 하나도 없어서, 시뮬레이션 도중 예외가
// 나면 화면 전체가 빈 페이지가 되고 사용자는 무슨 일이 일어났는지 알 수 없었다.
// SimulationEngine.runSingle은 ~540줄 3중 중첩 루프이고, 입력은 E2EE 복호화 결과나
// import된 레거시 JSON처럼 이 앱이 형태를 보장하지 못하는 데이터다.
//
// 직전 성공 결과로 되돌리는 폴백은 두지 않기로 했다 — 살아 있는 설정 패널 옆에 낡은
// 결과를 띄우면 이 브랜치가 계속 걷어내 온 "화면과 엔진의 불일치"를 새로 만든다.
// 따라서 engine.run이 던지는 모든 실패가 여기로 온다. reset()만 제공하면 같은 입력으로
// 같은 예외가 반복되어 사용자가 갇히므로, "저장된 시나리오 자체가 문제일 수 있다"는
// 안내를 함께 준다.
export default function SimulatorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Simulator route error', error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-card-border p-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <AlertCircle size={20} className="text-amber-500" aria-hidden="true" />
          시뮬레이션을 계산하지 못했습니다
        </h1>

        <p className="text-sm text-foreground-muted">
          입력한 값의 조합으로 계산을 끝내지 못했습니다. 저장된 데이터는 그대로 남아 있습니다.
          다시 시도해도 같은 화면이 나오면, 마지막으로 바꾼 설정(나이·수익률·의료비 등)을
          되돌리거나 다른 시나리오를 선택해 주세요.
        </p>

        {error.digest && (
          <p className="text-xs text-foreground-muted">오류 코드: {error.digest}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 rounded-full border border-primary/40 px-3 py-1.5 text-sm font-semibold text-primary"
          >
            <RotateCcw size={14} aria-hidden="true" />
            다시 시도
          </button>
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-full border border-card-border px-3 py-1.5 text-sm text-foreground-muted"
          >
            홈으로 돌아가기
          </Link>
        </div>
      </div>
    </main>
  );
}
