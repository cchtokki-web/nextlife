'use client';

import { type LegendPayload } from 'recharts';

export interface ChartLegendItem {
  // recharts 시리즈의 dataKey. 토글 상태(hiddenKeys)의 키이기도 하다.
  dataKey: string;
  label: string;
  color: string;
  // 선으로 그리는 시리즈는 점선/실선 표식이 더 읽기 쉽다.
  shape?: 'area' | 'line' | 'dashed';
}

// 범례 항목의 색을 dataKey로 찾는다. **색의 출처는 범례 목록 하나다.**
//
// 툴팁이 색을 다시 적으면 범례·그래프·툴팁 세 곳이 각자의 색을 갖게 되고, 그 어긋남은 아무
// 오류도 내지 않는다 — 사용자만 초록 띠와 보라 글자를 눈으로 이어야 한다.
//
// 목록에 없는 키에는 undefined를 준다(색 없음). 임의의 기본색을 돌려주면 범례에 없는 계열이
// 있는 것처럼 보인다.
export function legendColorOf(
  items: readonly ChartLegendItem[],
  dataKey: string,
): string | undefined {
  return items.find((item) => item.dataKey === dataKey)?.color;
}

interface ChartLegendProps {
  items: readonly ChartLegendItem[];
  hiddenKeys: Record<string, boolean>;
  onToggle: (payload: LegendPayload) => void;
}

// 차트 범례를 recharts의 `<Legend>` 대신 **SVG 바깥 HTML로** 그린다.
//
// **왜 recharts 범례를 쓰지 않는가.**
//
// `<Legend verticalAlign="top" height={N}>`의 N은 이 버전에서 래퍼의 CSS 높이만 정하고
// 차트 영역을 밀어내지는 않는다. 실측하면 플롯 상단은 항상 `margin.top + 36`(recharts
// 기본 범례 높이)에 고정된다. 그래서 항목이 한 줄에 다 들어가지 않는 순간 — 모바일 390px에서
// 재원 구성 차트는 7개 항목이 3줄이 된다 — 두 번째 줄부터가 그래프와 Y축 눈금 위에 그대로
// 겹쳐 찍힌다. margin.top을 키워도 범례가 함께 내려가서 해결되지 않는다.
//
// HTML로 올리면 줄 수가 늘어난 만큼 차트가 자연스럽게 아래로 밀리고, 줄바꿈·폰트·간격을
// 우리가 제어할 수 있다. 클릭 토글은 기존 onLegendClick 핸들러(dataKey를 읽는다)를
// 그대로 재사용하므로 동작이 달라지지 않는다.
export function ChartLegend({ items, hiddenKeys, onToggle }: ChartLegendProps) {
  return (
    <ul className="mb-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-1 text-xs">
      {items.map((item) => {
        const hidden = !!hiddenKeys[item.dataKey];
        return (
          <li key={item.dataKey}>
            <button
              type="button"
              // 범례는 "지금 무엇이 보이는가"를 나타내는 토글이다. 스크린리더에도 그렇게 알린다.
              aria-pressed={!hidden}
              aria-label={`${item.label} ${hidden ? '표시' : '숨기기'}`}
              onClick={() => onToggle({ dataKey: item.dataKey, value: item.label } as LegendPayload)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded px-1 py-0.5 transition-opacity hover:bg-foreground/5 ${
                hidden ? 'opacity-40' : ''
              }`}
            >
              <Swatch color={item.color} shape={item.shape ?? 'area'} />
              <span className="text-foreground-muted">{item.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// 색 표식. 면적/막대는 채운 사각형, 선은 가로줄, 기준선 성격의 시리즈는 점선으로 구분한다 —
// 차트에서 그 시리즈가 어떤 모양으로 그려지는지와 맞춘다.
function Swatch({ color, shape }: { color: string; shape: NonNullable<ChartLegendItem['shape']> }) {
  if (shape === 'area') {
    return <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />;
  }
  return (
    <span
      className="h-0 w-3.5 shrink-0"
      style={{
        borderTop: `2px ${shape === 'dashed' ? 'dashed' : 'solid'} ${color}`,
      }}
      aria-hidden="true"
    />
  );
}
