import React from 'react';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  glowColor?: 'primary' | 'secondary' | 'accent' | 'none';
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className = '',
  interactive = false,
  glowColor = 'none',
  style,
  ...props
}) => {
  const glowStyles = {
    primary: 'rgba(99, 102, 241, 0.15)',
    secondary: 'rgba(168, 85, 247, 0.15)',
    accent: 'rgba(6, 182, 212, 0.15)',
    none: 'transparent',
  };

  const shadowGlow = glowColor !== 'none' 
    ? `0 8px 32px 0 rgba(0, 0, 0, 0.37), 0 0 20px 0 ${glowStyles[glowColor]}` 
    : '0 8px 32px 0 rgba(0, 0, 0, 0.37)';

  return (
    <div
      className={`glass ${interactive ? 'glass-interactive' : ''} ${className}`}
      style={{
        boxShadow: shadowGlow,
        ...style,
        padding: '1.5rem',
      }}
      {...props}
    >
      {children}
    </div>
  );
};
export default GlassCard;
