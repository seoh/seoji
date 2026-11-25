/**
 * 국립중앙도서관 ISBN 서지정보 API에서 특정 날짜에 입력(INPUT_DATE)된 책만 모아 CSV 로 만든다.
 *
 * API 에 입력일 필터가 없으므로 입력일 내림차순으로 페이지를 넘기며 대상 날짜를 모으고,
 * 대상 날짜보다 이전 입력일이 나오면 멈춘다.
 *
 * API 는 조건마다 앞 11,000건까지만 조회된다(그 뒤 쪽은 resultCode 105). 그래서 종이책·전자책(ebook_yn N·Y,
 * 합치면 전체와 같음)을 따로 넘긴다. 2026-11-25 기준 앞 11,000건 끝이 종이책 11-09, 전자책 11-12
 */
// 쪽당 건수 상한은 문서상 1,000 미만이지만 1,000 도 받아진다 (5,000 은 013 에러).
// 1,000 이면 11,000건이 11쪽, 종이책·전자책 합쳐 22쪽. 105 구간 나누기(약 23회)를 더해도 요청 상한 안에 든다
// (500 일 때 11-17 분 재수집이 105 구간을 좁히다 47회를 넘었다)
const PAGE_SIZE = 1000;
const MAX_OFFSET = 11_000;
// Free 플랜은 실행 1회당 외부 요청 50회. 재시도도 1회로 센다. GitHub GET+PUT 2회와 알림 1회를 남긴다
export const MAX_NL_REQUESTS = 47;

// 나중에 어떻게 쓸지 몰라 API 필드를 그대로 저장한다 (TRANSLATOR 만 AUTHOR 에서 분리해 추가)
// 목차·책소개·요약은 전체 용량의 80% 를 차지해 뺀다. 각 _URL 필드는 남긴다
const EXCLUDED_COLUMNS = ["BOOK_TB_CNT", "BOOK_INTRODUCTION", "BOOK_SUMMARY"];
// 파일마다 컬럼이 같도록 순서를 고정한다. 앞 10개는 기존 파일과 같은 위치
const BASE_COLUMNS = [
  "TITLE", "AUTHOR", "TRANSLATOR", "PUBLISHER", "EA_ISBN", "PRE_PRICE",
  "PAGE", "FORM", "PUBLISH_PREDATE", "INPUT_DATE",
  "EA_ADD_CODE", "SUBJECT", "TITLE_URL",
  "KDC", "DDC", "FORM_DETAIL", "EBOOK_YN", "CIP_YN", "BIB_YN", "DEPOSIT_YN",
  "REAL_PUBLISH_DATE", "REAL_PRICE", "UPDATE_DATE", "CONTROL_NO",
  "SERIES_TITLE", "SERIES_NO", "EDITION_STMT", "VOL", "BOOK_SIZE",
  "SET_ISBN", "SET_ADD_CODE", "SET_EXPRESSION", "RELATED_ISBN",
  "PUBLISHER_URL", "BOOK_TB_CNT_URL", "BOOK_INTRODUCTION_URL", "BOOK_SUMMARY_URL",
];

// 대상은 한국 시간 기준 그저께. 입력분이 다음 날 하루에 걸쳐 일괄 등록된다
// (10-28 분: 다음 날 09:15 에 281건, 14:40 에 1,550건 / 10-27 분: 다음 날 16:54 에 2,325건, 그다음 날 2,331건)
// cron 이 늦게 돌 수 있어 예약 시각 기준
export function kstTargetDate(scheduledTime) {
  return new Date(scheduledTime + 9 * 3600e3 - 2 * 86400e3).toISOString().slice(0, 10).replaceAll("-", "");
}

// AUTHOR에서 역자 분리: "역자 : X", "옮긴이: X", "X 옮김", "X 역" 형태
const TRANSLATOR_RE = /^(?:역자|옮긴이|번역|역)\s*:\s*|\s+(?:옮김|번역|역)$/;
// "저자 : X" 의 접두어만 지운다. "AI 저자 :", "낭독자 :" 등 다른 역할은 남긴다
const AUTHOR_PREFIX_RE = /^저자\s*:\s*/;

export function splitAuthor(value) {
  const parts = String(value ?? "")
    .split(/;|,(?=\s*(?:역자|옮긴이|번역)\s*:)/)
    .map((p) => p.trim())
    .filter(Boolean);
  const authors = [], translators = [];
  for (const p of parts) {
    if (TRANSLATOR_RE.test(p)) translators.push(p.replace(TRANSLATOR_RE, "").trim());
    else authors.push(p.replace(AUTHOR_PREFIX_RE, "").trim());
  }
  return { AUTHOR: authors.join("; "), TRANSLATOR: translators.join("; ") };
}

// 응답에 새 필드가 생기면 고정 컬럼 뒤에 이름순으로 붙인다
function columnsFor(docs) {
  const extra = new Set();
  for (const d of docs) for (const k of Object.keys(d)) {
    if (!BASE_COLUMNS.includes(k) && !EXCLUDED_COLUMNS.includes(k)) extra.add(k);
  }
  return [...BASE_COLUMNS, ...[...extra].sort()];
}

// 값은 손대지 않는다(공백·줄바꿈 그대로). CSV 따옴표 처리만 한다
export function toCsv(docs) {
  const quote = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const columns = columnsFor(docs);
  const rows = [columns, ...docs.map((d) => columns.map((c) => d[c]))];
  return "﻿" + rows.map((r) => r.map(quote).join(",")).join("\n") + "\n";  // 엑셀에서 한글이 깨지지 않도록 BOM
}

// Worker 로그는 대시보드에 남으므로 에러 메시지에 URL·인증키를 넣지 않는다
async function fetchPage(env, ebook, page, size, budget) {
  const url = new URL(env.NL_API_URL);
  url.search = new URLSearchParams({
    cert_key: env.NL_CERT_KEY, result_style: "json", page_no: String(page), page_size: String(size),
    sort: "INPUT_DATE", order_by: "DESC", ebook_yn: ebook,
  });
  const where = `ebook_yn=${ebook} offset ${(page - 1) * size}+${size}`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (budget.used >= MAX_NL_REQUESTS) {
      throw new Error(`요청 상한 ${MAX_NL_REQUESTS}회 초과 (${where})`);
    }
    budget.used++;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.docs)) return data.docs;
      const brief = JSON.stringify(data).replaceAll(env.NL_CERT_KEY, "***").slice(0, 300);
      lastError = new Error(`${where} 응답에 docs 가 없음: ${brief}`);
      lastError.apiCode = data.resultCode;
      if (data.resultCode === "105") break;  // 같은 구간은 다시 요청해도 105. 재시도로 요청을 쓰지 않는다
    } catch (e) {
      lastError = new Error(`${where} 요청 실패: ${e.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 5_000));
    }
  }
  throw lastError;
}

// 특정 레코드가 든 구간은 쪽 크기와 상관없이 105 가 난다 (2026-11-25 전자책 offset 6,000~6,099).
// 그 구간을 1/5 크기 쪽으로 나눠 다시 받고, 1건까지 좁혀도 실패하면 그 레코드만 건너뛴다.
// 1,000건 구간에서 1건을 찾는 데 요청 약 23회 (1,000 → 200 → 40 → 8 → 1)
async function fetchRange(env, ebook, offset, size, budget) {
  try {
    return { docs: await fetchPage(env, ebook, offset / size + 1, size, budget), skipped: 0 };
  } catch (e) {
    if (e.apiCode !== "105") throw e;
    if (size === 1) {
      console.log(`건너뜀: ${e.message}`);
      return { docs: [], skipped: 1 };
    }
    const part = size % 5 === 0 ? size / 5 : 1;
    const result = { docs: [], skipped: 0 };
    for (let o = offset; o < offset + size; o += part) {
      const r = await fetchRange(env, ebook, o, part, budget);
      result.docs.push(...r.docs);
      result.skipped += r.skipped;
      if (r.docs.length + r.skipped < part) break;  // 목록 끝
    }
    return result;
  }
}

export async function collect(env, target) {
  // 수집 중 새 책이 입력되면 페이지가 밀려 같은 책이 두 번 나올 수 있어 ISBN 으로 중복을 거른다
  const found = new Map();
  const budget = { used: 0 };
  let pages = 0, skipped = 0;
  for (const ebook of ["N", "Y"]) {
    let reachedOlder = false;
    let page = 0;
    while (!reachedOlder) {
      if (page * PAGE_SIZE >= MAX_OFFSET) {
        throw new Error(`API 는 앞 ${MAX_OFFSET}건까지만 조회돼 ebook_yn=${ebook} 에서 ${target} 입력분 끝까지 닿지 못함`);
      }
      const r = await fetchRange(env, ebook, page++ * PAGE_SIZE, PAGE_SIZE, budget);
      const docs = r.docs;
      skipped += r.skipped;
      for (const d of docs) {
        const date = String(d.INPUT_DATE ?? "").trim();
        if (date === target) {
          const key = d.EA_ISBN || JSON.stringify(d);
          if (!found.has(key)) {
            found.set(key, { ...d, ...splitAuthor(d.AUTHOR) });
          }
        } else if (date && date < target) {
          reachedOlder = true;  // 빈 입력일은 정렬 위치를 알 수 없어 멈춤 조건으로 쓰지 않는다
        }
      }
      if (docs.length + r.skipped < PAGE_SIZE) break;  // 마지막 쪽
    }
    pages += page;
  }
  return { docs: [...found.values()], pages, requests: budget.used, skipped };
}
