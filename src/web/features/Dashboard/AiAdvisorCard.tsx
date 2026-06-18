import React from 'react';
import { motion } from 'framer-motion';
import { Bot } from 'lucide-react';
import styles from './Dashboard.module.css';

interface AiAdvisorCardProps {
  score: number;
  monthlyTarget: number;
  formatValue: (val: number) => string;
}

export const AiAdvisorCard: React.FC<AiAdvisorCardProps> = ({ score, monthlyTarget, formatValue }) => {
  let advice = '';
  if (score >= 90) {
    advice = `현재 자산과 투자 계획으로 월 ${formatValue(monthlyTarget)} 생활이 충분히 가능합니다. 
지금의 계획을 잘 유지하시면서, 여유 자금으로 여행이나 취미 활동을 늘려보시는 것도 좋겠습니다.`;
  } else if (score >= 70) {
    advice = `현재 자산과 투자 계획 기준으로는 월 ${formatValue(monthlyTarget)} 생활이 어느 정도 가능하지만,
조금 더 안정적인 노후를 위해
• 매월 투자금 50만원 추가 또는
• 은퇴 시기 1~2년 연기
중 하나를 고려해보시는 것을 추천합니다.`;
  } else {
    advice = `현재 상태로는 월 ${formatValue(monthlyTarget)} 생활 목표를 달성하기 어려울 수 있습니다.
목표 달성을 위해 다음과 같은 변화가 필요합니다.
• 매월 투자금 100만원 이상 추가
• 은퇴 시기 3년 이상 연기
• 또는 목표 생활비 하향 조정`;
  }

  return (
    <motion.div 
      className={styles.aiAdvisorContainer}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.6 }}
    >
      <h3 className={styles.sectionTitle}>🤖 AI 노후 설계사의 조언</h3>
      <div className={styles.aiCard}>
        <div className={styles.aiIconWrapper}>
          <Bot size={28} className={styles.aiIcon} />
        </div>
        <div className={styles.aiContent}>
          <p className={styles.aiText}>
            {advice.split('\n').map((line, i) => (
              <React.Fragment key={i}>
                {line}
                <br />
              </React.Fragment>
            ))}
          </p>
        </div>
      </div>
    </motion.div>
  );
};
