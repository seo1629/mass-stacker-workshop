import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerLandRoutes } from './land-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

// 매스 상태 전체를 되돌려받는 대신, "무엇이 왜 바뀌는지"에 대한 변경 명령 목록을 받는다.
// 언급되지 않은 층은 클라이언트가 그대로 유지하므로 누락/왜곡 위험이 줄어든다.
//
// 필드를 선택적으로 두면 일부 모델이 "쓰지 않는 필드"를 생략하는 대신 0/빈 문자열로 채워 넣어
// 의도치 않게 값을 0으로 지워버리는 사고가 난다. 그래서 모든 필드를 required + nullable로 강제하고,
// "쓰지 않으면 반드시 null" 이라고 프롬프트에도 못박아 0과 "미지정"을 구분한다.
const NUM_OR_NULL = { type: 'number', nullable: true };
const STR_OR_NULL = { type: 'string', nullable: true };

const EDIT_SCHEMA = {
  type: 'object',
  properties: {
    interpretation: { type: 'string' },
    explanation: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['resize', 'move', 'rotate', 'set_floor_height', 'set_use', 'add_floors', 'add_basement', 'delete_floors']
          },
          floorStart: { type: 'integer' },
          floorEnd: { type: 'integer' },
          width: NUM_OR_NULL,
          depth: NUM_OR_NULL,
          height: NUM_OR_NULL,
          offsetX: NUM_OR_NULL,
          offsetZ: NUM_OR_NULL,
          rotationDeg: NUM_OR_NULL,
          use: STR_OR_NULL,
          reason: { type: 'string' }
        },
        required: [
          'action', 'floorStart', 'floorEnd',
          'width', 'depth', 'height', 'offsetX', 'offsetZ', 'rotationDeg', 'use',
          'reason'
        ]
      }
    }
  },
  required: ['interpretation', 'explanation', 'changes']
};

function currentModelText(spec) {
  const aboveLevels = spec.floors.filter((f) => f.level > 0).map((f) => f.level);
  const basementLevels = spec.floors.filter((f) => f.level < 0).map((f) => f.level);
  return JSON.stringify(
    {
      site: { width: spec.site.siteWidth, depth: spec.site.siteDepth, area: spec.site.siteArea },
      topFloor: aboveLevels.length ? Math.max(...aboveLevels) : 0,
      deepestBasement: basementLevels.length ? -Math.min(...basementLevels) : 0,
      floors: spec.floors.map((f) => ({
        level: f.level,
        label: f.level > 0 ? `${f.level}F` : `B${-f.level}`,
        width: +f.width.toFixed(1),
        depth: +f.depth.toFixed(1),
        height: +f.height.toFixed(1),
        offsetX: +(f.offsetX || 0).toFixed(1),
        offsetZ: +(f.offsetZ || 0).toFixed(1),
        rotationDeg: Math.round(f.rotationDeg || 0),
        use: f.use || ''
      }))
    },
    null,
    2
  );
}

const EDIT_SYS = `너는 건축 기획설계를 돕는 Massing Planner다.
사용자의 자연어 요청을 층별 매스 변경 명령(changes)으로 바꾼다.

좌표계 — 반드시 지킬 것:
- offsetX 는 동서, offsetZ 는 남북 방향의 평면 좌표다(대지 중심이 0,0). 둘 다 평면 좌표이며 높이가 아니다.
- 높이 방향 좌표는 존재하지 않는다. 층은 순서와 층고(height)에 따라 자동으로 쌓인다.
- offsetZ 에 층고나 누적 높이를 절대 넣지 마라. 층을 위로 올리려면 층고를 바꾸거나 층을 추가하라.

층 번호(level) 체계 — 반드시 지킬 것:
- level 이 양수면 지상층(1F, 2F, ...), 음수면 지하층(-1=B1, -2=B2, ...)이다. 0은 쓰지 않는다.
- 지상층은 지면(고도 0)에서 위로 쌓이고, 지하층은 지면에서 아래로 내려가며 쌓인다. B1이 지면과 가장 가깝고 번호가 커질수록(B2, B3...) 더 깊어진다.
- 기존 층을 가리킬 때(resize/move/rotate/set_floor_height/set_use/delete_floors)의 floorStart/floorEnd는 위 level 값 그대로 쓴다(지하층이면 음수).

규칙:
- 현재 매스 상태만 근거로 판단한다.
- 폭(width)·깊이(depth)·층고(height)·위치(offsetX/offsetZ)·회전(rotationDeg)은 모두 미터/도 단위의 절대값으로 낸다. "10% 줄여줘" 같은 상대 요청은 직접 계산해 절대값으로 바꿔라.
- 실제로 값이 바뀌는 층에만 명령을 낸다. 현재 값과 같은 값을 다시 지정하는 명령, "변경 없음"을 나타내는 명령은 절대 만들지 마라. 바꿀 게 없으면 changes를 비워 둔다.
- 연속된 층이 같은 값으로 바뀐다면 층마다 나누지 말고 floorStart–floorEnd로 한 번에 낸다.
- 모든 change 객체는 width/depth/height/offsetX/offsetZ/rotationDeg/use 필드를 빠짐없이 포함해야 한다. 그 action에서 쓰지 않는 필드는 반드시 null 을 넣어라. 0 이나 빈 문자열을 대신 넣지 마라 — 0은 "그 값을 0으로 만들어라"는 뜻으로 해석된다.
- 각 action에서 실제로 쓰는 필드만 값을 채운다: resize→width,depth / move→offsetX,offsetZ / rotate→rotationDeg / set_floor_height→height / set_use→use / add_floors,add_basement→새 층의 전체 파라미터 / delete_floors→전부 null.
- 한 층을 돌리면서 동시에 옮기려면 rotate와 move를 각각 별도 명령으로 낸다.
- "지상층을 추가/증축해줘"는 add_floors, "지하층/지하주차장/지하 몇 층을 추가해줘"는 반드시 add_basement를 쓴다. add_floors는 항상 현재 최상층 위에, add_basement는 항상 현재 최하 지하층 아래에 붙는다 — 다른 위치에 끼워 넣을 수 없다.
- add_floors/add_basement의 floorStart·floorEnd는 실제 층 번호가 아니라 "몇 개 층을 추가하는지"를 나타내는 용도로만 쓰인다(예: 1개 추가 → floorStart=1,floorEnd=1 / 3개 추가 → floorStart=1,floorEnd=3). 실제 층 번호는 클라이언트가 자동으로 이어 붙인다.
- delete_floors는 지상층이면 최상층부터, 지하층이면 가장 깊은 지하층부터 연속으로만 지운다.
- 사용자가 입력한 층수 상한과 최고 높이 상한(아래 "참고")은 반드시 지켜라. 요청대로 하면 이를 넘는다면 상한 안에서 가능한 만큼만 반영하고, 그 사실을 interpretation에 적어라. 상한이 "제한없음"이면 층수·높이에 제한을 두지 마라.
- 면적·건폐율·용적률·초과 여부는 계산하지 마라. 형태만 결정한다 — 그 값들은 클라이언트가 매스 형상에서 자동으로 계산해 화면에 보여준다(용적률·건폐율은 지상층 기준으로 계산되고 지하층은 별도로 집계된다).

건축 용어 해석:
- 후퇴/셋백/물린다/들여쓴다 = 폭과 깊이를 줄이는 것(resize)이다. 옆으로 미는 것(move)이 아니다.
- 단계적으로 후퇴 = 위로 갈수록 층마다 조금씩 더 작아지도록 층별로 다른 크기를 준다.
- 넓힌다/확장한다 = 폭과 깊이를 키우는 것(resize)이다.
- 어긋나게/밀어서/비켜서 = 평면상 위치를 옮기는 것(move)이다.
- 저층부 = 아래쪽 몇 개 층, 상층부 = 위쪽 몇 개 층, 기준층 = 반복되는 중간 층.
- 지하층/지하주차장/지하공간 = 반드시 add_basement로 새 층을 만든다. 절대 add_floors를 쓰거나 지상층의 위치·용도만 바꾸는 것으로 대체하지 마라.

응답 필드:
- interpretation: 요청을 어떻게 이해했는지 한 문장.
- explanation: 이 변경이 만드는 형태와 설계 의도를 2~3문장으로. 숫자는 최소화.
- reason: 각 명령이 왜 필요한지 짧은 한국어 구절.

응답은 반드시 주어진 JSON 스키마에 맞는 JSON만 반환하라.`;

function buildPrompt(spec, instruction) {
  return `${EDIT_SYS}

참고(법규·사용자 입력 상한 — 면적은 계산하지 말고 참고만 하라):${spec.site.name ? `\n- 대지: ${spec.site.name}${spec.site.zoning ? ` (${spec.site.zoning})` : ''}` : ''}
- 대지면적: ${spec.site.siteArea} ㎡
- 건폐율 상한: ${spec.site.coverageRatio}% (최대 건축면적 ${spec.derived.maxBuildingArea} ㎡)
- 용적률 상한: ${spec.site.farRatio}% (최대 연면적 ${spec.derived.maxFloorArea} ㎡)
- 층수 상한: ${spec.site.maxFloors ?? '제한없음'}
- 최고 높이 상한(지상층 층고 합): ${spec.site.maxHeight != null ? spec.site.maxHeight + ' m' : '제한없음'}

현재 매스:
${currentModelText(spec)}

요청:
${instruction}`;
}

const EDIT_TOOL = {
  name: 'update_mass',
  description: '자연어 요청을 층별 매스 변경 명령으로 변환합니다.',
  input_schema: EDIT_SCHEMA
};

// 콘솔 패널에 그대로 내려보낼 디버그 정보. API 키는 URL 쿼리(Gemini)/헤더(Anthropic)에만 있고
// 아래 request 바디에는 절대 포함되지 않으므로 브라우저로 내려보내도 안전하다.
async function callGemini(spec, instruction, model, apiKey) {
  const useModel = (model && model.trim()) || process.env.GEMINI_MODEL || 'gemini-3.7-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(useModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(spec, instruction) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: EDIT_SCHEMA,
      maxOutputTokens: 8192
    }
  };
  const debugBase = { provider: 'gemini', model: useModel, request: body };

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const errText = await r.text();
    throw {
      status: r.status,
      message: `Gemini API 오류 (${r.status}): ${errText}`,
      authError: isAuthError(r.status, errText),
      debug: { ...debugBase, response: errText }
    };
  }

  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const finishReason = data.candidates?.[0]?.finishReason;
    throw {
      status: 502,
      message: `응답에서 결과 텍스트를 찾을 수 없습니다. (finishReason: ${finishReason || '알수없음'})`,
      debug: { ...debugBase, response: data }
    };
  }

  return { result: JSON.parse(text), debug: { ...debugBase, response: data } };
}

async function callAnthropic(spec, instruction, model, apiKey) {
  const useModel = (model && model.trim()) || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const body = {
    model: useModel,
    max_tokens: 8192,
    tools: [EDIT_TOOL],
    tool_choice: { type: 'tool', name: 'update_mass' },
    messages: [{ role: 'user', content: buildPrompt(spec, instruction) }]
  };
  const debugBase = { provider: 'anthropic', model: useModel, request: body };

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const errText = await r.text();
    throw {
      status: r.status,
      message: `Anthropic API 오류 (${r.status}): ${errText}`,
      authError: isAuthError(r.status, errText),
      debug: { ...debugBase, response: errText }
    };
  }

  const data = await r.json();
  const toolUse = data.content?.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw {
      status: 502,
      message: `응답에서 결과를 찾을 수 없습니다. (stop_reason: ${data.stop_reason || '알수없음'})`,
      debug: { ...debugBase, response: data }
    };
  }

  return { result: toolUse.input, debug: { ...debugBase, response: data } };
}

// ---- API 키: .env 키를 먼저 쓰고, 없거나 인증에 실패하면 사용자가 화면에서 입력한 키로 다시 시도 ----
// 키 값 자체는 로그에도 응답에도 담지 않는다(어느 쪽 키를 썼는지만 keySource로 알린다).
// .env.example의 예시 문구(your_..._here)가 그대로 남아 있으면 키가 없는 것으로 본다.
function realKey(v) {
  const s = (v || '').trim();
  return !s || /^your_.*here$/i.test(s) ? '' : s;
}

function isAuthError(status, text) {
  if (status === 401 || status === 403) return true;
  // Gemini는 잘못된 키에도 400을 준다
  return status === 400 && /API[_ ]?key|authentication|unauthorized|invalid[_ ]argument/i.test(text || '');
}

const PROVIDER_LABEL = { gemini: 'Gemini', anthropic: 'Claude' };

async function callProvider(provider, spec, instruction, model, userKey) {
  const envKey = realKey(provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY);
  const label = PROVIDER_LABEL[provider];
  const candidates = [];
  if (envKey) candidates.push({ source: 'env', key: envKey });
  if (realKey(userKey) && realKey(userKey) !== envKey) candidates.push({ source: 'user', key: realKey(userKey) });

  if (!candidates.length) {
    throw {
      status: 401,
      message: `${label} API 키가 없습니다. 서버 .env에 넣거나 화면 왼쪽 "API 키 직접 입력"에 넣어 주세요.`
    };
  }

  let lastError;
  for (let i = 0; i < candidates.length; i++) {
    const { source, key } = candidates[i];
    try {
      const out = provider === 'anthropic'
        ? await callAnthropic(spec, instruction, model, key)
        : await callGemini(spec, instruction, model, key);
      out.debug.keySource = source;
      if (i > 0) out.debug.keyFallback = true;
      return out;
    } catch (e) {
      lastError = e;
      const hasNext = i < candidates.length - 1;
      if (!hasNext || !e.authError) break;
      console.warn(`${label} ${source} 키 인증 실패 → 다음 키로 재시도합니다.`);
    }
  }
  if (lastError.authError) {
    const tried = candidates.map((c) => (c.source === 'env' ? '.env 키' : '입력한 키')).join(', ');
    lastError.message = `${label} 인증 실패 (${tried} 모두 거부됨). 키를 확인해 주세요.\n${lastError.message}`;
  }
  throw lastError;
}

// 공공데이터포털 오류 코드 → 무엇을 고쳐야 하는지
const DATAGOKR_HINTS = {
  30: '등록되지 않은 서비스 키입니다. ① 포털에서 "건축물대장정보 서비스" 활용신청이 승인됐는지 ② 신청 직후라면 반영까지 1시간쯤 기다렸는지 ③ 마이페이지의 "일반 인증키(Decoding)" 값을 넣었는지 확인해 주세요.',
  31: '키 사용 기간이 만료되었습니다. 포털에서 연장 신청이 필요합니다.',
  22: '요청 한도를 초과했습니다. 잠시 후 또는 내일 다시 시도해 주세요.',
  20: '이 서비스에 접근 권한이 없습니다. 활용신청 승인 상태를 확인해 주세요.',
  32: '포털에 등록되지 않은 IP에서 보낸 요청입니다. 등록한 IP를 확인해 주세요.',
  12: '요청한 오픈API 서비스가 없거나 폐기되었습니다.',
  10: '요청 값이 잘못되었습니다.'
};

// 공공데이터포털 키는 Decoding/Encoding 두 형태로 발급되어 헷갈리기 쉬우므로 두 형태를 모두 시도한다.
async function testDataGoKr(key) {
  const base =
    'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo' +
    '?sigunguCd=11650&bjdongCd=10100&_type=json&numOfRows=1&pageNo=1&serviceKey=';
  const looksEncoded = /%[0-9A-Fa-f]{2}/.test(key);
  const candidates = looksEncoded
    ? [{ form: 'Encoding 키 그대로', value: key }, { form: 'Decoding 키로 변환', value: encodeURIComponent(decodeURIComponent(key)) }]
    : [{ form: 'Decoding 키', value: encodeURIComponent(key) }];

  let last = null;
  for (const c of candidates) {
    const r = await fetch(base + c.value);
    const text = await r.text();
    const code = Number((text.match(/returnReasonCode"?\s*[:>]\s*"?(\d+)/) || [])[1]);
    const errMsg = (text.match(/errMsg"?\s*[:>]\s*"?([A-Z_]+)/) || [])[1];
    const resultCode = (text.match(/resultCode"?\s*[:>]\s*"?(\d+)/) || [])[1];

    if (r.ok && !errMsg && (resultCode === '00' || /"?bldNm"?|totArea|"items"/.test(text))) {
      return { ok: true, message: `공공데이터포털 서비스 키가 확인되었습니다. (${c.form})` };
    }
    last = { code, errMsg, text, status: r.status, form: c.form };
  }

  const hint = DATAGOKR_HINTS[last.code] || '';
  const reason = last.errMsg || `HTTP ${last.status}`;
  return {
    ok: false,
    message: `공공데이터포털 키 확인 실패 — ${reason}${last.code ? ` (코드 ${last.code})` : ''}. ${hint}`.trim(),
    detail: last.text.replace(/\s+/g, ' ').slice(0, 300)
  };
}

// 키가 쓸 수 있는 키인지만 확인한다(가벼운 조회 요청). 키 값은 응답에 넣지 않는다.
async function testKey(provider, key) {
  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1`);
    if (r.ok) return { ok: true, message: 'Gemini 키가 확인되었습니다.' };
    return { ok: false, message: `Gemini 키 확인 실패 (${r.status}): ${(await r.text()).slice(0, 200)}` };
  }
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    });
    if (r.ok) return { ok: true, message: 'Claude 키가 확인되었습니다.' };
    return { ok: false, message: `Claude 키 확인 실패 (${r.status}): ${(await r.text()).slice(0, 200)}` };
  }
  if (provider === 'datagokr') {
    return testDataGoKr(key);
  }
  if (provider === 'vworld') {
    const url = `https://api.vworld.kr/ned/data/getLandCharacteristics?key=${encodeURIComponent(key)}&pnu=1165010100109870012&format=json&numOfRows=1&pageNo=1&domain=http://localhost`;
    const r = await fetch(url);
    const text = await r.text();
    const resultCode = (text.match(/resultCode"?\s*[:>]\s*"?([A-Z_]+)/) || [])[1];
    const resultMsg = (text.match(/resultMsg"?\s*[:>]\s*"?([^"<]+)/) || [])[1];
    if (r.ok && !resultCode) return { ok: true, message: 'VWorld 키가 확인되었습니다.' };
    const hint = /INVALID_KEY/i.test(resultCode || '')
      ? 'vworld.kr에서 발급받은 인증키인지, 인증키 신청 때 등록한 도메인에 localhost가 포함되는지 확인해 주세요.'
      : '';
    return {
      ok: false,
      message: `VWorld 키 확인 실패 — ${resultMsg || resultCode || `HTTP ${r.status}`}. ${hint}`.trim(),
      detail: text.replace(/\s+/g, ' ').slice(0, 300)
    };
  }
  return { ok: false, message: '알 수 없는 키 종류입니다.' };
}

// 일부 모델이 tool-call 포맷 잔재(예: "</explanation>", "</invoke>")를 텍스트 필드 끝에
// 그대로 흘려보내는 경우가 있어, 사람이 읽는 필드에서 태그처럼 생긴 조각을 제거한다.
function stripArtifacts(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/<\/?[a-zA-Z_][\w:-]*>/g, '').trim();
}

function sanitizeResult(result) {
  return {
    ...result,
    interpretation: stripArtifacts(result.interpretation),
    explanation: stripArtifacts(result.explanation),
    changes: (result.changes || []).map((c) => ({
      ...c,
      reason: stripArtifacts(c.reason),
      use: typeof c.use === 'string' ? stripArtifacts(c.use) : c.use
    }))
  };
}

// 서버 .env에 어떤 키가 들어 있는지만 알려 준다(값은 보내지 않는다).
app.get('/api/keys/status', (req, res) => {
  res.json({
    gemini: !!realKey(process.env.GEMINI_API_KEY),
    anthropic: !!realKey(process.env.ANTHROPIC_API_KEY),
    vworld: !!realKey(process.env.VWORLD_API_KEY),
    datagokr: !!realKey(process.env.DATA_GO_KR_SERVICE_KEY)
  });
});

// 화면에서 입력한 키가 쓸 수 있는 키인지 확인한다. 키는 저장하지 않고 이 요청에만 쓴다.
app.post('/api/keys/test', async (req, res) => {
  const { provider, key } = req.body || {};
  if (!provider || typeof key !== 'string' || !key.trim()) {
    return res.status(400).json({ ok: false, message: 'provider와 key 값이 필요합니다.' });
  }
  try {
    res.json(await testKey(provider, key.trim()));
  } catch (e) {
    res.json({ ok: false, message: `확인 중 오류: ${e.message || e}` });
  }
});

app.post('/api/generate', async (req, res) => {
  try {
    const { currentSpec, instruction, model, provider, key } = req.body || {};
    if (!currentSpec || !instruction) {
      return res.status(400).json({ error: 'currentSpec, instruction 값이 필요합니다.' });
    }

    const { result, debug } = await callProvider(
      provider === 'anthropic' ? 'anthropic' : 'gemini',
      currentSpec,
      instruction,
      model,
      typeof key === 'string' ? key : ''
    );

    res.json({ ...sanitizeResult(result), _debug: debug });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message || String(e), _debug: e.debug });
  }
});

// 대지 자료 조회(VWorld·공공데이터포털). AI 키와 같은 규칙: .env 키를 먼저 쓰고 없으면 화면에서 입력한 키.
registerLandRoutes(app, (kind, userKey) => {
  const envKey = realKey(kind === 'vworld' ? process.env.VWORLD_API_KEY : process.env.DATA_GO_KR_SERVICE_KEY);
  return envKey || realKey(userKey);
});

const PORT = process.env.PORT || 8790;
app.listen(PORT, () => {
  console.log(`Mass Stacker server running: http://localhost:${PORT}`);
});
