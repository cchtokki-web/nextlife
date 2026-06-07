import React from 'react';
import styles from '../styles/components.module.css';
import { ChevronUp, ChevronDown } from 'lucide-react';

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
  ...props
}, ref) => {
  const localRef = React.useRef<HTMLInputElement>(null);
  
  // Combine forwarded ref and local ref
  const setRef = React.useCallback((node: HTMLInputElement | null) => {
    (localRef as any).current = node;
    if (ref) {
      if (typeof ref === 'function') {
        ref(node);
      } else {
        (ref as any).current = node;
      }
    }
  }, [ref]);

  const hasSteppers = type === 'number' || !!(onStepUp || onStepDown);

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
          const tracker = (input as any)._valueTracker;
          if (tracker) {
            tracker.setValue(prevValue);
          }
          const event = new Event('input', { bubbles: true });
          input.dispatchEvent(event);
        }
      } catch (err) {
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
          const tracker = (input as any)._valueTracker;
          if (tracker) {
            tracker.setValue(prevValue);
          }
          const event = new Event('input', { bubbles: true });
          input.dispatchEvent(event);
        }
      } catch (err) {
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
      <label className={styles.label}>
        <span>{label}</span>
        {labelSecondary && <span className={styles.labelSecondary}>{labelSecondary}</span>}
      </label>
      <div className={styles.inputWrapper}>
        {prefixText && <span className={styles.prefix}>{prefixText}</span>}
        <input
          ref={setRef}
          type={type}
          className={`${styles.input} ${prefixText ? styles.inputWithPrefix : ''} ${
            suffixText ? styles.inputWithSuffix : ''
          } ${hasSteppers ? styles.inputWithSteppers : ''} ${className}`}
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
              <ChevronUp size={12} />
            </button>
            <button
              type="button"
              onClick={handleStepDown}
              className={styles.stepperButton}
              aria-label="Decrease value"
            >
              <ChevronDown size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

InputField.displayName = 'InputField';

export default InputField;
