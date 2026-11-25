import { collect, kstTargetDate, parseCsv, toCsv } from "./collect.js";
import { putFile, readFile } from "./github.js";
import { notifyPublishers } from "./notify.js";

// 토요일 입력분은 이틀 뒤(월 09:15)에도 거의 없다 (11-21 분: 0건 → 11-25 재수집 316건).
// 수요일 09:45 KST 에 나흘 전 토요일분을 다시 받는다. wrangler.toml 의 crons 와 같아야 한다
const SATURDAY_RECHECK_CRON = "45 0 * * 3";

// recheck: 이미 받은 날짜를 다시 받는 실행. 알림은 기존 파일에 없던 책만 보낸다
async function run(env, target, { notify = false, ebook, recheck = false } = {}) {
  if (!env.NL_CERT_KEY) throw new Error("NL_CERT_KEY 시크릿이 없습니다");
  const { docs, pages, requests, skipped } = await collect(env, target, ebook ? [ebook] : undefined);
  const [y, m, d] = [target.slice(0, 4), target.slice(4, 6), target.slice(6, 8)];
  const path = `content/${y}/${m}/${y}-${m}-${d}.csv`;
  const before = recheck ? new Set(parseCsv(await readFile(env, path)).map((r) => r.EA_ISBN)) : new Set();
  let rows = docs;
  if (ebook) {
    // 한쪽만 받은 실행: 기존 파일에서 다른 쪽 행은 두고 이쪽 행만 바꾼다
    const kept = parseCsv(await readFile(env, path)).filter((r) => r.EBOOK_YN !== ebook);
    rows = [...kept, ...docs];
  }
  await putFile(env, path, toCsv(rows), `data: ${target} 입력 도서 ${rows.length}건`);
  const summary = `${target}: ${rows.length}건 → ${path} (` +
    (ebook ? `ebook_yn=${ebook} ${docs.length}건, ` : "") + `${pages}쪽, 요청 ${requests}회` +
    (skipped ? `, API 오류로 ${skipped}건 건너뜀)` : ")");
  console.log(summary);
  // 파일은 이미 저장됐다. 알림이 실패하면 실행 결과만 실패로 남는다
  if (!notify) return summary;
  const result = await notifyPublishers(env, target, docs.filter((d) => !before.has(d.EA_ISBN)));
  console.log(result);
  return `${summary}, ${result}`;
}

export default {
  async scheduled(event, env, ctx) {
    // 실패 사유를 로그에 남기고, 다시 던져 실행 결과가 실패로 기록되게 한다
    const recheck = event.cron === SATURDAY_RECHECK_CRON;
    const target = kstTargetDate(event.scheduledTime, recheck ? 4 : 2);
    ctx.waitUntil(run(env, target, { notify: true, recheck }).catch((e) => {
      console.error(e.message);
      throw e;
    }));
  },

  // 지난 날짜 채우기: GET /?date=yyyymmdd, Authorization: Bearer <RUN_TOKEN>. &notify=1 이면 알림도 보낸다
  // &ebook=N|Y 이면 종이책·전자책 한쪽만 받아 기존 파일의 그쪽 행만 바꾼다 (GitHub 요청이 1회 늘어 알림과 같이 못 씀)
  // RUN_TOKEN 이 없으면 막는다. 열어 두면 누구나 호출해 API 쿼터를 쓸 수 있음
  async fetch(request, env) {
    if (!env.RUN_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.RUN_TOKEN}`) {
      return new Response("forbidden\n", { status: 403 });
    }
    const params = new URL(request.url).searchParams;
    const date = params.get("date") ?? "";
    if (!/^\d{8}$/.test(date)) return new Response("date=yyyymmdd 필요\n", { status: 400 });
    const ebook = params.get("ebook") ?? undefined;
    const notify = params.get("notify") === "1";
    if (ebook && !["N", "Y"].includes(ebook)) return new Response("ebook=N 또는 Y\n", { status: 400 });
    if (ebook && notify) return new Response("ebook 과 notify 는 같이 쓸 수 없음\n", { status: 400 });
    try {
      return new Response((await run(env, date, { notify, ebook })) + "\n");
    } catch (e) {
      console.error(e.message);
      return new Response(`실패: ${e.message}\n`, { status: 500 });
    }
  },
};
