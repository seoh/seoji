#!/usr/bin/env node
/**
 * 시작일부터 과거로 페이지를 넘기며 API 가 허용하는 데까지 날짜별 CSV 를 content/ 에 쓴다. 커밋은 직접 한다.
 *
 *   node scripts/archive.mjs 20260730            # 시작 페이지는 이진 탐색으로 찾는다
 *   node scripts/archive.mjs 20260730 --page 104 # 시작 페이지를 직접 준다 (이어 받기)
 *
 * 입력일 내림차순이라 어떤 날짜보다 이전 입력일이 나오면 그 날짜는 다 받은 것으로 보고 파일을 쓴다.
 * 한도 초과·요청 실패·순서가 어긋난 응답에서 멈추고, 그때 받던 날짜는 다 받았다고 볼 수 없어 버린다.
 * 마지막 쪽까지 정상으로 받은 경우에만 마지막 날짜도 쓴다.
 */
import { fetchPage, PAGE_SIZE, sleep, writeDay } from "./nl.mjs";
import { splitAuthor } from "../src/collect.js";

const START = process.argv[2];
if (!/^\d{8}$/.test(START ?? "")) throw new Error("사용법: node scripts/archive.mjs <시작 yyyymmdd> [--page N]");
const pageArg = process.argv.indexOf("--page");
const dateOf = (d) => String(d?.INPUT_DATE ?? "").trim();
const lastDate = (docs) => docs.map(dateOf).filter(Boolean).at(-1) ?? "";

// 마지막 입력일이 START 이하인 첫 페이지. 그 앞 페이지는 전부 START 보다 뒤라 START 분이 없다
async function findStartPage() {
  let { total } = await fetchPage(1);
  let lo = 1, hi = Math.ceil(total / PAGE_SIZE);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const { docs } = await fetchPage(mid);
    if (lastDate(docs) <= START) hi = mid; else lo = mid + 1;
    console.log(`탐색 ${mid}쪽: ${lastDate(docs)}`);
  }
  // 탐색 중 새로 입력된 책만큼 뒤로 밀리므로 한 쪽 앞에서 시작한다 (중복은 ISBN 으로 거른다)
  return Math.max(1, lo - 1);
}

let page = pageArg > 0 ? Number(process.argv[pageArg + 1]) : await findStartPage();
let current = null;  // 받는 중인 날짜
let currentPage = page;  // current 가 처음 나온 쪽. 멈추면 여기서 이어 받는다
let found = new Map();
let prevLast = "";   // 앞 페이지의 마지막 입력일
let written = 0, rows = 0, reachedEnd = false, stopReason = "";
console.log(`${page}쪽부터 시작`);

for (; ; page++) {
  let docs, total;
  try {
    ({ docs, total } = await fetchPage(page));
  } catch (e) {
    stopReason = e.message;
    break;
  }
  if (docs.length === 0) {
    // 전체 건수를 넘긴 쪽이면 끝까지 받은 것. 그 전인데 비면 이상한 응답이라 멈춘다
    if ((page - 1) * PAGE_SIZE >= total) reachedEnd = true;
    else stopReason = `${page}쪽이 비어 있음 (전체 ${total}건)`;
    break;
  }
  // 깊은 쪽에서 앞쪽 내용이 다시 오는 일이 있었다. 앞 페이지보다 최근 입력일이 나오면 멈춘다
  const first = docs.map(dateOf).find(Boolean) ?? "";
  if (prevLast && first > prevLast) {
    stopReason = `${page}쪽 순서 어긋남: 첫 입력일 ${first} > 앞 쪽 마지막 ${prevLast}`;
    break;
  }
  for (const d of docs) {
    const date = dateOf(d);
    if (!date || date > START) continue;
    if (date !== current) {
      if (current && date > current) continue;  // 쪽 안에서 순서가 어긋난 행은 무시 (이미 쓴 날짜)
      if (current) { writeDay(current, [...found.values()]); written++; rows += found.size; console.log(`${current}: ${found.size}건`); }
      current = date;
      currentPage = page;
      found = new Map();
    }
    const key = d.EA_ISBN || JSON.stringify(d);
    if (!found.has(key)) found.set(key, { ...d, ...splitAuthor(d.AUTHOR) });
  }
  prevLast = lastDate(docs) || prevLast;
  if (page % 50 === 0) console.log(`${page}쪽: ~${prevLast}`);
  if (docs.length < PAGE_SIZE) { reachedEnd = true; break; }
  await sleep(300);
}

if (reachedEnd && current) {
  writeDay(current, [...found.values()]); written++; rows += found.size;
  console.log(`${current}: ${found.size}건 (마지막 쪽)`);
} else if (current) {
  console.log(`${current}: ${found.size}건 받다가 멈춰 버림`);
}
console.log(`멈춤: ${stopReason || "마지막 쪽"}`);
console.log(`${written}일 ${rows}건 저장`);
if (!reachedEnd && current) console.log(`이어 받기: node scripts/archive.mjs ${current} --page ${Math.max(1, currentPage - 1)}`);
