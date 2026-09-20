// 대지 모양을 따라가는 다각형 매스 생성 — 참고 예제(OSC LH매입임대지도 `app/scale.ts`)의 방식.
//
//  1) 건축가능영역 = 대지 경계에서 안쪽으로 이격(offset)한 다각형
//     · 민법 제242조 경계로부터 0.5m 이상, 대지안의 공지(건축조례) 등을 이격으로 본다
//     · 이격하고 남은 면적이 건폐율 상한을 넘으면 상한에 닿을 때까지 더 이격한다(이분탐색)
//  2) 층마다 상단 높이에서 정북 일조 사선으로 잘라낸다 (건축법 시행령 제86조 제1항)
//     · 높이 H0 이하 부분: 정북 인접대지경계선에서 1.5m 이상
//     · H0 초과 부분: 그 높이의 1/2 이상
//     · H0 는 2023년 개정으로 9m → 10m (단열 강화로 층고가 두꺼워진 현장 사정 반영)
//  3) 연면적(용적률) 상한에 닿으면 마지막 층은 남은 면적만큼만 축소해서 올린다
//
// 좌표계: 앱과 같은 미터 좌표 [x(동+), z(남+)]. 따라서 정북 경계선은 z가 가장 작은 쪽이다.

import ClipperLib from 'clipper-lib';

const SCALE = 1000; // clipper는 정수 좌표를 쓰므로 mm 단위로 올려서 계산한다

export const SUNLIGHT_BASE = { before: 9, after: 10 };
export const SUN_MIN_SETBACK = 1.5;

/** 높이 h(m)에서 필요한 정북 이격거리(m) */
export function setbackAt(h, rule) {
  const H0 = SUNLIGHT_BASE[rule] ?? SUNLIGHT_BASE.after;
  return h <= H0 ? SUN_MIN_SETBACK : h / 2;
}

export function polyArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a / 2);
}

export function polyCentroid(ring) {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += cross;
    cx += (ring[j][0] + ring[i][0]) * cross;
    cz += (ring[j][1] + ring[i][1]) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function polyBBox(ring) {
  const xs = ring.map((p) => p[0]);
  const zs = ring.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** 중심 기준으로 x·z 방향을 따로 확대/축소 */
export function scalePoly(ring, kx, kz = kx, about) {
  const [cx, cz] = about || polyCentroid(ring);
  return ring.map(([x, z]) => [+(cx + (x - cx) * kx).toFixed(3), +(cz + (z - cz) * kz).toFixed(3)]);
}

export function translatePoly(ring, dx, dz) {
  return ring.map(([x, z]) => [+(x + dx).toFixed(3), +(z + dz).toFixed(3)]);
}

export function rotatePoly(ring, deg, about) {
  const [cx, cz] = about || polyCentroid(ring);
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return ring.map(([x, z]) => {
    const dx = x - cx;
    const dz = z - cz;
    return [+(cx + dx * cos + dz * sin).toFixed(3), +(cz - dx * sin + dz * cos).toFixed(3)];
  });
}

/** 다각형을 안쪽으로 d(m) 이격. 잘려 사라지면 빈 배열, 갈라지면 여러 조각. */
export function insetPolygon(ring, d) {
  if (!(d > 0)) return [ring];
  const path = ring.map(([x, z]) => ({ X: Math.round(x * SCALE), Y: Math.round(z * SCALE) }));
  if (!ClipperLib.Clipper.Orientation(path)) path.reverse(); // 바깥 윤곽을 양의 방향으로
  const co = new ClipperLib.ClipperOffset(2, 0.25);
  co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const solution = new ClipperLib.Paths();
  co.Execute(solution, -d * SCALE);
  return solution
    .map((p) => p.map((pt) => [pt.X / SCALE, pt.Y / SCALE]))
    .filter((r) => r.length >= 3 && polyArea(r) > 0.5)
    .sort((a, b) => polyArea(b) - polyArea(a));
}

/** 정북 쪽(작은 z)을 zLimit에서 잘라낸다. 남는 게 없으면 null. (Sutherland–Hodgman) */
export function clipNorth(ring, zLimit) {
  const kept = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, z1] = ring[j];
    const [x2, z2] = ring[i];
    const in1 = z1 >= zLimit;
    const in2 = z2 >= zLimit;
    if (in1) kept.push([x1, z1]);
    if (in1 !== in2) {
      const t = (zLimit - z1) / (z2 - z1);
      kept.push([+(x1 + (x2 - x1) * t).toFixed(3), +zLimit.toFixed(3)]);
    }
  }
  return kept.length >= 3 && polyArea(kept) > 0.5 ? kept : null;
}

/**
 * 이격으로 만든 건축가능영역. 면적이 건폐율 상한을 넘으면 상한에 닿을 때까지 더 이격한다.
 * 반환: { rings, area, setback, limitedBy }
 */
export function buildableArea(boundary, maxBuildingArea, setback) {
  let rings = insetPolygon(boundary, setback);
  let area = rings.reduce((s, r) => s + polyArea(r), 0);
  if (!rings.length) return { rings: [], area: 0, setback, limitedBy: '이격거리' };
  if (area <= maxBuildingArea) return { rings, area, setback, limitedBy: '이격거리' };

  let lo = setback;
  let hi = setback + 30;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const r = insetPolygon(boundary, mid);
    const a = r.reduce((s, x) => s + polyArea(x), 0);
    if (a > maxBuildingArea) {
      lo = mid;
    } else {
      hi = mid;
      rings = r;
      area = a;
    }
  }
  return { rings, area, setback: +hi.toFixed(2), limitedBy: '건폐율' };
}

/**
 * 층별 다각형 매스.
 * site: { boundary, siteArea, coverageRatio, farRatio, floorHeight, setback, sunRule }
 *   sunRule: 'off' | 'before'(9m) | 'after'(10m)
 */
export function buildPolygonFloors(site, { maxBuildingArea, maxFloorArea, maxFloors, floorHeight }) {
  const boundary = site.boundary;
  const setback = Number.isFinite(site.setback) ? site.setback : 1;
  const sunRule = site.sunRule || 'after';
  const base = buildableArea(boundary, maxBuildingArea, setback);
  if (!base.rings.length) return { floors: [], base, cutArea: 0 };

  // 정북 인접대지경계선은 필지의 최북단(가장 작은 z)으로 근사한다.
  const northZ = Math.min(...boundary.map((p) => p[1]));

  // 한 층은 다각형 하나로 둔다(이격으로 갈라지면 가장 큰 조각 사용).
  const ring = base.rings[0];
  const ringArea = polyArea(ring);

  const floors = [];
  let remaining = maxFloorArea;
  let cutArea = 0;
  let level = 1;
  while (remaining > 0.01 && level <= maxFloors) {
    const topH = level * floorHeight;
    const clipped = sunRule === 'off' ? ring : clipNorth(ring, northZ + setbackAt(topH, sunRule));
    if (!clipped) break; // 이 높이부터는 일조 사선에 걸려 지을 수 없다
    const clippedArea = polyArea(clipped);
    cutArea += Math.max(0, ringArea - clippedArea);

    // 남은 연면적보다 크면 마지막 층은 그만큼만 (중심 기준 축소)
    let shape = clipped;
    let usedArea = clippedArea;
    if (clippedArea > remaining) {
      const k = Math.sqrt(remaining / clippedArea);
      shape = scalePoly(clipped, k, k);
      usedArea = polyArea(shape);
    }

    floors.push({
      level,
      shape: shape.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]),
      height: floorHeight,
      use: usedArea < clippedArea - 0.5 ? '상층부' : clippedArea < ringArea - 0.5 ? '일조 사선 적용' : '기준층'
    });
    remaining -= usedArea;
    level++;
  }
  return { floors, base: { ...base, ringArea: +ringArea.toFixed(2) }, cutArea: +cutArea.toFixed(1), northZ };
}
