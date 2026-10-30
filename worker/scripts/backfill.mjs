#!/usr/bin/env node
/**
 * 지난 입력일 여러 날을 한 번에 받아 content/ 에 CSV 로 쓴다. 커밋은 직접 한다.
 *
 *   node scripts/backfill.mjs 20260731 20261028
 *
 * Worker 는 실행 1회당 요청 47회 상한이라 오래된 날짜까지 페이지를 넘길 수 없어 로컬에서 돌린다.
 * 인증키는 저장소 루트 .env 의 NL_TOKEN.
 */
import { fetchPage, PAGE_SIZE, sleep, writeDay } from "./nl.mjs";
import { splitAuthor } from "../src/collect.js";

const [START, END] = process.argv.slice(2);
if (!/^\d{8}$/.test(START ?? "") || !/^\d{8}$/.test(END ?? "") || START > END) {
  throw new Error("사용법: node scripts/backfill.mjs <시작 yyyymmdd> <끝 yyyymmdd>");
}

// 날짜별로 ISBN 중복을 거른다 (수집 중 새 책이 입력되면 페이지가 밀려 같은 책이 두 번 나올 수 있다)
const byDate = new Map();
let page = 0;
let reachedOlder = false;
while (!reachedOlder) {
  const { docs } = await fetchPage(++page);
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
  writeDay(date, [...found.values()]);
  console.log(`${date}: ${found.size}건`);
}
console.log(`${byDate.size}일, ${page}쪽`);
