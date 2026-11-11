'use strict';
/* محاكاة كاملة: تلفاز + 5 هواتف بشرية + لاعب آلي، لعبة كاملة حتى الفوز،
   مع فحص سرية الأدوار وقنوات الشات والمشاهد. التشغيل: npm test */
process.env.PORT = '3457';
const assert = require('assert');
const WebSocket = require('ws');
const { server, rooms } = require('../server.js');

const URL = 'ws://127.0.0.1:3457/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name) { this.name = name; this.msgs = []; this.state = null; this.lobby = null; this.chatEv = []; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', res); this.ws.on('error', rej);
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        this.msgs.push(m);
        if (m.t === 'state') this.state = m;
        if (m.t === 'lobby') this.lobby = m;
        if (m.t === 'ev' && m.e.e === 'chat') this.chatEv.push(m.e);
        if (m.t === 'created') this.code = m.code;
        if (m.t === 'joined') { this.joined = m; if (m.code) this.code = m.code; }
      });
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  waitFor(fn, timeout, label) {
    return new Promise((res, rej) => {
      const t0 = Date.now();
      const iv = setInterval(() => { const v = fn(); if (v) { clearInterval(iv); res(v); } else if (Date.now() - t0 > (timeout || 10000)) { clearInterval(iv); rej(new Error('timeout: ' + (label || ''))); } }, 60);
    });
  }
}

function actFor(c) {
  const st = c.state; if (!st || !st.s || st.s.over) return;
  const S = st.s, me = S.me; if (!me || !me.alive) return;
  const key = S.phase + ':' + S.round;
  if (c.actedKey === key) return;
  const rnd = (list) => list[Math.floor(Math.random() * list.length)];
  if (S.phase === 'night') {
    if (me.role === 'citizen') { c.actedKey = key; return; }
    let targets = [];
    if (me.role === 'mafia') targets = S.players.filter((p) => p.alive && p.role !== 'mafia');
    else if (me.role === 'doctor') targets = S.players.filter((p) => p.alive && p.id !== me.lastSave);
    else if (me.role === 'detective') targets = S.players.filter((p) => p.alive && p.id !== me.id && !(me.known && me.known[p.id] !== undefined));
    if (!targets.length) targets = S.players.filter((p) => p.alive && p.id !== me.id);
    if (targets.length) { c.send({ t: 'night', target: rnd(targets).id }); c.actedKey = key; }
  } else if (S.phase === 'day') {
    c.send({ t: 'ready' }); c.actedKey = key;
  } else if (S.phase === 'vote') {
    const targets = S.players.filter((p) => p.alive && p.id !== me.id);
    if (targets.length) { c.send({ t: 'vote', target: rnd(targets).id }); c.actedKey = key; }
  }
}

(async () => {
  await new Promise((r) => server.listen(3457, r));
  let failures = 0;
  const check = (cond, label) => { if (cond) console.log('  ✔', label); else { failures++; console.log('  ✘ فشل:', label); } };

  const tv = new Client('TV'); await tv.connect(); tv.send({ t: 'create', role: 'tv' });
  await tv.waitFor(() => tv.code, 5000, 'tv code');
  const code = tv.code; console.log('كود الغرفة:', code);

  const names = ['أحمد', 'بدر', 'جنى', 'حسن', 'دانا'];
  const phones = [];
  for (const n of names) {
    const c = new Client(n); await c.connect(); c.send({ t: 'join', code, name: n });
    await c.waitFor(() => c.joined && !c.joined.spectator, 5000, 'join ' + n);
    phones.push(c);
  }
  const host = phones[0];
  await host.waitFor(() => host.lobby && host.lobby.players.length === 5, 5000, 'lobby 5');
  host.send({ t: 'addBot' });
  await host.waitFor(() => host.lobby && host.lobby.players.length === 6, 5000, 'bot added');
  check(host.lobby.players.length === 6, 'الردهة: 5 بشر + آلي = 6');
  host.send({ t: 'speed', v: 'turbo' });
  host.send({ t: 'cfg', reveal: true });
  host.send({ t: 'start' });
  await host.waitFor(() => host.state && host.state.s, 5000, 'game start');

  /* فحص توزيع الأدوار والسرية */
  const S0 = host.state.s;
  check(S0.players.length === 6, 'بدأت اللعبة بـ6 لاعبين');
  const myRole = host.state.s.me.role;
  check(!!myRole, 'المضيف يعرف دوره: ' + myRole);
  const citizen = phones.find((c) => c.state && c.state.s.me.role === 'citizen');
  if (citizen) {
    const others = citizen.state.s.players.filter((p) => p.id !== citizen.state.s.me.id && p.alive);
    check(others.every((p) => p.role === undefined), 'المواطن لا يرى أي دور لغيره (السرية سليمة)');
  } else console.log('  (لا مواطن بين البشر في هذه الجولة — تخطي فحص سرية المواطن)');
  const mafiaC = phones.find((c) => c.state && c.state.s.me.role === 'mafia');
  if (mafiaC) {
    const mates = mafiaC.state.s.players.filter((p) => p.role === 'mafia');
    check(mates.length === 2, 'المافيا ترى زميلها (مافيا 6 لاعبين = 2)');
    /* شات المافيا الليلي لا يصل المواطنين */
    const before = phones.map((c) => c.chatEv.length);
    mafiaC.send({ t: 'chat', m: 'خطتنا سرية' });
    await sleep(700);
    const leaked = phones.some((c, i) => c !== mafiaC && !(c.state && c.state.s.me.role === 'mafia') && c.chatEv.length > before[i]);
    check(!leaked, 'شات المافيا الليلي لا يتسرب لغير المافيا');
  } else console.log('  (المافيا كلها آلية/غير بشرية — تخطي فحوص المافيا)');

  /* مشاهد ينضم بعد البدء */
  const spec = new Client('مشاهد'); await spec.connect(); spec.send({ t: 'join', code, name: 'زائر' });
  await spec.waitFor(() => spec.joined && spec.joined.spectator, 5000, 'spectator join');
  check(true, 'من ينضم بعد بدء اللعبة يدخل مشاهداً');

  /* لعب حتى النهاية */
  const iv = setInterval(() => phones.forEach(actFor), 250);
  const endState = await host.waitFor(() => host.state && host.state.s.over ? host.state : null, 180000, 'game over').catch((e) => null);
  clearInterval(iv);
  check(!!endState, 'وصلت اللعبة إلى نهاية');
  if (endState) {
    const S = endState.s;
    check(['mafia', 'town'].includes(S.winner), 'الفائز محدد: ' + S.winner);
    check(S.players.every((p) => p.role), 'بعد النهاية انكشفت كل الأدوار');
    const mafAlive = S.players.filter((p) => p.alive && p.role === 'mafia').length;
    const townAlive = S.players.filter((p) => p.alive && p.role !== 'mafia').length;
    check(S.winner === 'town' ? mafAlive === 0 : mafAlive >= townAlive, 'شرط الفوز متسق مع الحالة النهائية');
    console.log('  الجولات:', S.round, '| السجل:', S.log.length, 'حدثاً');
    host.send({ t: 'again' });
    await host.waitFor(() => host.lobby, 5000, 'back to lobby');
    check(true, '«لعبة جديدة» تعيد الجميع للردهة');
  }

  console.log(failures ? `\nالنتيجة: ${failures} فشل` : '\nالنتيجة: كل الفحوص ناجحة ✔');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('خطأ:', e.message); process.exit(1); });
