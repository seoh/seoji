// 관심 출판사 책이 입력되면 메일로 알린다. 표기가 제각각이고 부분 일치는 다른 출판사까지 걸려
// (비티인사이트, 책만드는집, 에이콘온, 길벗어린이 등) 저장된 표기와 정확히 맞춘다
const PUBLISHERS = {
  "인사이트": ["인사이트", "(주식회사 도서출판)인사이트"],
  "한빛미디어": ["한빛미디어", "한빛미디어(주)", "한빛미디어 :한빛앤", "한빛에듀 :한빛미디어"],
  "에이콘": [
    "에이콘", "에이콘출판사", "에이콘출판사(주)", "에이콘출판(주)",
    "에이콘(에이콘출판)", "에이콘(에이콘출판사)", "에이콘(에이콘출판주식회사)",
  ],
  "길벗": ["길벗", "(주 도서출판)길벗", "길벗캠퍼스 :길벗"],
  "비제이퍼블릭": ["비제이퍼블릭", "주식회사 비제이퍼블릭", "BJpublic(비제이퍼블릭)", "BJ(비제이퍼블릭)"],
  "위키북스": ["위키북스"],
  "제이펍": ["제이펍", "(주식회사)제이펍", "Jpub(제이펍)"],
  "이지스퍼블리싱": ["이지스퍼블리싱", "이지스퍼블리싱(주)"],
  "골든래빗": [
    "골든래빗", "골든래빗 주식회사", "Golden Rabbit(골든래빗)", "Golden rabbit(골든래빗)",
    "우아한테크 :Golden Rabbit(골든래빗)",
  ],
  "책만": ["책만", "주식회사 책만"],
};

const LABEL_BY_NAME = new Map(
  Object.entries(PUBLISHERS).flatMap(([label, names]) => names.map((n) => [n, label])),
);

export function publisherLabel(value) {
  return LABEL_BY_NAME.get(String(value ?? "").trim());
}

export function matchPublishers(docs) {
  const groups = new Map();
  for (const label of Object.keys(PUBLISHERS)) groups.set(label, []);
  for (const d of docs) groups.get(publisherLabel(d.PUBLISHER))?.push(d);
  return [...groups].filter(([, books]) => books.length);
}

function emailText(groups) {
  return groups.map(([label, books]) => [
    `[${label}] ${books.length}건`,
    ...books.map((d) => `- ${d.TITLE} / ${d.AUTHOR || "저자 없음"} / ISBN ${d.EA_ISBN || "없음"} / 출간예정 ${d.PUBLISH_PREDATE || "미정"}`),
  ].join("\n")).join("\n\n") + "\n";
}

// 설정이 없으면 건너뛴다. 외부 요청 1회만 쓰도록 다시 시도하지 않는다
export async function notifyPublishers(env, target, docs) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_TO || !env.NOTIFY_FROM) return "알림 설정 없음";
  const groups = matchPublishers(docs);
  const count = groups.reduce((n, [, books]) => n + books.length, 0);
  if (!count) return "알림 대상 없음";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.NOTIFY_FROM,
      to: [env.NOTIFY_TO],
      subject: `[서지] ${target} 입력 관심 출판사 ${count}건`,
      text: emailText(groups),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return `알림 ${count}건`;
}
