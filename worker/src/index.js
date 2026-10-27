import { collect, kstYesterday, toCsv } from "./collect.js";
import { putFile } from "./github.js";

async function run(env, target) {
  if (!env.NL_CERT_KEY) throw new Error("NL_CERT_KEY 시크릿이 없습니다");
  const { docs, pages, requests } = await collect(env, target);
  const [y, m, d] = [target.slice(0, 4), target.slice(4, 6), target.slice(6, 8)];
  const path = `content/${y}/${m}/${y}-${m}-${d}.csv`;
  await putFile(env, path, toCsv(docs), `data: ${target} 입력 도서 ${docs.length}건`);
  const summary = `${target}: ${docs.length}건 → ${path} (${pages}쪽, 요청 ${requests}회)`;
  console.log(summary);
  return summary;
}

export default {
  async scheduled(event, env, ctx) {
    // 실패 사유를 로그에 남기고, 다시 던져 실행 결과가 실패로 기록되게 한다
    ctx.waitUntil(run(env, kstYesterday(event.scheduledTime)).catch((e) => {
      console.error(e.message);
      throw e;
    }));
  },

  // 지난 날짜 채우기: GET /?date=yyyymmdd, Authorization: Bearer <RUN_TOKEN>
  // RUN_TOKEN 이 없으면 막는다. 열어 두면 누구나 호출해 API 쿼터를 쓸 수 있음
  async fetch(request, env) {
    if (!env.RUN_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.RUN_TOKEN}`) {
      return new Response("forbidden\n", { status: 403 });
    }
    const date = new URL(request.url).searchParams.get("date") ?? "";
    if (!/^\d{8}$/.test(date)) return new Response("date=yyyymmdd 필요\n", { status: 400 });
    try {
      return new Response((await run(env, date)) + "\n");
    } catch (e) {
      console.error(e.message);
      return new Response(`실패: ${e.message}\n`, { status: 500 });
    }
  },
};
