import React from 'react';
import styles from '../styles/components.module.css';

interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  labelSecondary?: string;
  options: { value: string; label: string }[];
}

export const SelectField: React.FC<SelectFieldProps> = ({
  label,
  labelSecondary,
  options,
  className = '',
  ...props
}) => {
  return (
    <div className={styles.formGroup}>
      {label && (
        <label className={`${styles.label} ${labelSecondary ? styles.labelWithSecondary : ''}`}>
          <span>{label}</span>
          {labelSecondary && <span className={styles.labelSecondary}>{labelSecondary}</span>}
        </label>
      )}
      <div className={styles.inputWrapper}>
        <select
          className={`${styles.input} ${styles.select} ${className}`}
          {...props}
          onChange={(e) => {
            if (props.onChange) {
              props.onChange(e);
            }
            e.currentTarget.blur();
          }}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
export default SelectField;
