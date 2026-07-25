import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecutionRoadmap } from '@/web/features/Dashboard/roadmap/ExecutionRoadmap';
import { ExecutionRoadmap as ExecutionRoadmapData } from '@/core/usecases/dashboard/computeExecutionRoadmap';

const roadmap: ExecutionRoadmapData = {
  events: [
    {
      age: 60,
      items: [
        { title: '퇴직', description: '상용소득이 종료되고 자산 인출 계획이 시작됩니다.' },
        { title: '일반자산 인출 개시', description: '주식/ETF 등 일반 자산의 인출을 시작합니다.' },
      ],
    },
    {
      age: 63,
      items: [{ title: '사적연금 수령 개시', description: '사적연금(퇴직연금·연금저축 등) 인출을 시작합니다.' }],
    },
    {
      age: 68,
      items: [{ title: '국민연금 수령 개시 (연기)', description: '국민연금 수령을 시작합니다.' }],
    },
  ],
  expectancy: 90,
};

describe('ExecutionRoadmap', () => {
  test('각 이벤트의 나이/제목/설명이 표시된다', () => {
    render(<ExecutionRoadmap roadmap={roadmap} />);
    expect(screen.getByText('60세')).toBeInTheDocument();
    expect(screen.getByText('퇴직')).toBeInTheDocument();
    expect(screen.getByText('63세')).toBeInTheDocument();
    expect(screen.getByText('사적연금 수령 개시')).toBeInTheDocument();
    expect(screen.getByText('68세')).toBeInTheDocument();
    expect(screen.getByText('국민연금 수령 개시 (연기)')).toBeInTheDocument();
  });

  test('병합된 노드(60세)는 여러 items를 모두 렌더링한다', () => {
    render(<ExecutionRoadmap roadmap={roadmap} />);
    expect(screen.getByText('퇴직')).toBeInTheDocument();
    expect(screen.getByText('일반자산 인출 개시')).toBeInTheDocument();
  });

  test('이벤트 마커는 채워진(filled) 스타일, 기대수명 마커는 속이 빈(hollow) 스타일이다', () => {
    const { container } = render(<ExecutionRoadmap roadmap={roadmap} />);
    const filledMarkers = container.querySelectorAll('[data-marker="filled"]');
    const hollowMarkers = container.querySelectorAll('[data-marker="hollow"]');
    expect(filledMarkers).toHaveLength(3); // 60/63/68세 3개 노드
    expect(hollowMarkers).toHaveLength(1);
  });

  test('기대수명 텍스트가 표시된다', () => {
    render(<ExecutionRoadmap roadmap={roadmap} />);
    expect(screen.getByText(/90세/)).toBeInTheDocument();
    expect(screen.getByText(/기대수명/)).toBeInTheDocument();
  });
});
