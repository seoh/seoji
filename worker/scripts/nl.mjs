// 로컬 스크립트 공용: 국립중앙도서관 API 호출과 날짜별 CSV 쓰기. 인증키·URL 은 출력하지 않는다
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { toCsv } from "../src/collect.js";

export const ROOT = join(import.meta.dirname, "../..");
export const PAGE_SIZE = 1000;  // API 최대값. 5000 은 빈 응답이 온다
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const API_URL = "https://www.nl.go.kr/seoji/SearchApi.do";
const KEY = readFileSync(join(ROOT, ".env"), "utf8").match(/^NL_TOKEN=(.*)$/m)?.[1].trim();
if (!KEY) throw new Error(".env 에 NL_TOKEN 이 없습니다");

// docs 가 없는 응답(한도 초과 등)은 다시 시도해도 같으므로 바로 던진다
export class ApiRefusal extends Error {}

// 서버가 가끔 연결을 끊는다(ECONNRESET). 세 번까지 다시 시도. { docs, total } 을 돌려준다
export async function fetchPage(page) {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    cert_key: KEY, result_style: "json", page_no: String(page), page_size: String(PAGE_SIZE),
    sort: "INPUT_DATE", order_by: "DESC",
  });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.docs)) {
        throw new ApiRefusal(`응답에 docs 가 없음: ${JSON.stringify(data).replaceAll(KEY, "***").slice(0, 300)}`);
      }
      return { docs: data.docs, total: Number(data.TOTAL_COUNT) };
    } catch (e) {
      if (e instanceof ApiRefusal || attempt >= 3) {
        e.message = `${page}쪽 요청 실패: ${e.cause?.code ?? e.message}`;
        throw e;
      }
      await sleep(attempt * 5_000);
    }
  }
}

export function writeDay(date, docs) {
  const [y, m, d] = [date.slice(0, 4), date.slice(4, 6), date.slice(6, 8)];
  const path = join(ROOT, "content", y, m, `${y}-${m}-${d}.csv`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, toCsv(docs));
}
