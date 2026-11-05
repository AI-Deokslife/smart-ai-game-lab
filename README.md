# SMART AI GAME LAB

**은평메디텍고등학교 스마트AI과** 모바일 게임 플랫폼 (1단계 MVP)

- 포털: `public/index.html` (모바일/PC 반응형)
- 게임 1: `public/games/ai-tower/index.html` (AI 타워 챌린지)
- 게임 2: `public/games/ai-rush/index.html` (AI 러시, A/D·모바일 터치, 자유/일일 도전)
- 게임 3: `public/games/ai-merge/index.html` (AI 몬스터 합체, 5×7 로봇 합체 퍼즐, 오프라인 연습·오늘의 퍼즐·공통 온라인 랭킹)
- 모든 게임이 사용할 SDK: `public/shared/lab-sdk.js`
- API: `src/index.js` (Cloudflare Workers)
- DB: `migrations/0001_init.sql`(기록), `0002_admin_login.sql`(관리자), `0003_game_catalog.sql`(게임 관리), `0004_score_nickname_snapshot.sql`(닉네임 보존), `0005_publish_ai_merge.sql`(3번째 게임 공개)
- 관리자: `public/admin/index.html` (통계·기록 관리·게임 등록·공개 상태·순서 변경)
- 닉네임 기반 **익명 참여** (학교/실명/연락처 수집 안 함)

현재 운영 저장소: https://github.com/AI-Deokslife/smart-ai-game-lab · 서비스: https://smart-ai-game-lab.deok.workers.dev

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

## AI 러시 조작 방식

AI 러시는 세로로 이어진 계단 경로를 따라 오르는 게임입니다.

- **A / 왼쪽 버튼: 방향 전환** — 지금 바라보는 방향을 반대로 바꾸면서 한 계단 오릅니다.
- **D / 오른쪽 버튼: 오르기** — 지금 바라보는 방향으로 한 계단 오릅니다.
- 계단이 같은 방향으로 이어지면 D, 꺾이는 지점에서는 A를 누르세요.
- 모바일은 두 개의 큰 터치 버튼, PC는 A/D 또는 왼쪽/오른쪽 방향키를 지원합니다.
- 기존 점수, 익명 닉네임, 두 게임 모드 및 온라인 랭킹은 유지됩니다.

## 기존 게임 이식하기

직접 제작한 단일 HTML 게임이나 HTML/CSS/JS 프로젝트도 이식할 수 있습니다.

1. 게임 소스 파일을 확인해 외부 경로와 종속 라이브러리를 정리합니다.
2. GitHub `public/games/게임ID/`에 `index.html`, 스크립트, 이미지, 사운드를 업로드합니다.
3. 게임이 `/games/게임ID/`에서 제대로 작동하는지 먼저 확인합니다.
4. 관리자 페이지 **게임 관리** 메뉴에서 동일한 게임 ID로 메타데이터를 등록하고 공개합니다.
5. 온라인 랭킹을 사용할 경우 `/shared/lab-sdk.js`와 게임별 **서버 점수 검증 로직**을 추가합니다.

원본 HTML 게임 파일만 있으면 **플레이 기능을 옮기는 것은 가능**하지만, 외부 서버가 필요한 2인용 대전·채팅·실시간 동기화 게임은 원래 백엔드와의 호환성 및 Cloudflare Workers/Durable Objects 연동을 따로 점검해야 합니다.

## 랭킹과 닉네임 보존

- **모든 기록**: 해당 게임에 등록된 점수를 높은 순서대로 최대 20개까지 표시합니다. 같은 사람이 여러 번 플레이한 기록도 보입니다.
- **참가자별 최고**: 참가자 ID별 최고 점수 1개만 표시합니다.
- **닉네임 변경**: 같은 브라우저에서 새로운 닉네임으로 플레이하면 별도의 익명 참가자 프로필이 생깁니다. 이전 닉네임을 다시 선택하면 브라우저에 저장된 이전 프로필을 재사용합니다.
- **점수 이름 고정**: 신규 점수에는 당시 닉네임이 함께 저장되므로 이후 참가자 이름이 바뀌어도 기록 당시 이름을 유지합니다.
- **기존 데이터 보존**: `migrations/0004_score_nickname_snapshot.sql`은 이전 점수에 현재 DB의 닉네임을 넣고 기록 자체는 유지합니다. 과거에 덮어쓴 원래 닉네임은 이전 시스템에서 저장하지 않았기 때문에 재구성할 수 없습니다.
- 닉네임은 본인 인증 수단이 아닙니다. **공용 PC에서 브라우저를 공동 사용하면 저장된 프로필도 공유될 수 있습니다.** 익명 학습 게임 운영용이며, 대회 보상이나 공식 참가자 구분에는 별도의 인증이 필요합니다.

## AI 몬스터 합체 · 세 번째 게임

게임 주소: https://smart-ai-game-lab.deok.workers.dev/games/ai-merge/

- 5열 × 7행 로봇 퍼즐. 같은 레벨의 로봇 두 개가 붙으면 하나의 상위 로봇으로 합체합니다.
- 아래쪽으로 로봇이 떨어지고 여러 합체가 자동으로 연쇄됩니다. 최대 레벨은 9입니다.
- 모바일은 원하는 열을 바로 탭하거나 왼쪽·낙하·오른쪽 버튼을 사용합니다. PC는 A/D·방향키·스페이스를 지원합니다.
- 자유 합체: 최대 160회. 오늘의 퍼즐: 35회, 한국 날짜를 기준으로 모두 같은 로봇 순서가 배정됩니다.
- `public/games/ai-merge/engine.js`는 브라우저·Worker가 함께 사용하는 순수 JavaScript 규칙 엔진입니다.
- 클라이언트가 게임을 시작하면 세션 ID 또는 오늘 날짜를 씨앗으로 결정합니다. 게임 종료 시 열 선택 기록을 서버에 제출합니다.
- 서버는 모든 입력을 엔진으로 다시 실행하고 **점수·놓은 횟수·합체 횟수·연쇄 기록을 재검증**한 뒤 D1에 저장합니다. 점수를 임의로 바꿔 보내면 거부합니다.
- 서버 연결이 실패해도 게임은 로컬 연습으로 실행할 수 있으나 온라인 점수는 저장되지 않습니다.
- 랭킹은 모든 게임에서 **TOP 10**까지만 표시합니다. 게임별·모드별 분리, 참가자 최고/전체 기록을 지원합니다.
- 기존 학생 닉네임, AI 타워·AI 러시 점수, 관리자 비밀번호는 그대로 보존합니다.

## 게임 관리 메뉴와 새 게임 등록

**관리자 페이지:** https://smart-ai-game-lab.deok.workers.dev/admin/

관리자 로그인 후 **게임 관리** 메뉴를 선택합니다. 기존 게임의 제목·소개·공개 여부·표시 순서를 수정할 수 있으며, 새로운 게임의 메타데이터도 등록할 수 있습니다. 비공개로 바꿔도 기존 점수 데이터는 보존되고, 직접 주소로 접근하는 게임 화면도 차단됩니다.

새 게임을 게시하는 순서:

1. 개발한 게임을 `public/games/새게임ID/index.html` 폴더에 업로드하고 GitHub로 배포합니다.
2. 관리자 **게임 관리 → 새 게임 등록**에서 ID, 제목, 소개, 디자인, 순서를 입력합니다.
3. 게임 파일이 정상적으로 배포된 것을 확인한 뒤 공개 여부를 켜고 저장합니다.
4. `/api/games`의 DB 기반 목록과 메인 포털 카드가 자동 반영됩니다.
5. 해당 게임에서 온라인 랭킹을 사용하려면 `src/validation.js`에서 게임을 등록하고, `src/index.js`에 **게임 전용 서버 검증 함수**를 연결해야 합니다. 이를 구현하지 않은 게임은 파일만 실행되며 랭킹 등록은 제한됩니다.

AI 타워 및 AI 러시는 이미 점수 검증 API가 연결되어 있습니다. AI 러시 점수 공식은 `계단 수 × 100 + PERFECT 수 × 25`입니다. 기존 D1 `scores` 테이블에서 `game_id`로 기록을 분리하므로 DB를 추가로 만들 필요가 없습니다.

| URL/관리 메뉴 | 설명 |
|---|---|
| `GET /api/games` | 공개 게임 목록(등록·변경 즉시 반영) |
| `GET /api/admin/games` | 관리자 전체 게임 목록 |
| `POST /api/admin/games` | 새 게임 메타데이터 등록 |
| `PATCH /api/admin/games/:id` | 제목·설명·공개 여부·정렬 변경 |
| `/games/ai-rush/` | AI 러시 실행 |
| `/games/ai-tower/` | AI 타워 실행 |

게임 관리 API는 관리자 로그인 세션이 필요하며 변경 요청은 동일 출처 보호 헤더로 검증합니다. 파일 자체를 웹 관리자 화면에서 업로드하는 기능은 이 버전에 포함되지 않습니다.

## 운영 및 보안 주의사항

- **1차 버전은 MVP**입니다. 점수 상한·플레이 시간·세션 중복 사용을 확인하지만, 정교한 개발자 도구 조작까지 막는 서버 재연 검증은 포함하지 않습니다. 상품 지급을 위한 공식 대회 전에는 이벤트 모드·서버 재연 검증·접속 제한을 추가하세요.
- 같은 기기·브라우저에서 토큰을 이용해 재접속합니다. 기기 변경·브라우저 데이터 삭제 시 익명 참가자를 복구할 수 없습니다. 개인정보 최소화를 위한 설계입니다.
- 닉네임은 기본 문자 제한만 있습니다. 공개 행사에서는 별도 부적절한 닉네임 신고·차단 절차와 관리자가 필요합니다.
- 개인정보·이용 통계 고지, 만 14세 미만 대상 운영 기준, 보관 기간 및 삭제 정책은 실제 공개 전 학교 차원에서 정하세요.
- D1 데이터는 운영 시 백업·복구 절차를 마련하세요.
- `ADMIN_KEY`는 반드시 고난도 무작위 값으로 설정하고 GitHub에 올리지 마세요.
- 온라인 기록은 Cloudflare에 배포 및 D1 초기화 전까지 작동하지 않지만, AI 타워 게임 자체는 HTML 파일에서 플레이 가능합니다.

## 다음 단계

- 게임 관리 메뉴에서 대표 이미지 및 미리보기 편집
- 학교별 이벤트/QR코드/실시간 전광판
- 관리자 이벤트 생성 및 기간별 통계, 닉네임 관리, 레이트 리밋 강화
- AI 러시, AI 몬스터 합체 추가
- 리플레이 기반 서버 점수 검증, 부정 기록 탐지

© 은평메디텍고등학교 스마트AI과 — SMART AI GAME LAB
