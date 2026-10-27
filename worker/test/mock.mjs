#!/usr/bin/env node
/**
 * 로컬 테스트용 가짜 국립중앙도서관 API + GitHub Contents API.
 *
 *   node test/mock.mjs            # 대상일 20261023 150건 + 다음 날·빈 입력일·이전 날 섞음
 *   MOCK_MODE=overflow node ...   # 대상일 6,000건 → 요청 상한 초과, PUT 이 없어야 함
 *
 * PUT 받은 CSV 는 test/out/<path> 에 쓴다. GET /stats 로 요청 횟수를 본다.
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PORT = 8790;
const MODE = process.env.MOCK_MODE || "normal";
const OUT = join(import.meta.dirname, "out");

const AUTHORS = [
  "홍길동 지음",
  "존 스미스 지음; 김번역 옮김",
  "제인 도 ; 역자 : 이역자",
  "A. 저자, 옮긴이: 박옮김",
  "저자 : 최필주; AI 저자 : Claude; 역자 : 윤영",
  "",
];

let seq = 0;
const book = (date) => {
  const n = seq++;
  return {
    TITLE: n % 7 === 0 ? `제목, "따옴표" ${n}` : `책 ${n}`,
    AUTHOR: AUTHORS[n % AUTHORS.length],
    PUBLISHER: "가짜출판사",
    EA_ISBN: String(9790000000000 + n),
    PRE_PRICE: "15000",
    PAGE: "320",
    FORM: "종이책",
    PUBLISH_PREDATE: "20261101",
    INPUT_DATE: date,
  };
};

// 입력일 내림차순 목록
let list = [];
if (MODE === "overflow") {
  for (let i = 0; i < 6000; i++) list.push(book("20261023"));
} else {
  for (let i = 0; i < 30; i++) list.push(book("20261024"));
  for (let i = 0; i < 150; i++) {
    if (i % 40 === 0) list.push(book(""));  // 빈 입력일은 건너뛰어야 함
    list.push(book("20261023"));
  }
  for (let i = 0; i < 300; i++) list.push(book("20261022"));
}

const stats = { api: 0, ghGet: 0, ghPut: 0 };
const files = new Map();

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/stats") return json(res, 200, stats);

  if (url.pathname === "/api") {
    stats.api++;
    if (url.searchParams.get("cert_key") !== "test-key") {
      return json(res, 200, { RESULT: "ERROR", ERR_CODE: "010", ERR_MESSAGE: "인증키 오류 test-key 아님" });
    }
    const page = Number(url.searchParams.get("page_no"));
    const size = Number(url.searchParams.get("page_size"));
    const docs = list.slice((page - 1) * size, page * size);
    // 1쪽을 준 뒤 새 책이 입력된 것처럼 맨 앞에 끼워 넣어 목록을 한 칸 민다 → 2쪽 첫 책이 1쪽 마지막 책과 겹침
    if (MODE === "normal" && page === 1) list.unshift(book("20261024"));
    return json(res, 200, { TOTAL_COUNT: String(list.length), PAGE_NO: String(page), docs });
  }

  const m = url.pathname.match(/^\/gh\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
  if (m) {
    const path = decodeURIComponent(m[1]);
    if (!req.headers["user-agent"] || req.headers.authorization !== "Bearer test-token") {
      return json(res, 401, { message: "bad headers" });
    }
    if (req.method === "GET") {
      stats.ghGet++;
      return files.has(path) ? json(res, 200, { sha: files.get(path) }) : json(res, 404, { message: "Not Found" });
    }
    if (req.method === "PUT") {
      stats.ghPut++;
      let body = "";
      for await (const chunk of req) body += chunk;
      const { message, content, branch, sha } = JSON.parse(body);
      if (files.has(path) && sha !== files.get(path)) return json(res, 409, { message: "sha mismatch" });
      const file = join(OUT, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(content, "base64"));
      files.set(path, `sha${stats.ghPut}`);
      console.log(`PUT ${path} branch=${branch} sha=${sha ?? "-"} message="${message}"`);
      return json(res, 201, { content: { sha: files.get(path) } });
    }
  }

  json(res, 404, { message: "unknown" });
}).listen(PORT, "127.0.0.1", () => console.log(`mock (${MODE}) on :${PORT}`));
