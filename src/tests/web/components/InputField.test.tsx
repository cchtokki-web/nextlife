import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  // A3(WCAG 2.5.3): 보이는 라벨이 곧 접근성 이름이어야 음성 제어가 동작한다.
  // 지금까지는 <label>에 htmlFor가 없고 입력이 중첩되어 있지도 않아 아무 연결이 없었고,
  // 그 자리를 서로 다른 문자열의 aria-label이 메우고 있었다.
  test('보이는 label이 htmlFor/id로 입력과 연결된다', () => {
    render(<InputField label="연 주가 상승률" type="number" />);

    expect(screen.getByLabelText('연 주가 상승률')).toBeInTheDocument();
  });

  test('id를 직접 주면 그 id로 연결한다', () => {
    render(<InputField label="연 이자율 (금리)" id="rate-1" />);

    expect(screen.getByLabelText('연 이자율 (금리)')).toHaveAttribute('id', 'rate-1');
  });

  test('같은 label을 두 번 렌더해도 id가 충돌하지 않는다', () => {
    render(
      <>
        <InputField label="연 수익률" />
        <InputField label="연 수익률" />
      </>
    );

    const [first, second] = screen.getAllByLabelText('연 수익률');
    expect(first.id).not.toBe(second.id);
  });
});

// 모바일 사파리는 글자 자판이 올라온 입력에 자동수정·예측 입력·첫 글자 대문자화를 붙인다.
// 타이핑 도중 스크립트가 값을 다시 쓰는 숫자 칸(금액의 콤마)에서는 그 도우미가 화면의 값과
// 어긋나, 지운 글자가 되살아나거나 지워지지 않는 것처럼 보인다.
describe('InputField - 숫자 칸의 모바일 키보드', () => {
  test.each(['number', 'text'])('type=%s에 숫자 inputMode를 주면 글자 도우미를 끈다', (type) => {
    render(
      <InputField
        label="현재 잔액" type={type} inputMode={type === 'number' ? undefined : 'decimal'}
        value="1,000" onChange={vi.fn()}
      />
    );

    const input = screen.getByLabelText('현재 잔액');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('autocapitalize', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
  });

  test('숫자 칸이 아니면 글자 도우미를 건드리지 않는다', () => {
    render(<InputField label="자산 이름" type="text" value="삼성전자" onChange={vi.fn()} />);

    const input = screen.getByLabelText('자산 이름');
    expect(input).not.toHaveAttribute('autocorrect');
    expect(input).not.toHaveAttribute('autocapitalize');
  });

  test('호출부가 직접 준 값이 우선한다', () => {
    render(
      <InputField label="현재 잔액" type="number" autoCapitalize="characters" value={1} onChange={vi.fn()} />
    );

    expect(screen.getByLabelText('현재 잔액')).toHaveAttribute('autocapitalize', 'characters');
  });
});

// A2(1): disabled 입력이라도 스크립트로 값을 바꾸는 것은 브라우저가 막지 않는다.
// 스테퍼 버튼은 input.stepUp() 후 'input' 이벤트를 직접 dispatch하므로, 버튼이 살아 있으면
// 잠긴 필드가 그대로 편집된다(전략이 수익률을 지배하는 동안 화면과 엔진이 어긋난다).
describe('InputField - disabled일 때의 스테퍼 버튼', () => {
  test('disabled면 스테퍼 버튼을 렌더하지 않는다', () => {
    render(<InputField label="연 성장률" type="number" value={5} onChange={vi.fn()} disabled />);

    expect(screen.queryByLabelText('Increase value')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Decrease value')).not.toBeInTheDocument();
  });

  test('disabled가 아니면 스테퍼 버튼이 그대로 있다', () => {
    render(<InputField label="연 성장률" type="number" value={5} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Increase value')).toBeInTheDocument();
    expect(screen.getByLabelText('Decrease value')).toBeInTheDocument();
  });

  test('disabled면 onStepUp/onStepDown 콜백형 스테퍼도 노출하지 않는다', () => {
    const onStepUp = vi.fn();
    render(
      <InputField
        label="사적연금 저율과세 한도" type="text" value="1,500,000"
        onChange={vi.fn()} onStepUp={onStepUp} onStepDown={vi.fn()} disabled
      />
    );

    expect(screen.queryByLabelText('Increase value')).not.toBeInTheDocument();
  });

  test('스테퍼로 값을 올리면 onChange가 발화한다(활성 상태의 기존 동작)', () => {
    const onChange = vi.fn();
    render(<InputField label="연 성장률" type="number" value={5} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Increase value'));

    expect(onChange).toHaveBeenCalled();
  });
});
