/* SMART AI GAME LAB 공통 게임 SDK: 닉네임별 독립 프로필, 점수와 랭킹. */
(() => {
  const KEY='smart-ai-game-lab-token-v1'; // 기존 사용자 토큰 유지
  const PROFILES_KEY='smart-ai-game-lab-profiles-v1';
  let startPromise=null;
  const readToken=()=>{try{return localStorage.getItem(KEY);}catch{return null;}};
  const writeToken=value=>{try{localStorage.setItem(KEY,value);}catch{}};
  const clearToken=()=>{try{localStorage.removeItem(KEY);}catch{}};
  const profiles=()=>{
    try{
      const data=JSON.parse(localStorage.getItem(PROFILES_KEY)||'{}');
      return data&&typeof data==='object'&&!Array.isArray(data)?data:{};
    }catch{return {};}
  };
  const saveProfile=(nickname,token)=>{
    try{
      const saved=profiles();saved[nickname]=token;
      localStorage.setItem(PROFILES_KEY,JSON.stringify(saved));
    }catch{}
  };
  const forgetProfile=nickname=>{
    try{const saved=profiles();delete saved[nickname];localStorage.setItem(PROFILES_KEY,JSON.stringify(saved));}catch{}
  };
  const normalizeName=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ');
  async function call(path,options={}){
    const headers={...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};
    const token=readToken();
    if(token&&!headers.Authorization)headers.Authorization='Bearer '+token;
    const response=await fetch(path,{...options,headers,cache:'no-store'});
    let data;
    try{data=await response.json();}catch{throw new Error('서버 응답을 읽지 못했습니다.');}
    if(!response.ok)throw new Error(data.error||'서버 요청에 실패했습니다.');
    return data;
  }
  async function profileFor(token){
    if(!token||!(/^[0-9a-f]{64}$/.test(token)))return null;
    try{
      const result=await call('/api/me',{headers:{Authorization:'Bearer '+token}});
      return result.player;
    }catch(error){
      if(error.message==='로그인이 필요합니다.')return null;
      throw error;
    }
  }
  async function ensurePlayer(rawNickname){
    const nickname=normalizeName(rawNickname);
    // 예전 버전의 현재 토큰은 반드시 먼저 확인해 기존 기록을 유지합니다.
    const current=readToken();
    if(current){
      const player=await profileFor(current);
      if(player&&player.nickname===nickname){saveProfile(nickname,current);return player;}
      if(!player)clearToken();
    }
    // 닉네임마다 다른 익명 참가자 토큰을 사용합니다. 다른 이름으로 변경해도
    // 이전 플레이어의 닉네임이나 과거 점수를 수정하지 않습니다.
    const known=profiles()[nickname];
    if(known){
      const player=await profileFor(known);
      if(player&&player.nickname===nickname){writeToken(known);return player;}
      forgetProfile(nickname);
    }
    const created=await call('/api/players',{
      method:'POST',body:JSON.stringify({nickname}),
      // 위 조회 단계에서 사용했던 이전 사용자의 Authorization을 보내지 않습니다.
      headers:{Authorization:''}
    });
    writeToken(created.token);saveProfile(nickname,created.token);
    return created.player;
  }
  function begin(game,mode,nickname){
    startPromise=(async()=>{
      await ensurePlayer(nickname);
      const authToken=readToken();
      const session=await call('/api/game/start',{
        method:'POST',body:JSON.stringify({game,mode}),
        headers:{Authorization:'Bearer '+authToken}
      });
      return {...session,authToken};
    })();
    startPromise.catch(()=>{});
    return startPromise;
  }
  async function finish(result,attempt=startPromise){
    const session=await attempt;
    if(!session)throw new Error('온라인 게임 세션이 시작되지 않았습니다.');
    return call('/api/game/finish',{
      method:'POST',body:JSON.stringify({sessionId:session.sessionId,...result}),
      headers:{Authorization:'Bearer '+session.authToken}
    });
  }
  async function ranking(game='ai-tower',mode='classic',period='all',view='best'){
    return call('/api/rankings?game='+encodeURIComponent(game)+'&mode='+encodeURIComponent(mode)+
      '&period='+encodeURIComponent(period)+'&view='+encodeURIComponent(view));
  }
  window.SmartAILab={begin,finish,ranking,ensurePlayer,call};
})();
