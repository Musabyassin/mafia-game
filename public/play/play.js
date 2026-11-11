/* وحدة تحكم الهاتف: الاتصال والانضمام والردهة. شاشات اللعب في play-game.js */
(() => {
'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['#e74c3c','#3498db','#2ecc71','#b7950b','#9b59b6','#e67e22','#1abc9c','#fd79a8','#7f8c9b','#d63031','#00b894','#6c5ce7'];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};
const qCode = (new URLSearchParams(location.search).get('c') || '').replace(/\D/g, '').slice(0, 4);
let room = null; try { room = JSON.parse(store.get('mf_room') || 'null'); } catch (e) { room = null; }
const App = window.App = { st: null, lobby: null, me: null, tab: 'game', room, root: $('#root'), $, esc, store, COLORS, chat: [], chatUnread: 0, speedV: store.get('mf_speed') || 'normal', offset: 0, lastPhase: null };
try { if (store.get('mf_mute') === '1') Sfx.setMuted(true); } catch (e) { /* ignore */ }

function send(o) { return net.send(o); }
function toast(m) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; const box = $('#toasts'); box.appendChild(t);
  while (box.children.length > 2) box.firstChild.remove(); setTimeout(() => t.remove(), 2800);
}
function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false; }
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
Object.assign(App, { send, toast, modal, closeModal });

const net = Net.connect({
  onOpen() { if (App.room) send({ t: 'join', code: App.room.code, token: App.room.token, name: store.get('mf_name') || 'لاعب', spectator: App.room.spectator || undefined }); },
  onStatus(s) { $('#conn').hidden = s === 'open'; },
  onMsg(m) {
    if (m.t === 'joined') {
      if (m.spectator) { App.spectator = true; App.me = null; App.room = { code: m.code, spectator: true }; store.set('mf_room', JSON.stringify(App.room)); store.set('mf_name', m.name); toast('دخلت كمشاهد — اللعبة بدأت بالفعل'); }
      else { App.spectator = false; App.room = { code: m.code, token: m.token }; store.set('mf_room', JSON.stringify(App.room)); store.set('mf_name', m.name); App.me = m.id; }
    }
    else if (m.t === 'lobby') { App.lobby = m; App.st = null; App.me = m.me === undefined ? null : m.me; App.lastPhase = null; }
    else if (m.t === 'state') {
      App.st = m; App.lobby = null; App.me = m.me === undefined ? null : m.me; App.spectator = !!m.spectator;
      App.offset = Date.now() - m.s.serverNow;
      if (m.s.phase !== App.lastPhase) {
        App.lastPhase = m.s.phase;
        try { if (store.get('mf_vib') !== '0') navigator.vibrate && navigator.vibrate(m.s.phase === 'night' ? [100, 50, 100] : 80); } catch (e) { /* ignore */ }
      }
    }
    else if (m.t === 'chatHist') { App.chat = Array.isArray(m.list) ? m.list.slice(-50) : []; if (App.st) render(); return; }
    else if (m.t === 'investigate') { toast(`🔎 نتيجة التحقيق: ${m.name} ${m.isMafia ? 'مافيا 🔪' : 'بريء ✅'}`); try { navigator.vibrate && navigator.vibrate([80, 40, 80]); } catch (e) { /* ignore */ } return; }
    else if (m.t === 'ev') {
      if (m.e.e === 'chat') { if (App.onChat) App.onChat(m.e); }
      else if (m.e.e === 'toast') toast(m.e.m);
      return;
    }
    else if (m.t === 'err') { toast(m.m); if (m.fatal) { App.room = null; store.del('mf_room'); App.st = null; App.lobby = null; } }
    else if (m.t === 'kicked') { App.room = null; store.del('mf_room'); App.st = null; App.lobby = null; toast('تم إخراجك من الغرفة'); }
    else return;
    render();
  },
});
['click', 'touchstart'].forEach((ev) => addEventListener(ev, () => Sfx.unlock(), { once: true }));
document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => { App.tab = b.dataset.tab; if (App.tab === 'chat') { App.chatUnread = 0; } render(); }; });

let raf = 0;
function render() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); }
App.render = render;
function paint() {
  const inGame = !!App.st, inLobby = !!App.lobby;
  $('#tabs').hidden = !inGame;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === App.tab));
  $('#chatdot').hidden = !(App.chatUnread > 0 && App.tab !== 'chat');
  const chip = $('#mechip');
  if (App.st && App.me != null && App.st.s.me) chip.innerHTML = `<span class="avatar" style="background:${COLORS[App.me]};width:26px;height:26px;font-size:13px">${esc((store.get('mf_name') || 'ل').slice(0, 1))}</span>${esc(store.get('mf_name') || '')}`;
  else if (App.spectator && App.st) chip.textContent = '👁 مشاهد';
  else chip.textContent = '';
  if (inGame && App.renderGame) App.renderGame();
  else if (inLobby) renderLobby();
  else renderJoin();
}

function renderJoin() {
  closeModal();
  const nm = store.get('mf_name') || '';
  if (App.joinKey === 'join') { const c = $('#code'); if (c && document.activeElement === c) return; if (document.activeElement && document.activeElement.id === 'name') return; }
  App.joinKey = 'join';
  App.root.innerHTML = `<div class="join"><h1>🕵️ المافيا</h1><p class="muted" style="text-align:center">أدخل كود الغرفة الظاهر على التلفاز، أو أنشئ غرفة جديدة وادعُ أصدقاءك بالكود. يلزم 5 لاعبين على الأقل (ويمكن إضافة آليين).</p>
    <div class="card"><label class="f">كود الغرفة<input type="text" id="code" class="codein" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" value="${esc(qCode)}" placeholder="0000"></label>
    <label class="f">اسمك<input type="text" id="name" maxlength="14" autocomplete="nickname" value="${esc(nm)}" placeholder="اكتب اسمك"></label>
    <button class="btn primary" id="join">انضمام</button></div>
    <div class="card"><b>ستلعبون عن بعد؟</b><span class="muted">أنشئ غرفة بدون تلفاز وشارك الكود؛ تظهر حالة اللعبة على هواتفكم.</span><button class="btn" id="create">إنشاء غرفة جديدة</button></div></div>`;
  const name = () => ($('#name').value.trim() || '').slice(0, 14);
  $('#join').onclick = () => {
    const code = $('#code').value.replace(/\D/g, '');
    if (code.length !== 4) return toast('أدخل كود من 4 أرقام');
    if (!name()) return toast('اكتب اسمك أولاً');
    store.set('mf_name', name()); send({ t: 'join', code, name: name() });
  };
  $('#create').onclick = () => { if (!name()) return toast('اكتب اسمك أولاً'); store.set('mf_name', name()); send({ t: 'create', role: 'phone', name: name() }); };
  $('#code').oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); };
}

function renderLobby() {
  App.joinKey = null; closeModal();
  const L = App.lobby, me = L.players[L.me], host = !!(me && me.host), full = L.players.length >= L.max, enough = L.players.length >= L.min;
  const link = `${location.origin}/play/?c=${L.code}`;
  App.root.innerHTML = `<div class="join"><h1 style="font-size:36px">الردهة</h1><div class="card"><div class="muted" style="text-align:center">كود الغرفة</div><div class="bigcode">${esc(L.code)}</div>
    <input type="text" id="link" readonly value="${esc(link)}" dir="ltr" style="font-size:13px;height:42px"><button class="btn sm" id="copy" style="width:100%">نسخ رابط الدعوة</button></div>
    <div class="card"><b>اللاعبون (${L.players.length} من ${L.max} — يلزم ${L.min} على الأقل)</b><div class="plist">${L.players.map((p) => `<div class="pitem"><span class="avatar" style="background:${COLORS[p.id]}">${esc(p.name.slice(0, 1))}</span>${esc(p.name)}${p.id === L.me ? ' (أنت)' : ''}<small>${p.bot ? 'آلي' : p.host ? 'المضيف' : p.connected ? '' : 'غير متصل'}</small>${host && p.id !== L.me ? `<button class="btn sm" data-kick="${p.id}">إزالة</button>` : ''}</div>`).join('')}</div>
    ${host ? `<button class="btn" id="bot" ${full ? 'disabled' : ''}>إضافة لاعب آلي 🤖</button>
      <div class="opts"><label>إظهار دور من يموت أو يُقصى <input type="checkbox" id="reveal" ${L.cfg.reveal ? 'checked' : ''} style="width:22px;height:22px"></label>
      <label>سرعة اللعبة <select id="spd">${[['slow', 'بطيئة'], ['normal', 'عادية'], ['fast', 'سريعة'], ['turbo', 'خاطفة']].map(([v, l]) => `<option value="${v}" ${v === App.speedV ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <button class="btn primary" id="start" ${enough ? '' : 'disabled'}>ابدأ اللعبة 🕵️</button>
      ${enough ? '' : '<span class="muted">يلزم 5 لاعبين على الأقل. أضف لاعبين آليين أو انتظر أصدقاءك.</span>'}`
    : '<div class="muted" style="text-align:center;padding:8px">بانتظار المضيف ليبدأ اللعبة...</div>'}</div>
    <div class="card"><b>الأدوار في هذه اللعبة</b><span class="muted">🔪 المافيا: تقتل ليلاً وتتخفى نهاراً. 💉 الطبيب: يحمي لاعباً كل ليلة. 🔎 المحقق: يتحقق من لاعب كل ليلة. 🧑 المواطن: يناقش ويصوّت. تُوزع الأدوار سراً عند البدء حسب عدد اللاعبين.</span></div>
    <button class="btn" id="leave">مغادرة الغرفة</button></div>`;
  $('#copy').onclick = () => { const i = $('#link'); i.select(); (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('تم النسخ'), () => { try { document.execCommand('copy'); toast('تم النسخ'); } catch (e) { toast('انسخ الرابط يدوياً'); } }); };
  $('#leave').onclick = () => { send({ t: 'leave' }); App.room = null; store.del('mf_room'); App.lobby = null; render(); };
  document.querySelectorAll('[data-kick]').forEach((b) => { b.onclick = () => send({ t: 'kick', id: +b.dataset.kick }); });
  if (host) {
    $('#bot').onclick = () => send({ t: 'addBot' });
    $('#start').onclick = () => send({ t: 'start' });
    $('#reveal').onchange = () => send({ t: 'cfg', reveal: $('#reveal').checked });
    $('#spd').onchange = () => { App.speedV = $('#spd').value; store.set('mf_speed', App.speedV); send({ t: 'speed', v: App.speedV }); };
  }
}
render();
})();
