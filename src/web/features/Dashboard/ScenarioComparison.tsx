import React from 'react';
import { motion } from 'framer-motion';
import styles from './Dashboard.module.css';

export interface ComparisonScenario {
  id: string;
  name: string;
  score: number;
  expectedAssetAt85: number;
}

interface ScenarioComparisonProps {
  currentScenario: ComparisonScenario;
  alternativeScenarios: ComparisonScenario[];
  formatValue: (val: number) => string;
}

export const ScenarioComparison: React.FC<ScenarioComparisonProps> = ({ 
  currentScenario, 
  alternativeScenarios, 
  formatValue 
}) => {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.8
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.4 } }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return styles.colorGreenText;
    if (score >= 70) return styles.colorOrangeText;
    return styles.colorRedText;
  };

  return (
    <motion.div 
      className={styles.scenarioComparisonContainer}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <h3 className={styles.sectionTitle}>💡 개선 시나리오 비교</h3>
      <div className={styles.scenarioTableWrapper}>
        <table className={styles.scenarioTable}>
          <thead>
            <tr>
              <th>시나리오</th>
              <th>유지 가능성</th>
              <th>85세 예상 자산</th>
            </tr>
          </thead>
          <tbody>
            <motion.tr variants={itemVariants} className={styles.currentScenarioRow}>
              <td>{currentScenario.name} (현재)</td>
              <td className={getScoreColor(currentScenario.score)}>
                {currentScenario.score}%
              </td>
              <td>{formatValue(currentScenario.expectedAssetAt85)}</td>
            </motion.tr>
            
            {alternativeScenarios.map((scenario) => (
              <motion.tr key={scenario.id} variants={itemVariants} className={styles.altScenarioRow}>
                <td>{scenario.name}</td>
                <td className={getScoreColor(scenario.score)}>
                  {scenario.score}% 
                  <span className={styles.scoreIncrease}>
                    (↑{Math.max(0, scenario.score - currentScenario.score)}%p)
                  </span>
                </td>
                <td>{formatValue(scenario.expectedAssetAt85)}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
};
