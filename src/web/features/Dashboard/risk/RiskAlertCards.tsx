import { AlertTriangle } from 'lucide-react';
import { RiskAlert } from '../../../../core/usecases/dashboard/computeRiskAlerts';

interface RiskAlertCardsProps {
  alerts: RiskAlert[];
}

// computeRiskAlerts가 반환한 리스크를 눈에 띄는 경고 카드로 보여준다. 해당 사항이 없으면(0개)
// 섹션 자체를 렌더링하지 않는다.
export function RiskAlertCards({ alerts }: RiskAlertCardsProps) {
  if (alerts.length === 0) return null;

  return (
    <div className="mb-6 flex flex-col gap-3">
      {alerts.map((alert) => (
        <div key={alert.key} className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-danger">{alert.title}</p>
            <p className="mt-1 text-sm text-foreground-muted">{alert.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
