const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('ko-KR');
async function json(url) {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '서버 연결 오류');
  return data;
}
async function loadStats() {
  try {
    const stats = await json('/api/stats');
    $('playerCount').textContent = fmt(stats.players);
    $('playCount').textContent = fmt(stats.plays);
    $('gameCount').textContent = fmt(stats.games);
  } catch {
    $('playerCount').textContent = '—';
    $('playCount').textContent = '—';
  }
}
async function loadRanking() {
  const list = $('rankingList'), mode = $('rankMode').value, period = $('rankPeriod').value;
  list.replaceChildren();
  const wait = document.createElement('li'); wait.className = 'empty-rank'; wait.textContent = '온라인 순위를 불러오는 중입니다.'; list.append(wait);
  try {
    const data = await json(`/api/rankings?game=ai-tower&mode=${encodeURIComponent(mode)}&period=${encodeURIComponent(period)}`);
    list.replaceChildren();
    if (!data.rankings.length) { const empty = document.createElement('li'); empty.className = 'empty-rank'; empty.textContent = '아직 기록이 없습니다. 첫 번째 주인공이 되어 보세요!'; list.append(empty); return; }
    for (const item of data.rankings) {
      const li = document.createElement('li');
      const rank = document.createElement('span'); rank.className = 'rank-number'; rank.textContent = item.rank;
      const name = document.createElement('span'); name.className = 'rank-name'; name.textContent = item.nickname;
      const score = document.createElement('span'); score.className = 'rank-score'; score.textContent = fmt(item.score) + '점';
      const floors = document.createElement('small'); floors.textContent = item.floors + '층'; score.append(floors);
      li.append(rank, name, score); list.append(li);
    }
    $('rankingNotice').textContent = `온라인 TOP ${data.rankings.length} · 플레이어별 최고 점수`;
  } catch {
    list.replaceChildren(); const fail = document.createElement('li'); fail.className = 'empty-rank';
    fail.textContent = '현재 온라인 랭킹에 연결할 수 없습니다. Cloudflare D1 연결 상태를 확인해주세요.'; list.append(fail);
    $('rankingNotice').textContent = '온라인 연결 대기 중';
  }
}
$('rankMode').addEventListener('change', loadRanking);
$('rankPeriod').addEventListener('change', loadRanking);
$('reloadRanking').addEventListener('click', loadRanking);
loadStats(); loadRanking();
