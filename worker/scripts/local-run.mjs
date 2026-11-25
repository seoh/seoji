#!/usr/bin/env node
/**
 * Worker 의 수동 실행(fetch)을 로컬 Node 에서 돌린다. Worker 의 실행당 요청 50회 제한이 없어
 * 105 레코드가 많아 Worker 에서 요청 상한을 넘는 날짜를 받을 때 쓴다. 결과는 Worker 처럼 GitHub 에 커밋한다.
 *
 *   (set -a; . ../.env; set +a; node scripts/local-run.mjs 20261117 Y)   # 날짜 [N|Y]
 *
 * 필요한 환경변수: NL_TOKEN(또는 NL_CERT_KEY), GITHUB_TOKEN. 키·URL 은 출력하지 않는다.
 */
import worker from "../src/index.js";

const [date, ebook] = process.argv.slice(2);
if (!/^\d{8}$/.test(date ?? "")) throw new Error("사용법: node scripts/local-run.mjs yyyymmdd [N|Y]");
const env = {
  NL_API_URL: "https://www.nl.go.kr/seoji/SearchApi.do",
  GITHUB_API_URL: "https://api.github.com",
  GITHUB_REPO: "seoh/seoji",
  GITHUB_BRANCH: "content",
  NL_CERT_KEY: process.env.NL_TOKEN ?? process.env.NL_CERT_KEY,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  RUN_TOKEN: "local",
  MAX_NL_REQUESTS: "500",
};
if (!env.NL_CERT_KEY || !env.GITHUB_TOKEN) throw new Error("NL_TOKEN(또는 NL_CERT_KEY)·GITHUB_TOKEN 환경변수가 없습니다");

const url = `http://local/?date=${date}${ebook ? `&ebook=${ebook}` : ""}`;
const res = await worker.fetch(new Request(url, { headers: { Authorization: "Bearer local" } }), env);
console.log((await res.text()).trim());
process.exitCode = res.ok ? 0 : 1;
