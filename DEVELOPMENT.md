# Mass Stacker — 개발 기록

건물 대지 정보(대지면적·건폐율·용적률·층수 제한)를 JSON으로 입력하면 법정 최대 규모의
건축 매스를 Three.js로 자동 생성하고, 이후 자연어 채팅으로 매스 형태를 수정할 수 있는
프로토타입. LLM은 Gemini와 Anthropic(Claude) 중 선택해서 쓸 수 있다.

## 스택

- 프런트엔드: 순수 HTML/CSS/JS (빌드 도구 없음), Three.js (ES 모듈, import map으로 로드)
- 백엔드: Node.js + Express (`server.js`) — 정적 파일 서빙 + LLM API 프록시
- LLM: Gemini(`generateContent` + `responseSchema`), Anthropic(`messages` + forced tool use)
- API 키는 서버의 `.env`에만 있고 브라우저로 내려가지 않는다

## 실행

```bash
cp .env.example .env   # GEMINI_API_KEY / ANTHROPIC_API_KEY 채워 넣기
npm install
npm start               # http://localhost:8790
```

## 핵심 기능

### 1. 결정론적 매스 생성 (`generateMaxMassSpec`, app.js)

대지면적 × 건폐율로 최대 건축면적, 대지면적 × 용적률로 최대 연면적을 구하고,
층마다 최대 건축면적을 채우면서 최대 연면적에 도달할 때까지 쌓는다. 마지막 층은
남은 면적만큼만 채워(옥탑처럼 작아짐) 연면적 상한을 정확히 맞춘다. 치수는 항상
**내림 처리**해서 반올림으로 인해 법정 상한을 넘는 일이 없도록 했다.

### 2. 실시간 지표 + 표제란(titleblock)

건폐율/연면적/용적률/최고높이/층수는 고정된 공식이 아니라 **현재 매스 지오메트리에서
매번 다시 계산**한다(`computeValues`). 화면 하단 표제란에 값과 함께 이전 상태 대비
변화량(delta)이 표시되고, REV 카운터와 되돌리기(undo) 버튼으로 수정 이력을 관리한다.
법정 상한을 넘으면 값이 빨간색(pencil)으로 표시된다.

### 3. LLM 채팅 편집 — diff 기반 명령

층 전체를 매번 다시 받는 대신, LLM은 **변경 명령(changes) 목록**만 반환한다
(`resize`/`move`/`rotate`/`set_floor_height`/`set_use`/`add_floors`/`add_basement`/`delete_floors`).
언급되지 않은 층은 그대로 유지되어 왜곡·누락 위험이 줄어든다. 각 명령은 `floorStart`,
`floorEnd`, `reason`과 함께 실제 변경값을 담고, 안 쓰는 필드는 반드시 `null`로 채우게
스키마와 프롬프트에 강제했다(아래 버그 참고). 채팅 로그에는 층별 전/후 값과 변경 이유가
표로 표시된다.

### 4. 지상/지하층 구분

층 번호(level)가 양수면 지상층(1F, 2F…), 음수면 지하층(-1=B1, -2=B2…)이다. 지상층은
지면(y=0)에서 위로, 지하층은 지면에서 아래로 각각 쌓인다. `add_floors`는 항상 최상층
위에, `add_basement`는 항상 최하 지하층 아래에만 붙는다. 건폐율/용적률/최고높이/층수는
지상층 기준으로 계산되고(한국 건축법상 용적률 산정 시 지하층 면적 제외 관례를 반영),
지하층 수는 표제란 층수 셀에 "B2"처럼 별도 표기된다.

### 5. 층별 레이어 패널

3D 뷰어 오른쪽에 최상층부터 지하층까지 순서대로 각 층의 번호·치수·층고·용도를 보여주는
패널. 매스가 바뀔 때마다 실시간 갱신되고, 지하층은 왼쪽 테두리가 빨간색으로 구분된다.

### 6. LLM 콘솔

채팅 헤더의 "콘솔" 버튼을 누르면 화면 하단에서 실제로 Gemini/Anthropic API에 보낸
요청(프롬프트 전문 + JSON 스키마)과 받은 응답(원문 + 토큰 사용량)을 그대로 보여주는
디버그 패널이 열린다. API 키는 요청 URL 쿼리(Gemini)/헤더(Anthropic)에만 있고 이 로그의
JSON 바디에는 포함되지 않으므로 안전하게 노출된다.

### 7. 시점 프리셋 + 디자인 시스템

평면(90°) / 조감(60°) / 근경(28°) / 입면(0°) 카메라 프리셋 버튼과 드래그 회전·휠 줌.
UI는 참고 목업(`modelingLLM/`)의 "밤의 제도판(Night Drafting Table)" 다크 도면 디자인
시스템을 이식했다 — IBM Plex Mono/Sans KR, 청록(시스템·활성)/빨강(변경·경고)/크림(확정값)
3색 역할 분리, 각진 모서리, 그림자 대신 1px 선, 표제란을 이 화면의 "서명 요소"로 사용.

## 파일 구조

| 파일 | 역할 |
|---|---|
| `index.html` | 페이지 구조 (좌측 설정/입력, 중앙 뷰포트+표제란, 우측 채팅) |
| `app.js` | Three.js 렌더링, 매스 생성/편집 로직, 지표 계산, UI 상태 관리 |
| `server.js` | Express 정적 서버 + Gemini/Anthropic 프록시, 프롬프트/스키마 정의 |
| `style.css` | 디자인 시스템 (다크 테마, 표제란, 레이어 패널, 콘솔 등) |
| `samples.js` | 테스트용 대지 정보 예시 5종 |
| `.env.example` | 필요한 환경변수 목록 (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY` 등) |

## 개발 중 발견하고 고친 버그

1. **OrbitControls 모듈 로드 실패** — three.js 예제 모듈이 bare specifier `'three'`를
   import하는데 import map이 없어서 발생. `index.html`에 import map 추가로 해결.
2. **매스 생성 시 법정 상한 근소 초과** — 폭/깊이를 반올림하면서 목표 면적을 살짝
   넘는 문제. 치수를 내림 처리하도록 수정.
3. **LLM이 "안 쓰는 필드"에 0을 채워 넣는 문제** — 스키마에서 선택 필드를 옵션으로만
   두면 일부 모델이 생략 대신 0/빈 문자열을 채워 넣어, 예를 들어 폭을 0으로 지웠다가
   최소값(3m)으로 clamp되는 사고가 났다. 모든 필드를 `required + nullable`로 강제하고
   "0 대신 반드시 null"이라고 프롬프트에 명시해 해결.
4. **Gemini 응답이 가끔 빈 텍스트로 옴** — reasoning에 토큰을 다 쓰고 최종 JSON을
   못 내는 경우가 있어 `maxOutputTokens`를 8192로 넉넉히 설정.
5. **지하층 추가가 최상층에 붙는 버그** — 프롬프트가 "새 층은 항상 최상층 위에"로만
   규정돼 있어 지하 개념이 없었다. 지상/지하 액션을 분리(`add_floors`/`add_basement`)하고
   층 번호 부호로 지상/지하를 구분하도록 재설계.
6. **콘솔 버튼과 채팅 전송 버튼 겹침** — 콘솔 토글 버튼을 화면 우하단에 고정 배치했더니
   채팅창의 "보내기" 버튼과 겹쳐 클릭 오작동. 채팅 헤더 안으로 위치를 옮겨 해결.
7. **Claude 응답에 tool-call 포맷 잔재(`</explanation>`, `</invoke>`) 노출** — 서버에서
   사람이 읽는 텍스트 필드(interpretation/explanation/reason/use)에서 태그처럼 생긴
   조각을 제거하는 sanitizer 추가.
8. **CSS 배경 그리드와 Three.js 바닥 그리드 중복 표시** — 뷰포트의 고정 CSS 격자 배경을
   제거하고 카메라와 함께 움직이는 Three.js `GridHelper`만 남김.

## 포팅하지 않은 것 (참고 목업 대비)

목업(`modelingLLM/massing-studio-demo.html`)에 있던 "대안 4개 동시 생성(Conservative/
Balanced/Aggressive/Sculptural 픽커)"과 온톨로지 그래프 애니메이션은 이번 범위(매스
변형에 따른 실시간 값 반영)의 핵심이 아니라 제외했다.
