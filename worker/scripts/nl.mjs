// 로컬 스크립트 공용: 국립중앙도서관 API 호출과 날짜별 CSV 쓰기. 인증키·URL 은 출력하지 않는다
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { toCsv } from "../src/collect.js";

const ROOT = join(import.meta.dirname, "../..");
// CSV 는 content 브랜치에 있다. git worktree add ../seoji-content content 로 체크아웃해 둔다
const CONTENT_ROOT = join(ROOT, "../seoji-content");
if (!existsSync(join(CONTENT_ROOT, ".git"))) throw new Error(`content 브랜치 worktree 가 없습니다: ${CONTENT_ROOT}`);
export const PAGE_SIZE = 1000;  // API 최대값. 5000 은 빈 응답이 온다
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const API_URL = "https://www.nl.go.kr/seoji/SearchApi.do";
const KEY = readFileSync(join(ROOT, ".env"), "utf8").match(/^NL_TOKEN=(.*)$/m)?.[1].trim();
if (!KEY) throw new Error(".env 에 NL_TOKEN 이 없습니다");

// 서버가 가끔 연결을 끊거나(ECONNRESET) resultCode 105 를 돌려준다. 세 번까지 다시 시도. { docs, total } 을 돌려준다
export async function fetchPage(page, size = PAGE_SIZE) {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    cert_key: KEY, result_style: "json", page_no: String(page), page_size: String(size),
    sort: "INPUT_DATE", order_by: "DESC",
  });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      // 어떤 쪽은 1000건 요청에만 417 이 온다 (20211228 부근 1806쪽). 같은 구간을 작게 나누면 받히므로 반씩 받는다
      if (res.status === 417 && size >= 250) {
        const [a, b] = [await fetchPage(page * 2 - 1, size / 2), await fetchPage(page * 2, size / 2)];
        return { docs: [...a.docs, ...b.docs], total: a.total };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.docs)) {
        throw new Error(`응답에 docs 가 없음: ${JSON.stringify(data).replaceAll(KEY, "***").slice(0, 300)}`);
      }
      return { docs: data.docs, total: Number(data.TOTAL_COUNT) };
    } catch (e) {
      if (attempt >= 3) {
        e.message = `${page}쪽 요청 실패: ${e.cause?.code ?? e.message}`;
        throw e;
      }
      await sleep(attempt * 5_000);
    }
  }
}

export function writeDay(date, docs) {
  const [y, m, d] = [date.slice(0, 4), date.slice(4, 6), date.slice(6, 8)];
  const path = join(CONTENT_ROOT, "content", y, m, `${y}-${m}-${d}.csv`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, toCsv(docs));
}
