import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import styles from './Dashboard.module.css';

import { UserProfile } from '../../../core/entities/types';

interface AiAdvisorCardProps {
  score: number;
  monthlyTarget: number;
  formatValue: (val: number) => string;
  isPro?: boolean;
  userProfile?: UserProfile;
}

export const AiAdvisorCard: React.FC<AiAdvisorCardProps> = ({ score, monthlyTarget, formatValue, isPro, userProfile }) => {
  const [advice, setAdvice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const fetchAdvice = async () => {
      setIsLoading(true);
      setError(null);
      setAdvice('');

      try {
        const response = await fetch('/api/ai-advisor', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            score,
            monthlyTarget,
            isPro,
            userProfile,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to fetch advice');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No readable stream');

        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          
          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (line.trim() === '') continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.response) {
                setAdvice((prev) => prev + parsed.response);
              }
            } catch (e) {
              console.warn('Failed to parse JSON line:', line);
            }
          }
        }
        
        // Process any remaining buffer after stream ends
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.response) {
              setAdvice((prev) => prev + parsed.response);
            }
          } catch (e) {
            // Ignore
          }
        }
      } catch (err: any) {
        console.error('Error fetching AI advice:', err);
        setError('AI 조언을 가져오는 데 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAdvice();
  }, [score, monthlyTarget, isPro, userProfile]);

  return (
    <motion.div 
      className={styles.aiAdvisorContainer}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.6 }}
    >
      <h3 className={styles.sectionTitle}>🤖 AI 노후 설계사의 조언</h3>
      <div className={styles.aiCard}>

        <div className={styles.aiContent}>
          {error ? (
            <p className={styles.aiText} style={{ color: 'var(--error)' }}>{error}</p>
          ) : (
            <p className={styles.aiText}>
              {advice.split('\n').map((line, i) => (
                <React.Fragment key={i}>
                  {line}
                  <br />
                </React.Fragment>
              ))}
              {isLoading && (
                <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '8px' }}>
                  <Loader2 size={16} className="animate-spin" style={{ color: 'var(--primary)' }} />
                </span>
              )}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
};
