import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import InputField from '@/web/components/InputField';

describe('InputField', () => {
  test('label을 주면 <label>이 렌더되고 그 텍스트가 보인다', () => {
    const { container } = render(<InputField label="현재 나이" />);

    expect(screen.getByText('현재 나이')).toBeInTheDocument();
    expect(container.querySelector('label')).not.toBeNull();
  });

  test('label=""이면 <label> 요소가 렌더되지 않는다', () => {
    const { container } = render(<InputField label="" aria-label="현재 나이" />);

    expect(container.querySelector('label')).toBeNull();
  });

  test('label=""이어도 aria-label로 준 접근성 이름은 그대로 동작한다', () => {
    render(<InputField label="" aria-label="현재 나이" />);

    expect(screen.getByLabelText('현재 나이')).toBeInTheDocument();
  });
});
