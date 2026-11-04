/* SMART AI GAME LAB 공통 게임 SDK: 새 게임도 동일한 API로 기록을 올립니다. */
(() => {
  const KEY = 'smart-ai-game-lab-token-v1';
  let startPromise = null;
  const readToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const writeToken = value => { try { localStorage.setItem(KEY, value); } catch { /* 비공개 모드 */ } };
  const clearToken = () => { try { localStorage.removeItem(KEY); } catch {} };
  async function call(path, options = {}) {
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
    const token = readToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(path, { ...options, headers, cache: 'no-store' });
    let data;
    try { data = await response.json(); } catch { throw new Error('서버 응답을 읽지 못했습니다.'); }
    if (!response.ok) throw new Error(data.error || '서버 요청에 실패했습니다.');
    return data;
  }
  async function ensurePlayer(nickname) {
    if (readToken()) {
      try {
        const existing = await call('/api/me');
        if (existing.player.nickname !== nickname) {
          const updated = await call('/api/me', { method: 'PATCH', body: JSON.stringify({ nickname }) });
          return updated.player;
        }
        return existing.player;
      } catch (error) {
        if (error.message !== '로그인이 필요합니다.') throw error;
        clearToken();
      }
    }
    const result = await call('/api/players', { method: 'POST', body: JSON.stringify({ nickname }) });
    writeToken(result.token);
    return result.player;
  }
  function begin(game, mode, nickname) {
    startPromise = (async () => {
      await ensurePlayer(nickname);
      return call('/api/game/start', { method: 'POST', body: JSON.stringify({ game, mode }) });
    })();
    // 게임 플레이는 네트워크 오류에도 계속되도록 콜백에서 오류를 처리합니다.
    startPromise.catch(() => {});
    return startPromise;
  }
  async function finish(result, attempt = startPromise) {
    const session = await attempt;
    if (!session) throw new Error('온라인 게임 세션이 시작되지 않았습니다.');
    return call('/api/game/finish', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, ...result })
    });
  }
  async function ranking(game = 'ai-tower', mode = 'classic', period = 'all') {
    return call(`/api/rankings?game=${encodeURIComponent(game)}&mode=${encodeURIComponent(mode)}&period=${encodeURIComponent(period)}`);
  }
  window.SmartAILab = { begin, finish, ranking, ensurePlayer, call };
})();
