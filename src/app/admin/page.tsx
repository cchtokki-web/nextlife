"use client";

import React, { useState } from 'react';
import GlassCard from '../../web/components/GlassCard';
import styles from './AdminDashboard.module.css';
import type { LucideIcon } from 'lucide-react';
import { Activity, Calendar, Clock, BarChart3, ShieldCheck } from 'lucide-react';
import type { AdminStatsResponse, AdminStatsPeriod } from '../api/admin/stats/route';

type StatsResponse = AdminStatsResponse['stats'];
type StatsData = AdminStatsPeriod;

// 렌더 안에서 정의하면 부모가 리렌더될 때마다 새 컴포넌트 타입이 되어 자식 상태가 초기화된다.
// 이 카드는 props만 쓰고 부모 클로저를 참조하지 않으므로 모듈 스코프가 제자리다.
function StatCard({ title, data, icon: Icon }: { title: string; data: StatsData; icon: LucideIcon }) {
  return (
    <GlassCard className={styles.statCard}>
      <div className={styles.statHeader}>
        <Icon size={20} color="var(--primary)" />
        {title}
      </div>
      <div className={styles.statRow}>
        <span className={styles.statLabel}>접속자 (세션)</span>
        <span className={styles.statValue}>{data.visitors.toLocaleString()} <span style={{fontSize:'1rem', color:'var(--foreground-muted)', fontWeight:'normal'}}>명</span></span>
      </div>
      <div className={styles.statRow}>
        <span className={styles.statLabel}>시뮬레이션 실행</span>
        <span className={`${styles.statValue} ${styles.highlight}`}>{data.simulationRuns.toLocaleString()} <span style={{fontSize:'1rem', color:'var(--foreground-muted)', fontWeight:'normal'}}>회</span></span>
      </div>
    </GlassCard>
  );
}

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/stats', {
        headers: {
          'Authorization': `Bearer ${adminKey}`
        }
      });

      if (res.ok) {
        const data: AdminStatsResponse = await res.json();
        setStats(data.stats);
        setIsAuthenticated(true);
      } else {
        setError('유효하지 않은 어드민 키입니다.');
      }
    } catch {
      setError('서버 연결 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthenticated || !stats) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>관리자 로그인</h1>
        </div>
        <GlassCard className={styles.loginCard}>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className={styles.inputGroup}>
              <label>어드민 키 (Admin Key)</label>
              <input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                className={styles.input}
                placeholder="어드민 키를 입력하세요"
                autoFocus
              />
            </div>
            {error && <div className={styles.error}>{error}</div>}
            <button type="submit" className={styles.button} disabled={isLoading}>
              {isLoading ? '인증 중...' : '접속하기'}
            </button>
          </form>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'0.8rem', marginBottom:'0.5rem' }}>
          <ShieldCheck size={32} color="var(--primary)" />
          <h1>통계 대시보드</h1>
        </div>
        <p style={{ color: 'var(--foreground-muted)' }}>사이트 이용자 및 시뮬레이션 실행 현황을 확인합니다.</p>
      </div>

      <div className={styles.statsGrid}>
        <StatCard title="오늘 (Daily)" data={stats.daily} icon={Clock} />
        <StatCard title="이번 주 (Weekly)" data={stats.weekly} icon={Activity} />
        <StatCard title="이번 달 (Monthly)" data={stats.monthly} icon={Calendar} />
        <StatCard title="올해 (Yearly)" data={stats.yearly} icon={BarChart3} />
      </div>
    </div>
  );
}
