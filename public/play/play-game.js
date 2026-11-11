/* شاشات اللعب على الهاتف: الدور السري، أفعال الليل، النقاش، التصويت، الشات، السجل، الإعدادات */
(() => {
'use strict';
const App = window.App, $ = App.$, esc = App.esc, COLORS = App.COLORS, store = App.store, CHARS = App.CHARS;
const ROLE = {
  mafia: { n: 'مافيا', ic: '🔪', desc: 'اختر ضحية كل ليلة مع فريقك، وتخفَّ في النقاش نهاراً. تفوز إذا صار عدد المافيا مساوياً للأبرياء أو أكثر.' },
  doctor: { n: 'طبيب', ic: '💉', desc: 'اختر لاعباً لحمايته كل ليلة (يمكنك حماية نفسك، لكن ليس نفس الشخص ليلتين متتاليتين).' },
  detective: { n: 'محقق', ic: '🔎', desc: 'تحقق كل ليلة من لاعب لتعرف إن كان مافيا أم بريئاً. استخدم معرفتك بحذر حتى لا تنكشف للمافيا.' },
  citizen: { n: 'مواطن', ic: '🧑', desc: 'نام ليلاً، وناقش واتهم نهاراً، وصوّت لإقصاء من تشتبه به. تفوز المدينة بإقصاء المافيا كلها.' },
};
const PH = { night: ['🌙', 'الليل', 'phasebanner night'], day: ['☀️', 'نهار النقاش', 'phasebanner day'], vote: ['🗳️', 'التصويت', 'phasebanner vote'], ended: ['🏆', 'انتهت اللعبة', 'phasebanner'] };

App.onChat = (e) => {
  App.chat.push({ id: e.id, n: e.n, m: e.m, ch: e.ch });
  if (App.chat.length > 80) App.chat.splice(0, App.chat.length - 80);
  if (App.tab !== 'chat') App.chatUnread++;
  App.render();
};

/* عدّاد المرحلة دون إعادة رسم كاملة */
setInterval(() => {
  const S = App.st && App.st.s; if (!S || S.over || !S.deadline) return;
  const left = Math.max(0, S.deadline - (Date.now() - App.offset));
  const t = $('#ttext'), f = $('#tfill');
  if (t) t.textContent = Math.ceil(left / 1000) + ' ث';
  if (f && App.totalMs) f.style.width = Math.round(left / App.totalMs * 100) + '%';
}, 500);

function playersList(S, opts) {
  opts = opts || {};
  return `<div class="tgrid">${S.players.map((p) => {
    const r = p.role ? ROLE[p.role] : null;
    let st = '';
    if (!p.alive) st = '<span class="stamp">مات</span> ' + (r ? 'كان ' + r.ic + ' ' + r.n : '');
    else if (S.phase === 'vote') st = p.voted ? '✔ صوّت' : '...';
    else if (S.phase === 'day') st = p.ready ? '✔ جاهز' : '';
    const sel = opts.selected === p.id ? ' sel' : '';
    const dis = opts.disabled || !p.alive || p.id === (opts.exceptSelf ? S.me.id : -99);
    const inner = `<span class="avatar charf" style="background:${COLORS[p.id]}">${CHARS[p.id] || '🧑'}</span><span style="flex:1">${esc(p.name)}${p.bot ? ' 🤖' : ''}${S.me && p.id === S.me.id ? ' (أنت)' : ''}${r && p.alive ? ` — ${r.ic} ${r.n}` : ''}</span><small class="muted">${st}</small>`;
    if (opts.action) return `<button class="tbtn${sel}" data-act="${opts.action}" data-id="${p.id}" ${dis ? 'disabled' : ''}>${inner}</button>`;
    return `<div class="tbtn" style="cursor:default">${inner}</div>`;
  }).join('')}</div>`;
}

function gameView() {
  const S = App.st.s, me = S.me, spec = App.spectator || !me;
  App.totalMs = App.totalMs && App.lastTotalPhase === S.phase + S.round ? App.totalMs : Math.max(1, S.deadline - S.serverNow);
  App.lastTotalPhase = S.phase + S.round;
  const ph = PH[S.phase];
  let h = '';
  /* بطاقة الدور السري */
  if (me) {
    const r = ROLE[me.role];
    const team = me.role === 'mafia' ? S.players.filter((p) => p.role === 'mafia' && p.id !== me.id) : [];
    h += `<div class="rolecard ${me.role}"><div class="ric">${r.ic}</div><div class="rn">أنت: ${r.n}</div><div class="muted">${r.desc}</div>
      ${team.length ? `<div style="margin-top:6px"><b>فريق المافيا معك:</b> ${team.map((p) => esc(p.name)).join('، ')}</div>` : ''}
      ${me.role === 'detective' && Object.keys(me.known || {}).length ? `<div style="margin-top:6px"><b>🔎 نتائج تحقيقاتك:</b> ${Object.keys(me.known).map((id) => `${esc(S.players[id].name)}: ${me.known[id] ? 'مافيا 🔪' : 'بريء ✅'}`).join(' · ')}</div>` : ''}
      ${!me.alive ? '<div style="margin-top:6px"><b>💀 أنت ميت</b> — ترى كل الأدوار الآن، وتراقب حتى النهاية. شاتك خاص بالأموات.</div>' : ''}</div>`;
  } else h += `<div class="rolecard"><div class="ric">👁</div><div class="rn">مشاهد</div><div class="muted">تتابع اللعبة دون مقعد لعب. الأدوار تبقى سرية عنك حتى يموت أصحابها أو تنتهي اللعبة.</div></div>`;
  /* شريط المرحلة والمؤقت */
  h += `<div class="${ph[2]}"><span class="floaty">${ph[0]}</span> ${ph[1]} — الجولة ${S.round}${S.over ? '' : ` · <span id="ttext"></span>`}</div>`;
  if (!S.over) h += `<div class="timerbar"><i id="tfill"></i></div>`;
  if (S.lastNight && S.phase !== 'night') h += `<div class="card anim-in" style="text-align:center"><b>${S.lastNight.died !== null && S.lastNight.died !== undefined ? `💀 ضحية الليلة ${S.lastNight.round}: ${esc(S.players[S.lastNight.died].name)}` : `🕊 الليلة ${S.lastNight.round}: ${S.lastNight.saved ? 'الطبيب أنقذ الضحية!' : 'لا قتلى'}`}</b></div>`;

  if (S.voteTally && S.voteTally.counts && S.phase !== 'vote') {
    const rows = Object.entries(S.voteTally.counts).map(([id, c]) => ({ id: +id, c })).sort((a, b) => b.c - a.c);
    const max = Math.max(1, ...rows.map((r) => r.c));
    h += `<div class="card anim-in"><b>🗳️ نتيجة آخر تصويت</b><div class="tally">${rows.map((r) => `<div class="trow ${S.voteTally.out === r.id ? 'out' : ''}"><span class="nm">${CHARS[r.id] || ''} ${esc(S.players[r.id].name)}${S.voteTally.out === r.id ? ' — أُقصي' : ''}</span><span class="track"><span class="fill" style="width:${Math.round(r.c / max * 100)}%"></span></span><span class="cnt">${r.c}</span></div>`).join('')}${S.voteTally.abstain ? `<div class="muted">امتنع ${S.voteTally.abstain} عن التصويت</div>` : ''}</div></div>`;
  }

  /* منطقة الفعل */
  if (S.over) {
    const confetti = Array.from({ length: 16 }, (_, i) => `<i style="left:${(i * 61) % 100}%;background:${['#e8b33c', '#e0453a', '#3ec97e', '#4da3ff', '#a678ff'][i % 5]};animation-duration:${2.6 + (i % 5) * 0.5}s;animation-delay:${(i % 7) * 0.35}s"></i>`).join('');
    h += `<div class="card" style="text-align:center;position:relative;overflow:hidden"><div class="confetti">${confetti}</div><div style="font-size:44px">${S.winner === 'town' ? '🏆' : '🔪'}</div><b style="font-size:20px">${S.winner === 'town' ? 'فاز الأبرياء!' : 'فازت المافيا!'}</b><span class="muted">انكشفت كل الأدوار في القائمة بالأسفل.</span>${App.st.host ? '<button class="btn primary" id="again">لعبة جديدة (عودة للردهة)</button>' : '<span class="muted">بانتظار المضيف لبدء لعبة جديدة...</span>'}</div>`;
  } else if (spec) {
    h += `<div class="card" style="text-align:center"><span class="muted">وضع المشاهدة — اللاعبون يتحركون من هواتفهم.</span></div>`;
  } else if (!me.alive) {
    h += `<div class="card" style="text-align:center"><span class="muted">💀 خرجت من اللعبة. راقب النقاش والتصويت، واستخدم «شات الأموات» مع من ماتوا مثلك.</span></div>`;
  } else if (S.phase === 'night') {
    const ns = S.nightState || {};
    if (me.role === 'citizen') h += `<div class="card" style="text-align:center"><div style="font-size:40px">😴</div><b>أنت نائم...</b><span class="muted">المافيا والطبيب والمحقق يتحركون الآن سراً. انتظر الصباح.</span></div>`;
    else {
      const labels = { mafia: '🔪 اختر ضحية المافيا الليلة', doctor: '💉 اختر من تحميه الليلة', detective: '🔎 اختر من تتحقق منه الليلة' };
      h += `<div class="card ${ns.acted ? '' : 'act-now'}"><b>${labels[me.role]}</b>${me.role === 'mafia' && ns.mafiaVotes && ns.mafiaVotes.length ? `<span class="muted">أصوات فريقك حتى الآن: ${ns.mafiaVotes.map((v) => `${esc(S.players[v.by].name)} ← ${esc(S.players[v.target].name)}`).join('، ')}</span>` : ''}${me.role === 'doctor' && me.lastSave !== null && me.lastSave !== undefined ? `<span class="muted">حميتَ البارحة: ${esc(S.players[me.lastSave].name)} — لا يمكنك حمايته الليلة أيضاً.</span>` : ''}`;
      const targets = S.players.filter((p) => p.alive && (me.role === 'doctor' ? true : p.id !== me.id) && (me.role === 'mafia' ? p.role !== 'mafia' : true));
      h += `<div class="tgrid">${targets.map((p) => `<button class="tbtn ${ns.myTarget === p.id ? 'sel' : ''}" data-night="${p.id}"><span class="avatar charf" style="background:${COLORS[p.id]}">${CHARS[p.id] || '🧑'}</span><span style="flex:1">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span>${ns.myTarget === p.id ? '<small>✔ اختيارك</small>' : ''}</button>`).join('')}</div>`;
      h += ns.acted ? '<span class="muted">✔ تم تسجيل اختيارك — يمكنك تغييره حتى ينتهي الليل. بانتظار بقية الأدوار...</span>' : '<span class="muted">اختر هدفك قبل انتهاء المؤقت.</span>';
      h += '</div>';
    }
  } else if (S.phase === 'day') {
    h += `<div class="card ${S.myReady ? '' : 'act-now'}"><b>💬 وقت النقاش</b><span class="muted">ناقشوا بصوت عالٍ إن كنتم معاً، أو في تبويب الشات. اتهموا وبرروا... وعندما تنتهون اضغط الزر.</span>${S.myReady ? '<span class="muted">✔ أنت جاهز — بانتظار البقية.</span>' : '<button class="btn primary" id="ready">جاهز للتصويت 🗳️</button>'}</div>`;
  } else if (S.phase === 'vote') {
    h += `<div class="card ${S.myVote === null || S.myVote === undefined ? 'act-now' : ''}"><b>🗳️ صوّت لإقصاء من تشتبه به</b><div class="tgrid">${S.players.filter((p) => p.alive && p.id !== me.id).map((p) => `<button class="tbtn ${S.myVote === p.id ? 'sel' : ''}" data-vote="${p.id}"><span class="avatar charf" style="background:${COLORS[p.id]}">${CHARS[p.id] || '🧑'}</span><span style="flex:1">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span>${S.myVote === p.id ? '<small>✔ صوتك</small>' : ''}</button>`).join('')}</div><button class="btn ${S.myVote === -1 ? 'primary' : ''}" id="abstain">امتناع عن التصويت</button>${S.myVote !== null && S.myVote !== undefined ? '<span class="muted">✔ تم تسجيل صوتك — يمكنك تغييره حتى ينتهي التصويت.</span>' : ''}</div>`;
  }
  /* قائمة اللاعبين */
  h += `<div class="card"><b>اللاعبون (${S.players.filter((p) => p.alive).length} أحياء من ${S.players.length})</b>${playersList(S)}</div>`;
  App.root.innerHTML = `<div class="view">${h}</div>`;
  document.querySelectorAll('[data-night]').forEach((b) => { b.onclick = () => App.send({ t: 'night', target: +b.dataset.night }); });
  document.querySelectorAll('[data-vote]').forEach((b) => { b.onclick = () => App.send({ t: 'vote', target: +b.dataset.vote }); });
  const r = $('#ready'); if (r) r.onclick = () => App.send({ t: 'ready' });
  const a = $('#abstain'); if (a) a.onclick = () => App.send({ t: 'vote', target: -1 });
  const ag = $('#again'); if (ag) ag.onclick = () => App.send({ t: 'again' });
}

function chatView() {
  const S = App.st.s, me = S.me;
  let hint = 'الشات العام — يراه الجميع والتلفاز';
  if (me && !me.alive) hint = '💀 شات الأموات — لا يراه الأحياء';
  else if (S.phase === 'night' && me && me.role === 'mafia') hint = '🔪 شات المافيا السري — لفريقك فقط، خططوا لضحيتكم';
  else if (S.phase === 'night') hint = '🌙 الليل: الأبرياء نائمون ولا شات لهم الآن';
  const list = App.chat.filter((c) => {
    if (me && !me.alive) return c.ch === 'dead' || c.ch === 'public';
    if (S.phase === 'night' && me && me.role === 'mafia') return c.ch === 'mafia' || c.ch === 'public';
    return c.ch === 'public';
  });
  App.root.innerHTML = `<div class="view" style="display:flex;flex-direction:column;height:100%"><div class="phasebanner">${esc(hint)}</div>
    <div class="chatlist" id="clist" style="flex:1;min-height:200px">${list.length ? list.map((c) => `<div class="cmsg ${c.id === App.me ? 'me' : ''} ${c.ch && c.ch !== 'public' ? 'ch-' + c.ch : ''}"><small>${esc(c.n)}${c.ch === 'mafia' ? ' · مافيا' : c.ch === 'dead' ? ' · ميت' : ''}</small>${esc(c.m)}</div>`).join('') : '<div class="muted" style="text-align:center">لا رسائل بعد في هذه القناة.</div>'}</div>
    <div class="chatbar"><input type="text" id="cin" maxlength="300" placeholder="اكتب رسالتك..." autocomplete="off"><button class="btn primary" id="csend">إرسال</button></div></div>`;
  const cl = $('#clist'); if (cl) cl.scrollTop = cl.scrollHeight;
  const sendChat = () => { const i = $('#cin'); const v = i.value.trim(); if (!v) return; App.send({ t: 'chat', m: v }); i.value = ''; };
  $('#csend').onclick = sendChat;
  $('#cin').onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };
}

function logView() {
  const S = App.st.s;
  App.root.innerHTML = `<div class="view"><div class="card"><b>📜 سجل اللعبة</b><div class="logbox">${S.log.slice().reverse().map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></div>`;
}

function settingsView() {
  const host = !!App.st.host;
  App.root.innerHTML = `<div class="view"><div class="card"><b>⚙️ الإعدادات</b>
    <div class="setrow"><span>الصوت</span><label class="switch"><input type="checkbox" id="swSound" ${store.get('mf_mute') === '1' ? '' : 'checked'}><i></i></label></div>
    <div class="setrow"><span>الاهتزاز عند تغيّر المرحلة</span><label class="switch"><input type="checkbox" id="swVib" ${store.get('mf_vib') === '0' ? '' : 'checked'}><i></i></label></div>
    ${host ? `<div class="setrow"><span>سرعة اللعبة (أطوال المراحل)</span><select id="spd" style="width:auto;height:40px">${[['slow', 'بطيئة'], ['normal', 'عادية'], ['fast', 'سريعة'], ['turbo', 'خاطفة']].map(([v, l]) => `<option value="${v}" ${v === App.speedV ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
    <div class="setrow"><span>كود الغرفة</span><b style="color:var(--accent);letter-spacing:.15em">${esc(App.st.code)}</b></div>
    </div>
    <button class="btn danger" id="leave">مغادرة الغرفة</button>
    <div class="card"><b>كيف تُلعب؟</b><span class="muted">🌙 الليل: المافيا تختار ضحية، الطبيب يحمي لاعباً، المحقق يتحقق من لاعب — كلٌّ من هاتفه سراً.<br>☀️ النهار: نقاش واتهامات، ثم تصويت لإقصاء مشتبه به؛ التعادل يعني لا إقصاء.<br>🏆 يفوز الأبرياء بإقصاء المافيا كلها، وتفوز المافيا إذا صار عددها مساوياً للأبرياء أو أكثر.</span></div></div>`;
  $('#swSound').onchange = (e) => { store.set('mf_mute', e.target.checked ? '0' : '1'); Sfx.setMuted(!e.target.checked); };
  $('#swVib').onchange = (e) => store.set('mf_vib', e.target.checked ? '1' : '0');
  const spd = $('#spd'); if (spd) spd.onchange = () => { App.speedV = spd.value; store.set('mf_speed', App.speedV); App.send({ t: 'speed', v: App.speedV }); App.toast('تم ضبط السرعة — تسري من المرحلة التالية'); };
  $('#leave').onclick = () => { App.send({ t: 'leave' }); App.room = null; store.del('mf_room'); App.st = null; App.lobby = null; App.tab = 'game'; App.render(); };
}

App.renderGame = () => {
  if (App.tab === 'chat') chatView();
  else if (App.tab === 'log') logView();
  else if (App.tab === 'settings') settingsView();
  else gameView();
};
})();
