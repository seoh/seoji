#!/usr/bin/env node
/**
 * 지난 입력일 여러 날을 한 번에 받아 content/ 에 CSV 로 쓴다. 커밋은 직접 한다.
 *
 *   node scripts/backfill.mjs 20260731 20261028
 *
 * Worker 는 실행 1회당 요청 47회 상한이라 오래된 날짜까지 페이지를 넘길 수 없어 로컬에서 돌린다.
 * 인증키는 저장소 루트 .env 의 NL_TOKEN. 인증키·URL 은 출력하지 않는다.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { splitAuthor, toCsv } from "../src/collect.js";

const [START, END] = process.argv.slice(2);
if (!/^\d{8}$/.test(START ?? "") || !/^\d{8}$/.test(END ?? "") || START > END) {
  throw new Error("사용법: node scripts/backfill.mjs <시작 yyyymmdd> <끝 yyyymmdd>");
}

const ROOT = join(import.meta.dirname, "../..");
const KEY = readFileSync(join(ROOT, ".env"), "utf8").match(/^NL_TOKEN=(.*)$/m)?.[1].trim();
if (!KEY) throw new Error(".env 에 NL_TOKEN 이 없습니다");

const API_URL = "https://www.nl.go.kr/seoji/SearchApi.do";
const PAGE_SIZE = 1000;  // 5000 은 빈 응답이 온다
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 서버가 가끔 연결을 끊는다(ECONNRESET). 세 번까지 다시 시도
async function fetchPage(page) {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    cert_key: KEY, result_style: "json", page_no: String(page), page_size: String(PAGE_SIZE),
    sort: "INPUT_DATE", order_by: "DESC",
  });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.docs)) throw new Error("응답에 docs 가 없음");
      return data.docs;
    } catch (e) {
      if (attempt >= 3) throw new Error(`${page}쪽 요청 실패: ${e.cause?.code ?? e.message}`);
      await sleep(attempt * 5_000);
    }
  }
}

// 날짜별로 ISBN 중복을 거른다 (수집 중 새 책이 입력되면 페이지가 밀려 같은 책이 두 번 나올 수 있다)
const byDate = new Map();
let page = 0;
let reachedOlder = false;
while (!reachedOlder) {
  const docs = await fetchPage(++page);
  for (const d of docs) {
    const date = String(d.INPUT_DATE ?? "").trim();
    if (!date || date > END) continue;
    if (date < START) { reachedOlder = true; continue; }
    if (!byDate.has(date)) byDate.set(date, new Map());
    const found = byDate.get(date);
    const key = d.EA_ISBN || JSON.stringify(d);
    if (!found.has(key)) found.set(key, { ...d, ...splitAuthor(d.AUTHOR) });
  }
  console.log(`${page}쪽: ${docs[0]?.INPUT_DATE ?? "-"} ~ ${docs.at(-1)?.INPUT_DATE ?? "-"}`);
  if (docs.length < PAGE_SIZE) break;  // 마지막 쪽
  await sleep(300);
}

for (const [date, found] of [...byDate].sort()) {
  const path = join(ROOT, "content", date.slice(0, 4), date.slice(4, 6), `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}.csv`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, toCsv([...found.values()]));
  console.log(`${date}: ${found.size}건`);
}
console.log(`${byDate.size}일, ${page}쪽`);
