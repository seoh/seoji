#!/usr/bin/env node
/**
 * ISBN 서지정보 API 를 입력일 내림차순으로 깊이 조회할 때 어디서 에러(105)가 나는지,
 * 한 쪽 크기를 얼마까지 키울 수 있는지 보는 일회성 조사 스크립트.
 *
 *   NL_TOKEN=... node test/depth-probe.mjs 1x100 111x100 1x1000 21x500:ebook_yn=N ...   # 쪽x쪽크기[:추가 파라미터]
 *
 * 응답 코드·건수·입력일 범위만 출력한다. 키·URL 은 출력하지 않는다.
 */
const KEY = process.env.NL_TOKEN ?? process.env.NL_CERT_KEY;
if (!KEY) throw new Error("NL_TOKEN 또는 NL_CERT_KEY 환경변수가 없습니다");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(page, size, extra) {
  const url = new URL("https://www.nl.go.kr/seoji/SearchApi.do");
  url.search = new URLSearchParams({
    cert_key: KEY, result_style: "json", page_no: String(page), page_size: String(size),
    sort: "INPUT_DATE", order_by: "DESC", ...Object.fromEntries(new URLSearchParams(extra ?? "")),
  });
  const label = `${extra ?? ""} size=${size} page=${page} (offset ${(page - 1) * size})`;
  const t = Date.now();
  try {
    const d = await (await fetch(url, { signal: AbortSignal.timeout(60_000) })).json();
    const ms = `${Date.now() - t}ms`;
    if (!d.docs) return `${label} ${ms} ERR ${d.resultCode ?? d.ERR_CODE} ${d.resultMsg ?? d.ERR_MESSAGE}`;
    const dates = d.docs.map((x) => x.INPUT_DATE).filter(Boolean);
    return `${label} ${ms} docs=${d.docs.length} total=${d.TOTAL_COUNT} ${dates[0]}~${dates.at(-1)}`;
  } catch (e) {
    return `${label} 예외 ${e.message}`;
  }
}

for (const arg of process.argv.slice(2)) {
  const [spec, extra] = arg.split(":");
  const [page, size] = spec.split("x").map(Number);
  console.log(await probe(page, size, extra));
  await sleep(500);
}
