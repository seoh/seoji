#!/usr/bin/env node
/**
 * 날짜별로 지금 API 에서 모이는 건수를 센다(GitHub 에 쓰지 않음). 저장된 파일 건수와 비교해
 * 늦게 등록된 입력분이 있는지 본다.
 *
 *   (set -a; . ../.env; set +a; node test/count-probe.mjs 20261120 20261113 ...)
 *   UPDATES=1 ... 이면 UPDATE_DATE(등록·수정일) 분포도 출력한다
 *
 * 키·URL 은 출력하지 않는다.
 */
import { collect } from "../src/collect.js";

const env = {
  NL_API_URL: "https://www.nl.go.kr/seoji/SearchApi.do",
  NL_CERT_KEY: process.env.NL_TOKEN ?? process.env.NL_CERT_KEY,
  MAX_NL_REQUESTS: "500",
};
if (!env.NL_CERT_KEY) throw new Error("NL_TOKEN 또는 NL_CERT_KEY 환경변수가 없습니다");

for (const date of process.argv.slice(2)) {
  const counts = [];
  for (const ebook of ["N", "Y"]) {
    try {
      const { docs, requests } = await collect(env, date, [ebook]);
      counts.push(`${ebook}=${docs.length}(요청 ${requests})`);
      if (process.env.UPDATES) {
        const hist = {};
        for (const d of docs) hist[d.UPDATE_DATE || "-"] = (hist[d.UPDATE_DATE || "-"] ?? 0) + 1;
        counts.push(`\n  ${ebook} UPDATE_DATE ${JSON.stringify(Object.fromEntries(Object.entries(hist).sort()))}`);
      }
    } catch (e) {
      counts.push(`${ebook}=실패 ${e.message.slice(0, 80)}`);
    }
  }
  console.log(date, counts.join(" "));
}
