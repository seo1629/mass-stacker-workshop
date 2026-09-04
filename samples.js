// 테스트용 대지 정보 샘플. siteArea(㎡), coverageRatio/farRatio(%), maxFloors, floorHeight(m)
// siteWidth/siteDepth는 선택 항목 — 없으면 정사각형 대지로 간주합니다.
export const SAMPLES = [
  {
    name: '예시 1 - 2종 일반주거 (건폐율60/용적200)',
    data: {
      siteArea: 278.0,
      coverageRatio: 60,
      farRatio: 200,
      maxFloors: 7,
      floorHeight: 3.3
    }
  },
  {
    name: '예시 2 - 1종 전용주거 저밀도',
    data: {
      siteArea: 200.0,
      coverageRatio: 50,
      farRatio: 100,
      maxFloors: 4,
      floorHeight: 3.0
    }
  },
  {
    name: '예시 3 - 일반상업지역 고밀도',
    data: {
      siteArea: 500.0,
      coverageRatio: 70,
      farRatio: 500,
      maxFloors: 15,
      floorHeight: 3.5
    }
  },
  {
    name: '예시 4 - 준주거지역 중밀도',
    data: {
      siteArea: 330.0,
      coverageRatio: 55,
      farRatio: 250,
      maxFloors: 10,
      floorHeight: 3.2
    }
  },
  {
    name: '예시 5 - 직사각형 대지 (가로x세로 지정)',
    data: {
      siteArea: 320.0,
      siteWidth: 20,
      siteDepth: 16,
      coverageRatio: 55,
      farRatio: 200,
      maxFloors: 8,
      floorHeight: 3.3
    }
  }
];
