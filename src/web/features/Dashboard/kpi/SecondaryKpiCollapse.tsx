'use client';

import { Collapse } from '../../../components/ui';
import { CoreMetricsCards } from '../CoreMetricsCards';

interface SecondaryKpiCollapseProps {
  depletionAge: number | null;
  expectancyAge: number;
  monthlyTarget: number;
  isMonthlyTargetPossible: boolean;
  formatValue: (val: number) => string;
  calculatedTargetSpending?: number;
}

// CoreKpiGrid(핵심 4개)에 들어가지 않는 나머지 지표를 기본 닫힘 상태로 보여준다.
export function SecondaryKpiCollapse(props: SecondaryKpiCollapseProps) {
  return (
    <Collapse title={<span className="font-medium">추가 지표 더 보기</span>} className="mb-6">
      <CoreMetricsCards {...props} />
    </Collapse>
  );
}
