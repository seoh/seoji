import { collect, kstTargetDate, toCsv } from "./collect.js";
import { putFile } from "./github.js";
import { notifyPublishers } from "./notify.js";

async function run(env, target, { notify = false } = {}) {
  if (!env.NL_CERT_KEY) throw new Error("NL_CERT_KEY 시크릿이 없습니다");
  const { docs, pages, requests } = await collect(env, target);
  const [y, m, d] = [target.slice(0, 4), target.slice(4, 6), target.slice(6, 8)];
  const path = `content/${y}/${m}/${y}-${m}-${d}.csv`;
  await putFile(env, path, toCsv(docs), `data: ${target} 입력 도서 ${docs.length}건`);
  const summary = `${target}: ${docs.length}건 → ${path} (${pages}쪽, 요청 ${requests}회)`;
  console.log(summary);
  // 파일은 이미 저장됐다. 알림이 실패하면 실행 결과만 실패로 남는다
  if (!notify) return summary;
  const result = await notifyPublishers(env, target, docs);
  console.log(result);
  return `${summary}, ${result}`;
}

export default {
  async scheduled(event, env, ctx) {
    // 실패 사유를 로그에 남기고, 다시 던져 실행 결과가 실패로 기록되게 한다
    ctx.waitUntil(run(env, kstTargetDate(event.scheduledTime), { notify: true }).catch((e) => {
      console.error(e.message);
      throw e;
    }));
  },

  // 지난 날짜 채우기: GET /?date=yyyymmdd, Authorization: Bearer <RUN_TOKEN>. &notify=1 이면 알림도 보낸다
  // RUN_TOKEN 이 없으면 막는다. 열어 두면 누구나 호출해 API 쿼터를 쓸 수 있음
  async fetch(request, env) {
    if (!env.RUN_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.RUN_TOKEN}`) {
      return new Response("forbidden\n", { status: 403 });
    }
    const params = new URL(request.url).searchParams;
    const date = params.get("date") ?? "";
    if (!/^\d{8}$/.test(date)) return new Response("date=yyyymmdd 필요\n", { status: 400 });
    try {
      return new Response((await run(env, date, { notify: params.get("notify") === "1" })) + "\n");
    } catch (e) {
      console.error(e.message);
      return new Response(`실패: ${e.message}\n`, { status: 500 });
    }
  },
};
