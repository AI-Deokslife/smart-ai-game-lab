# SMART AI GAME LAB

**은평메디텍고등학교 스마트AI과** 모바일 게임 플랫폼 (1단계 MVP)

- 포털: `public/index.html` (모바일/PC 반응형)
- 첫 번째 게임: `public/games/ai-tower/index.html` (기존 AI 타워 챌린지 이식)
- 모든 게임이 사용할 SDK: `public/shared/lab-sdk.js`
- API: `src/index.js` (Cloudflare Workers)
- DB: `migrations/0001_init.sql` (Cloudflare D1/SQLite)
- 관리자: `public/admin/index.html` (통계·최근 기록·기록 삭제)
- 닉네임 기반 **익명 참여** (학교/실명/연락처 수집 안 함)

> 이 ZIP은 **배포 가능한 소스코드**입니다. 실제 GitHub에 게시하거나 Cloudflare D1에 접속·배포한 상태는 아닙니다. 초기 `wrangler.jsonc`의 DB ID는 예시용 값이므로 **반드시 교체**하세요.

## A. 새 GitHub에 업로드하기

1. GitHub에서 새로운 빈 저장소 `smart-ai-game-lab` 생성 (권장: Private로 시작해 검수 후 공개)
2. 이 ZIP을 **압축 해제**합니다. GitHub 저장소의 **Add file → Upload files**에서 `README.md`, `public`, `src`, `migrations`, `tests`, `wrangler.jsonc`, `package.json`, `.gitignore` 등을 업로드합니다. ZIP 파일 자체만 업로드하면 배포되지 않습니다.
3. GitHub 계정에 Cloudflare의 Git 연동 권한을 부여할 수 있어야 합니다.

새 GitHub 계정을 만든 경우, ChatGPT에 연결된 GitHub가 과거 계정으로 남아 있을 수 있으니 설정에서 GitHub 연결 계정을 확인하세요.

## B. Cloudflare D1 만들기

Node.js 22 이상이 설치된 컴퓨터에서 터미널로 프로젝트 폴더를 열고 아래 명령을 순서대로 실행합니다.

```bash
npm install
npx wrangler login
npx wrangler d1 create smart-ai-game-lab
```

마지막 명령에 표시되는 실제 `database_id` (UUID)를 **`wrangler.jsonc`** 파일의 `d1_databases[0].database_id`에 복사합니다. `binding`은 정확히 **`DB`**로 유지하세요.

```bash
npm run db:remote
```

위 명령은 수동 DB 초기화가 필요한 경우에만 사용합니다. **GitHub 자동 배포의 `npm run deploy` 명령이 원격 마이그레이션을 먼저 적용하고 Worker를 배포하므로, 일반적인 최초 배포에서는 별도 실행하지 않아도 됩니다.**

## C. 관리자 로그인 설정 (최초 1회)

Cloudflare Workers의 **변수 및 비밀값(Secrets)**에 `ADMIN_KEY`를 등록합니다. 기존에 설정한 키가 있다면 그대로 둘 수 있습니다. 신규 설치에서는 충분히 긴 무작위 Secret을 권장합니다.

**배포 후 관리자 페이지** `/admin/`에 접속하면 처음 한 번 다음을 입력합니다.

1. Cloudflare에 설정된 기존 `ADMIN_KEY` (최초 등록 확인용)
2. 앞으로 로그인에 사용할 비밀번호 **영문·숫자 포함 8~64자**
3. 새 비밀번호 확인

최초 설정 후에는 **Cloudflare ADMIN_KEY를 매번 입력하지 않고**, 새 비밀번호로 로그인합니다. 관리자 화면의 **비밀번호 변경** 버튼으로 언제든 변경할 수 있습니다.

- 비밀번호는 D1에 **salt + PBKDF2 해시**로 저장됩니다. 평문 비밀번호는 서버 DB에 남기지 않습니다.
- 관리자 로그인 세션은 HttpOnly/Secure/SameSite=Strict 쿠키를 사용하고 **8시간 후 만료**됩니다.
- 한 접속처에서 5회 연속 틀리면 15분 제한됩니다.
- 비밀번호 변경 시 다른 관리자 로그인 세션은 해제됩니다.
- 비밀번호를 잊어버렸다면 Cloudflare D1 콘솔에서 관리자 계정 테이블만 초기화해 다시 설정할 수 있습니다. 해당 관리자 외에는 수행하지 마세요:

```sql
DELETE FROM admin_sessions;
DELETE FROM admin_settings;
```

위 명령은 **학생 점수/플레이 데이터에 영향을 주지 않습니다.** 초기화 후 기존 Cloudflare `ADMIN_KEY`로 다시 첫 설정 화면을 진행합니다. `ADMIN_KEY` 자체를 잊었다면 Cloudflare에서 Secret을 새 값으로 수정하여 재배포하세요.

중요: `ADMIN_KEY` 및 관리자 비밀번호를 GitHub, 코드, 채팅에 올리지 마세요.

## D. GitHub → Cloudflare 자동 배포

1. Cloudflare 대시보드 → **Workers & Pages → Create application**으로 이동합니다.
2. **GitHub**를 선택하고 새 저장소 `smart-ai-game-lab`을 연결합니다.
3. Worker 이름을 설정 파일의 이름과 동일하게 **`smart-ai-game-lab`**으로 맞춥니다.
4. Root directory = 저장소 루트, Build command = 비워둠(기본값), **Deploy command = `npm run deploy`** 로 설정합니다. 이 명령은 원격 D1 마이그레이션 후 Worker를 배포합니다.
5. `wrangler.jsonc`에 실제 D1 `database_id`가 커밋되었는지 확인합니다. `npm run deploy` 실행 과정에서 원격 마이그레이션이 수행됩니다.
6. **Save and Deploy** 후 제공되는 `*.workers.dev` 주소로 접속합니다.
7. GitHub `main` 브랜치로 새 커밋을 Push하면 이후 자동 배포됩니다.

Cloudflare 공식 안내: https://developers.cloudflare.com/workers/ci-cd/builds/ 

**관리자 Secret 주의:** 최초 관리자 비밀번호 등록에만 `ADMIN_KEY`가 필요합니다. 웹사이트에서 비밀번호를 설정한 뒤에는 일반 비밀번호로 로그인하며, Secret은 서버에 보관합니다.

## E. 로컬 실행 및 자동 테스트

```bash
npm install
npm run db:local
npm run dev
```

터미널에서 표시된 로컬 주소(일반적으로 `http://localhost:8787`)로 접속합니다. D1 로컬 데이터는 서버와 별개입니다.

```bash
npm test
```

## API 목록

| 메서드 | 경로 | 역할 |
|---|---|---|
| GET | `/api/health` | 서비스 확인 |
| GET | `/api/games` | 게임 카탈로그 |
| GET | `/api/stats` | 공개 요약 통계 |
| POST | `/api/players` | 익명 참가자 생성 |
| GET/PATCH | `/api/me` | 본인 정보 조회/닉네임 수정 |
| POST | `/api/game/start` | 인증된 게임 세션 생성 |
| POST | `/api/game/finish` | 게임 기록 검증·저장 |
| GET | `/api/rankings?game=ai-tower&mode=classic&period=all` | 게임별 랭킹 |
| GET | `/api/admin/auth/status` | 관리자 비밀번호 설정 여부 및 로그인 상태 |\n| POST | `/api/admin/auth/setup` | 최초 관리자 비밀번호 등록 |\n| POST | `/api/admin/auth/login` | 관리자 로그인 |\n| POST | `/api/admin/auth/logout` | 관리자 로그아웃 |\n| POST | `/api/admin/auth/change-password` | 관리자 비밀번호 변경 |\n| GET | `/api/admin/summary` | 관리자 통계 |
| GET | `/api/admin/scores` | 최근 점수 100개 |
| DELETE | `/api/admin/scores/:id` | 비정상 기록 삭제 |

인증된 참가자는 `Authorization: Bearer <token>` 헤더로 호출합니다. 관리자 API는 로그인 후 발급되는 **HttpOnly 관리자 세션 쿠키**를 사용합니다. `X-Admin-Key` 헤더 인증은 지원하지 않습니다.

## 새 게임 등록 방법

1. `public/games/새게임/` 폴더에 HTML·JS·이미지 등을 추가합니다.
2. `src/validation.js` 의 `GAMES`에 카드 정보를 추가하고 `live: true`로 설정합니다.
3. 각 게임에서 `/shared/lab-sdk.js` 로드 후 `SmartAILab.begin(gameId, mode, nickname)`으로 세션을 시작하고, 종료 시 `SmartAILab.finish(record)`로 제출합니다.
4. `src/index.js`의 `/api/game/finish`에 **새 게임만의 서버 점수 검증 함수**를 작성합니다. 다른 게임 결과를 검증 없이 받으면 안 됩니다.
5. 포털 `public/index.html`에 게임 카드를 추가합니다. 현재 포털 카드 배열은 첫 단계이므로 수동 카드 추가 방식입니다.

## 운영 및 보안 주의사항

- **1차 버전은 MVP**입니다. 점수 상한·플레이 시간·세션 중복 사용을 확인하지만, 정교한 개발자 도구 조작까지 막는 서버 재연 검증은 포함하지 않습니다. 상품 지급을 위한 공식 대회 전에는 이벤트 모드·서버 재연 검증·접속 제한을 추가하세요.
- 같은 기기·브라우저에서 토큰을 이용해 재접속합니다. 기기 변경·브라우저 데이터 삭제 시 익명 참가자를 복구할 수 없습니다. 개인정보 최소화를 위한 설계입니다.
- 닉네임은 기본 문자 제한만 있습니다. 공개 행사에서는 별도 부적절한 닉네임 신고·차단 절차와 관리자가 필요합니다.
- 개인정보·이용 통계 고지, 만 14세 미만 대상 운영 기준, 보관 기간 및 삭제 정책은 실제 공개 전 학교 차원에서 정하세요.
- D1 데이터는 운영 시 백업·복구 절차를 마련하세요.
- `ADMIN_KEY`는 반드시 고난도 무작위 값으로 설정하고 GitHub에 올리지 마세요.
- 온라인 기록은 Cloudflare에 배포 및 D1 초기화 전까지 작동하지 않지만, AI 타워 게임 자체는 HTML 파일에서 플레이 가능합니다.

## 다음 단계

- 학교별 이벤트/QR코드/실시간 전광판
- 관리자 이벤트 생성 및 기간별 통계, 닉네임 관리, 레이트 리밋 강화
- AI 러시, AI 몬스터 합체 추가
- 리플레이 기반 서버 점수 검증, 부정 기록 탐지

© 은평메디텍고등학교 스마트AI과 — SMART AI GAME LAB
