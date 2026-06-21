import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Bot } from 'lucide-react';
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
  
  useEffect(() => {
    const abortController = new AbortController();

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
          signal: abortController.signal,
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
        if (err.name === 'AbortError') {
          console.log('Fetch aborted due to params change');
        } else {
          console.error('Error fetching AI advice:', err);
          setError('AI 의견을 가져오는 데 실패했습니다.');
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchAdvice();

    return () => {
      abortController.abort();
    };
  }, [score, monthlyTarget, isPro, userProfile]);

  return (
    <motion.div 
      className={styles.aiAdvisorContainer}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.6 }}
    >
      <h3 className={styles.sectionTitle}>🤖 AI 노후 설계사 의견</h3>
      <div className={styles.aiCard}>
        <div className={styles.aiIconWrapper}>
          <Bot size={24} />
        </div>
        <div className={styles.aiContent}>
          {error ? (
            <p className={styles.aiText} style={{ color: 'var(--error)' }}>{error}</p>
          ) : advice === '' && isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0.5rem 0' }}>
              <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 0.8 }} style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--primary)' }} />
              <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.15 }} style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--primary)' }} />
              <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.3 }} style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--primary)' }} />
              <span style={{ marginLeft: '12px', color: 'var(--foreground-muted)', fontSize: '0.9rem', fontWeight: 500 }}>의견을 준비하고 있습니다...</span>
            </div>
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
