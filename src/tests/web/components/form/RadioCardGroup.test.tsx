import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RadioCardGroup, RadioCardOption } from '@/web/components/form/RadioCardGroup';

type Fruit = 'apple' | 'banana';

const options: ReadonlyArray<RadioCardOption<Fruit>> = [
  { value: 'apple', label: '사과', description: '빨간 과일입니다.', recommended: true },
  { value: 'banana', label: '바나나', description: '노란 과일입니다.' },
];

describe('RadioCardGroup', () => {
  test('옵션의 라벨과 설명을 모두 렌더링한다', () => {
    render(<RadioCardGroup name="fruit" value="apple" options={options} onChange={vi.fn()} />);

    expect(screen.getByText('사과')).toBeInTheDocument();
    expect(screen.getByText('빨간 과일입니다.')).toBeInTheDocument();
    expect(screen.getByText('바나나')).toBeInTheDocument();
    expect(screen.getByText('노란 과일입니다.')).toBeInTheDocument();
  });

  test('현재 값에 해당하는 라디오만 checked이다', () => {
    render(<RadioCardGroup name="fruit" value="apple" options={options} onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /사과/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /바나나/ })).not.toBeChecked();
  });

  test('다른 옵션을 고르면 onChange가 그 값으로 호출된다', () => {
    const onChange = vi.fn();
    render(<RadioCardGroup name="fruit" value="apple" options={options} onChange={onChange} />);

    fireEvent.click(screen.getByRole('radio', { name: /바나나/ }));

    expect(onChange).toHaveBeenCalledWith('banana');
  });

  test('ariaLabel을 주면 radiogroup의 접근성 이름이 된다', () => {
    render(
      <RadioCardGroup name="fruit" ariaLabel="과일 선택" value="apple" options={options} onChange={vi.fn()} />
    );

    expect(screen.getByRole('radiogroup', { name: '과일 선택' })).toBeInTheDocument();
  });

  test('recommended 옵션에는 추천 표식이 붙는다', () => {
    render(<RadioCardGroup name="fruit" value="banana" options={options} onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /사과/ })).toHaveAccessibleName(/추천/);
  });
});
