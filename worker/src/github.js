// UTF-8 바이트를 base64 로. btoa 에 한글 문자열을 바로 넣으면 실패하고,
// String.fromCharCode(...bytes) 를 한 번에 펼치면 큰 파일에서 호출 스택이 넘친다
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

// 같은 경로가 있으면 sha 를 받아 덮어쓴다 (재실행 대비)
export async function putFile(env, path, text, message) {
  const url = `${env.GITHUB_API_URL}/repos/${env.GITHUB_REPO}/contents/${path}`;
  const branch = env.GITHUB_BRANCH || "main";
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "seoji-archive",  // GitHub API 는 User-Agent 필수
  };

  const got = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers });
  let sha;
  if (got.ok) sha = (await got.json()).sha;
  else if (got.status !== 404) throw new Error(`GitHub GET ${got.status}: ${(await got.text()).slice(0, 200)}`);

  const res = await fetch(url, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: toBase64(text), branch, ...(sha && { sha }) }),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
