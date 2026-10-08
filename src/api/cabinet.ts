/**
 * Личный кабинет: одна HTML-страница, ванильный JS. Никакого реакта.
 *
 * Страница не содержит секретов: ключ вводится в форме и ходит только
 * в заголовках fetch-запросов.
 */

export const CABINET_HTML = String.raw`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>heartbeat — кабинет</title>
<style>
  :root { --ok:#2e7d32; --err:#c62828; --line:#e0e0e0; }
  body { font-family: system-ui, sans-serif; margin: 0 auto; max-width: 860px; padding: 1.5rem; color: #212121; }
  h1 { font-size: 1.3rem; }
  form { display: flex; gap: .5rem; margin-bottom: 1rem; }
  input, button { font-size: 1rem; padding: .5rem .75rem; border: 1px solid var(--line); border-radius: 6px; }
  input { flex: 1; }
  button { cursor: pointer; background: #212121; color: #fff; border: none; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 1.5rem; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid var(--line); font-size: .92rem; }
  .ok { color: var(--ok); } .fail { color: var(--err); }
  #error { color: var(--err); margin: .5rem 0; }
  pre { background: #f5f5f5; padding: .75rem; border-radius: 6px; font-size: .85rem; white-space: pre-wrap; }
  h2 { font-size: 1.05rem; margin-top: 1.5rem; }
</style>
</head>
<body>
<h1>heartbeat — статистика доставки</h1>
<form id="auth">
  <input id="key" type="password" placeholder="X-API-Key" autocomplete="off">
  <button>Показать</button>
</form>
<div id="error"></div>
<section id="data" hidden>
  <h2>Доставки по каналам</h2>
  <table id="stats"><thead><tr><th>Канал</th><th>Статус</th><th>Попыток</th></tr></thead><tbody></tbody></table>
  <h2>Последние сообщения</h2>
  <table id="messages"><thead>
    <tr><th>Когда (UTC)</th><th>Получатель</th><th>Каналы</th><th>Статус</th><th></th></tr>
  </thead><tbody></tbody></table>
  <pre id="detail" hidden></pre>
</section>
<script>
const $ = (id) => document.getElementById(id);
const headers = () => ({ "X-API-Key": $("key").value });

$("auth").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("error").textContent = "";
  $("detail").hidden = true;
  try {
    const [stats, messages] = await Promise.all([
      fetch("/v1/stats", { headers: headers() }).then(check),
      fetch("/v1/messages?limit=20", { headers: headers() }).then(check),
    ]);
    renderStats(stats);
    renderMessages(messages);
    $("data").hidden = false;
  } catch (err) { $("error").textContent = err.message; }
});

function check(resp) {
  if (resp.status === 401) throw new Error("Ключ не принят (401)");
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  return resp.json();
}

function renderStats(stats) {
  const tbody = $("stats").tBodies[0];
  tbody.innerHTML = "";
  for (const [channel, byStatus] of Object.entries(stats))
    for (const [status, count] of Object.entries(byStatus)) {
      const tr = tbody.insertRow();
      tr.insertCell().textContent = channel;
      tr.insertCell().innerHTML = status === "ok" ? '<span class="ok">ok</span>' : '<span class="fail">' + status + '</span>';
      tr.insertCell().textContent = count;
    }
  if (!tbody.rows.length) tbody.insertRow().insertCell().textContent = "пока пусто";
}

function renderMessages(messages) {
  const tbody = $("messages").tBodies[0];
  tbody.innerHTML = "";
  for (const m of messages) {
    const tr = tbody.insertRow();
    tr.insertCell().textContent = m.created_at.replace("T", " ").slice(0, 19);
    tr.insertCell().textContent = m.recipient;
    tr.insertCell().textContent = m.channels.join(" → ");
    tr.insertCell().innerHTML = m.status === "delivered" ? '<span class="ok">доставлено</span>' : '<span class="fail">' + m.status + '</span>';
    const btn = tr.insertCell().appendChild(Object.assign(document.createElement("button"), { textContent: "детали" }));
    btn.addEventListener("click", () => showDetail(m.message_id));
  }
  if (!tbody.rows.length) tbody.insertRow().insertCell().textContent = "пока пусто";
}

async function showDetail(id) {
  try {
    const d = await fetch("/v1/messages/" + id, { headers: headers() }).then(check);
    $("detail").hidden = false;
    $("detail").textContent = JSON.stringify(d, null, 2);
  } catch (err) { $("error").textContent = err.message; }
}
</script>
</body>
</html>
`;
