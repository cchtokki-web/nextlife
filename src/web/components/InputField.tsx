import React from 'react';
import styles from '../styles/components.module.css';
import { ChevronUp, ChevronDown } from 'lucide-react';

// React가 제어 컴포넌트의 값 변경을 감지하려고 DOM 노드에 몰래 붙여 두는 내부 필드.
// 공개 타입에 없으므로 여기서만 최소한으로 좁혀 쓴다 — 프로그램적으로 stepUp()을 부른 뒤
// 이 트래커를 되돌려 놓아야 React가 onChange를 실제로 발화시킨다.
interface ValueTracker { setValue(value: string): void }

function valueTrackerOf(input: HTMLInputElement): ValueTracker | undefined {
  return (input as HTMLInputElement & { _valueTracker?: ValueTracker })._valueTracker;
}


interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  labelSecondary?: string;
  prefixText?: string;
  suffixText?: string;
  onStepUp?: () => void;
  onStepDown?: () => void;
}

export const InputField = React.forwardRef<HTMLInputElement, InputFieldProps>(({
  label,
  labelSecondary,
  prefixText,
  suffixText,
  onStepUp,
  onStepDown,
  className = '',
  type,
  id,
  disabled,
  ...props
}, ref) => {
  const localRef = React.useRef<HTMLInputElement>(null);
  // 보이는 라벨을 입력의 접근성 이름으로 삼기 위한 연결 id(WCAG 2.5.3 "Label in Name").
  // 예전에는 <label>에 htmlFor가 없고 입력을 감싸지도 않아 아무 연결이 없었고, 그 자리를
  // 보이는 문구와 다른 aria-label이 메우고 있었다(예: 보이는 "연 주가 상승률" /
  // 읽히는 "연 수익률"). 음성 제어 사용자가 화면에 보이는 말을 그대로 하면 잡히지 않는다.
  // 호출부가 id를 직접 주면 그것을 존중하고, 없으면 useId로 인스턴스별 고유 id를 만든다
  // (같은 라벨의 입력이 자산 개수만큼 반복 렌더되므로 고정 id는 쓸 수 없다).
  const generatedId = React.useId();
  const inputId = id ?? generatedId;

  // Combine forwarded ref and local ref
  // localRef는 이 컴포넌트가 만든 ref라 쓰기가 안전하다. React가 주는 RefObject 타입이
  // readonly current로 선언돼 있어 MutableRefObject로 좁혀 쓴다.
  const setRef = React.useCallback((node: HTMLInputElement | null) => {
    (localRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
    }
  }, [ref]);

  // 숫자 칸에는 모바일 키보드의 «글자 도우미»를 모두 끈다.
  //
  // iOS 사파리는 type="text" 입력에 QWERTY 자판과 함께 자동수정·예측 입력·첫 글자 대문자화를
  // 붙인다. 금액 칸처럼 타이핑 도중 스크립트가 값을 다시 쓰는(콤마를 넣는) 입력에서는 그
  // 도우미가 들고 있는 「지금 치는 중인 낱말」이 화면의 실제 값과 어긋나, 지운 글자가
  // 되살아나거나 지워지지 않는 것처럼 보인다. 숫자 칸에는 이 도우미들이 할 일이 없다.
  //
  // inputMode를 보고 판단하는 이유: 금액 칸은 콤마를 직접 그려야 해서 type="text"를 쓰므로
  // type만으로는 숫자 칸인지 알 수 없다. 호출부가 다른 값을 주면 그쪽을 존중한다({...props}가
  // 뒤에 온다).
  const isNumericEntry = type === 'number'
    || props.inputMode === 'numeric'
    || props.inputMode === 'decimal';

  // 잠긴 입력에는 스테퍼를 아예 렌더하지 않는다.
  //
  // 브라우저는 disabled 입력에 대한 사용자 조작만 막을 뿐, 스크립트의 값 변경은 막지 않는다.
  // 아래 handleStepUp/handleStepDown은 input.stepUp() 후 'input' 이벤트를 직접 dispatch하므로
  // 버튼이 살아 있으면 잠긴 필드가 그대로 편집된다 — 전략(리스크 성향·경제 시나리오·연금
  // 전략)이 값을 지배하는 동안 화면과 엔진이 다시 어긋나는 경로다.
  // 비활성 버튼을 남기는 대신 숨기는 이유: 조작할 수 없는 컨트롤을 그려두면 잠금 상태가
  // 여전히 편집 가능한 것처럼 읽히고, 입력 우측 여백(inputWithSteppers)도 함께 정리된다.
  const hasSteppers = !disabled && !props.readOnly && (type === 'number' || !!(onStepUp || onStepDown));

  const handleStepUp = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onStepUp) {
      onStepUp();
    } else if (localRef.current) {
      const input = localRef.current;
      const prevValue = input.value;
      try {
        input.stepUp();
        if (input.value !== prevValue) {
          const tracker = valueTrackerOf(input);
          if (tracker) {
            tracker.setValue(prevValue);
          }
          const event = new Event('input', { bubbles: true });
          input.dispatchEvent(event);
        }
      } catch {
        // Fallback for non-numeric/text input fallback stepping
        const step = parseFloat(input.step) || 1;
        const currentVal = parseFloat(input.value.replace(/,/g, '')) || 0;
        const max = input.max ? parseFloat(input.max) : Infinity;
        const newVal = Math.min(max, currentVal + step);
        
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(input, newVal.toString());
        } else {
          input.value = newVal.toString();
        }
        const event = new Event('input', { bubbles: true });
        input.dispatchEvent(event);
      }
    }
  };

  const handleStepDown = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onStepDown) {
      onStepDown();
    } else if (localRef.current) {
      const input = localRef.current;
      const prevValue = input.value;
      try {
        input.stepDown();
        if (input.value !== prevValue) {
          const tracker = valueTrackerOf(input);
          if (tracker) {
            tracker.setValue(prevValue);
          }
          const event = new Event('input', { bubbles: true });
          input.dispatchEvent(event);
        }
      } catch {
        // Fallback
        const step = parseFloat(input.step) || 1;
        const currentVal = parseFloat(input.value.replace(/,/g, '')) || 0;
        const min = input.min ? parseFloat(input.min) : 0;
        const newVal = Math.max(min, currentVal - step);
        
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(input, newVal.toString());
        } else {
          input.value = newVal.toString();
        }
        const event = new Event('input', { bubbles: true });
        input.dispatchEvent(event);
      }
    }
  };

  return (
    <div className={styles.formGroup}>
      {label && (
        <label className={`${styles.label} ${labelSecondary ? styles.labelWithSecondary : ''}`} htmlFor={inputId}>
          <span>{label}</span>
          {labelSecondary && <span className={styles.labelSecondary}>{labelSecondary}</span>}
        </label>
      )}
      <div className={styles.inputWrapper}>
        {prefixText && <span className={styles.prefix}>{prefixText}</span>}
        <input
          ref={setRef}
          id={inputId}
          disabled={disabled}
          type={type}
          className={`${styles.input} ${prefixText ? styles.inputWithPrefix : ''} ${
            suffixText ? styles.inputWithSuffix : ''
          } ${hasSteppers ? styles.inputWithSteppers : ''} ${className}`}
          autoComplete="off"
          {...(isNumericEntry
            ? { autoCorrect: 'off' as const, autoCapitalize: 'off' as const, spellCheck: false }
            : {})}
          {...props}
        />
        {suffixText && (
          <span className={`${styles.suffix} ${hasSteppers ? styles.suffixWithSteppers : ''}`}>
            {suffixText}
          </span>
        )}
        {hasSteppers && (
          <div className={styles.stepperContainer}>
            <button
              type="button"
              onClick={handleStepUp}
              className={styles.stepperButton}
              aria-label="Increase value"
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              onClick={handleStepDown}
              className={styles.stepperButton}
              aria-label="Decrease value"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

InputField.displayName = 'InputField';

export default InputField;
