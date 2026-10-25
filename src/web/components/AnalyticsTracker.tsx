'use client';

import { useEffect } from 'react';

export default function AnalyticsTracker() {
  useEffect(() => {
    // Generate or retrieve a session ID for tracking unique visits
    let sessionId = sessionStorage.getItem('analytics_session_id');
    const isNewSession = !sessionId;
    
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem('analytics_session_id', sessionId);
    }

    // Record visit if it's a new session or maybe we want to record every page visit?
    // Let's record only once per session to avoid counting every page click as a new visitor.
    if (isNewSession) {
      fetch('/api/analytics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'VISIT',
          sessionId,
        }),
      }).catch(err => console.error('Failed to log visit', err));
    }
  }, []);

  return null;
}
