'use client';

import { useMemo, useState } from 'react';
import { SimulationParams, SimulationResult, YearlyLedger } from '../../../../core/entities/types';
import { formatYearLedger, ledgerTolerance } from '../../../../core/usecases/ledger/YearLedger';

// 개발자용 회계 원장 뷰어.
//
// **왜 화면에 두는가**: 「60~64세 부족자금 982만원」과 「같은 기간 자산 1.7억 감소」가 서로
// 모순돼 보인다는 지적이 나왔을 때, 두 숫자를 나란히 놓고 대조할 자리가 어디에도 없었다.
// 엔진 안에서는 매년 항등식을 검사하지만(assertLedgerConsistent), 검사가 통과했다는 사실은
// "모순이 아니다"를 설명해 주지 않는다 — 설명은 각 항의 «크기»에서 나온다.
//
// NEXT_PUBLIC_DEV_MODE에서만 렌더한다. 일반 사용자에게 필요한 정보가 아니고, 여기 적힌
// 「계좌 간 이동」 같은 말은 회계 규약을 아는 사람에게만 뜻이 통한다.
interface LedgerDebugPanelProps {
  result: SimulationResult;
  params: SimulationParams;
}

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

export function LedgerDebugPanel({ result, params }: LedgerDebugPanelProps) {
  const ledgers = useMemo(
    () => result.yearlyResults
      .map((year) => year.ledger)
      .filter((ledger): ledger is YearlyLedger => ledger !== undefined),
    [result.yearlyResults]
  );

  // 기본 선택은 은퇴 첫 해다. 인출이 시작되는 해가 언제나 가장 먼저 확인하고 싶은 해다.
  const [selectedAge, setSelectedAge] = useState(params.userProfile.retirementAge);
  const selected = ledgers.find((ledger) => ledger.age === selectedAge) ?? ledgers[0];

  if (ledgers.length === 0) return null;

  const inconsistent = ledgers.filter((l) => Math.abs(l.residual) > ledgerTolerance(l));

  return (
    <section>
      <h4 className="mb-2 text-sm font-semibold">회계 원장 (개발 모드)</h4>
      <p className="mb-3 text-xs leading-relaxed text-foreground-muted">
        기말 = 기초 + 투자총수익 + 외부유입 − 생활비 − 세금 − 건보료.{' '}
        사적연금 인출·일반계좌 매도·ISA 인출은 계좌 «사이»의 이동이라 이 식에 들어가지 않습니다.
      </p>

      {inconsistent.length > 0 && (
        <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
          설명되지 않는 차이가 있는 해: {inconsistent.map((l) => `${l.age}세`).join(', ')}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-right text-[11px] tabular-nums">
          <thead className="text-foreground-muted">
            <tr>
              {['나이', '기초자산', '투자수익', '  가격·이자', '  배당', '국민연금', '사적연금 인출',
                '일반계좌 인출', '생활비', '세금', '기말자산', '차이'].map((label) => (
                <th key={label} className="whitespace-nowrap px-2 py-1 font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ledgers.map((l) => (
              <tr
                key={l.age}
                onClick={() => setSelectedAge(l.age)}
                className={`cursor-pointer border-t border-white/5 ${l.age === selected.age ? 'bg-white/5' : ''}`}
              >
                <td className="px-2 py-1">{l.age}</td>
                <td className="px-2 py-1">{won(l.beginningAssets)}</td>
                <td className="px-2 py-1">{won(l.investmentReturn.total)}</td>
                <td className="px-2 py-1 text-foreground-muted">{won(l.investmentReturn.priceGain)}</td>
                <td className="px-2 py-1 text-foreground-muted">{won(l.investmentReturn.dividend)}</td>
                <td className="px-2 py-1">{won(l.externalIncome.nationalPension)}</td>
                <td className="px-2 py-1">{won(l.internalWithdrawals.privatePension)}</td>
                <td className="px-2 py-1">{won(l.internalWithdrawals.taxableAccount)}</td>
                <td className="px-2 py-1">{won(l.expenses.living)}</td>
                <td className="px-2 py-1">{won(l.expenses.tax + l.expenses.healthInsurance)}</td>
                <td className="px-2 py-1 font-semibold">{won(l.endingAssets)}</td>
                <td className={`px-2 py-1 ${Math.abs(l.residual) > ledgerTolerance(l) ? 'text-danger' : 'text-foreground-muted'}`}>
                  {won(l.residual)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h5 className="mt-4 mb-2 text-xs font-semibold">{selected.age}세 상세 (행을 눌러 바꿉니다)</h5>
      <pre className="overflow-x-auto rounded-md bg-black/20 p-3 text-[11px] leading-relaxed">{formatYearLedger(selected)}</pre>
      <pre className="mt-2 overflow-x-auto rounded-md bg-black/20 p-3 text-[11px] leading-relaxed">
        {JSON.stringify(selected, null, 2)}
      </pre>
    </section>
  );
}
