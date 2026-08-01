import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SelectField from '@/web/components/SelectField';

const options = [{ value: 'KRW', label: 'KRW (대한민국 원)' }];

describe('SelectField', () => {
  test('label을 주면 <label>이 렌더되고 그 텍스트가 보인다', () => {
    const { container } = render(<SelectField label="대시보드 기준 통화" options={options} />);

    expect(screen.getByText('대시보드 기준 통화')).toBeInTheDocument();
    expect(container.querySelector('label')).not.toBeNull();
  });

  test('label=""이면 <label> 요소가 렌더되지 않는다', () => {
    const { container } = render(
      <SelectField label="" aria-label="대시보드 기준 통화" options={options} />
    );

    expect(container.querySelector('label')).toBeNull();
  });

  test('label=""이어도 aria-label로 준 접근성 이름은 그대로 동작한다', () => {
    render(<SelectField label="" aria-label="대시보드 기준 통화" options={options} />);

    expect(screen.getByLabelText('대시보드 기준 통화')).toBeInTheDocument();
  });
});
