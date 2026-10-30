#!/usr/bin/env node
/**
 * content/ 의 CSV 를 지금 수집 코드의 형식(toCsv: 컬럼 순서·제외 컬럼)으로 다시 써서 push 한다.
 * 컬럼을 바꾼 뒤 기존 파일에 반영할 때 쓴다. Worker 는 실행 1회당 외부 요청 상한 때문에
 * 파일 수십 개를 고칠 수 없어 로컬에서 돌린다.
 *
 *   node scripts/reformat.mjs            # pull → 다시 쓰기 → 커밋 → push
 *   node scripts/reformat.mjs --dry-run  # 바뀔 파일만 출력
 *
 * 값은 그대로 옮긴다. 빠진 컬럼은 사라지고, 새로 생긴 컬럼은 빈칸이 된다.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toCsv } from "../src/collect.js";

const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = join(import.meta.dirname, "../..");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

// toCsv 가 쓰는 형식만 읽는다: BOM, 쉼표 구분, 큰따옴표 안의 "" 는 ", 따옴표 안 줄바꿈 허용
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = text.startsWith("﻿") ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? csvFiles(join(dir, e.name)) : e.name.endsWith(".csv") ? [join(dir, e.name)] : []);
}

if (git("status", "--porcelain", "content")) throw new Error("content/ 에 커밋 안 된 변경이 있습니다");
if (!DRY_RUN) git("pull", "--ff-only");

const changed = [];
for (const path of csvFiles(join(ROOT, "content")).sort()) {
  const text = readFileSync(path, "utf8");
  const [header, ...rows] = parseCsv(text);
  const docs = rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
  const out = toCsv(docs);
  if (out === text) continue;
  changed.push(path.slice(ROOT.length + 1));
  if (!DRY_RUN) writeFileSync(path, out);
}

console.log(changed.length ? changed.join("\n") : "바뀐 파일 없음");
if (DRY_RUN || !changed.length) process.exit(0);

git("add", "content");
git("commit", "-m", `data: CSV ${changed.length}개를 현재 컬럼 형식으로 다시 씀`);
git("push");
console.log(`${changed.length}개 커밋·push 완료`);
