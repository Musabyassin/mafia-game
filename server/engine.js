'use strict';
/* محرك لعبة المافيا: أدوار سرية، ليل (قتل/إنقاذ/تحقيق)، نهار (نقاش)، تصويت، فوز.
   المحرك موثوق وحتمي المنطق؛ الخادم يدير الغرف والمؤقتات والبث. */

const ROLES = {
  mafia:    { name: 'مافيا',    icon: '🔪', team: 'mafia', desc: 'اختر ضحية كل ليلة مع فريقك. هدفك: أن يصبح عدد المافيا مساوياً لعدد الأبرياء أو أكبر.' },
  doctor:   { name: 'طبيب',     icon: '💉', team: 'town',  desc: 'اختر شخصاً لحمايته كل ليلة (يمكنك حماية نفسك، لكن ليس نفس الشخص ليلتين متتاليتين).' },
  detective:{ name: 'محقق',     icon: '🔎', team: 'town',  desc: 'تحقق كل ليلة من لاعب لتعرف إن كان مافيا أم بريئاً، واستخدم معرفتك بحذر في النقاش.' },
  citizen:  { name: 'مواطن',    icon: '🧑', team: 'town',  desc: 'نام ليلاً، وناقش نهاراً، وصوّت لإقصاء من تشتبه بأنه مافيا.' },
};

/* الحد الأقصى المعقول للمافيا: أقل من نصف اللاعبين، ويبقى طبيب ومحقق ومواطن على الأقل */
function maxMafia(n) { return Math.max(1, Math.min(n - 3, Math.floor((n - 1) / 2))); }

/* توزيع الأدوار: تلقائي حسب العدد، أو بعدد مافيا يحدده المضيف (mafWanted) */
function roleDeck(n, mafWanted) {
  const table = { 4: 1, 5: 1, 6: 2, 7: 2, 8: 2, 9: 3, 10: 3, 11: 3, 12: 4 };
  let maf = table[n] || Math.max(1, Math.round(n / 4));
  if (Number.isInteger(mafWanted) && mafWanted >= 1) maf = mafWanted;
  maf = Math.max(1, Math.min(maf, maxMafia(n)));
  const deck = [];
  for (let i = 0; i < maf; i++) deck.push('mafia');
  deck.push('doctor', 'detective');
  for (let i = 0; i < n - maf - 2; i++) deck.push('citizen');
  return deck;
}

function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

class MafiaGame {
  /* players: [{name, bot}] — cfg: {reveal:true, speed:1} — io: {update(), event(e), private(pid, obj)} */
  constructor(players, cfg, io, rnd) {
    this.io = io; this.cfg = cfg || {}; this.rnd = rnd || Math.random;
    const deck = shuffle(roleDeck(players.length, this.cfg.mafia), this.rnd);
    this.S = {
      phase: 'night',          // night | day | vote | ended
      round: 1,
      over: false, winner: null, // 'mafia' | 'town'
      players: players.map((p, i) => ({ id: i, name: p.name, bot: !!p.bot, role: deck[i], alive: true })),
      log: [],                 // سجل عام يظهر للجميع
      lastNight: null,         // ملخص الليلة الماضية لعرض التلفاز
      voteTally: null,         // نتيجة آخر تصويت
    };
    this.night = null;         // {mafiaVotes:Map, doctor:null|id, detective:null|id, detectiveResult}
    this.votes = new Map();    // pid -> targetId | -1 (امتناع)
    this.ready = new Set();    // جاهزية النهار
    this.lastSave = null;      // آخر من حماه الطبيب (منع التكرار المتتالي)
    this.deadline = 0;
    this.stopped = false;
    this.timers = new Set();
    this.log(`🌙 بدأت اللعبة! وُزّعت الأدوار سراً على ${players.length} لاعبين.`);
    this.startNight(true);
  }

  /* ---------- أدوات ---------- */
  later(fn, ms) { if (this.stopped) return; const t = setTimeout(() => { this.timers.delete(t); if (!this.stopped) fn(); }, ms); this.timers.add(t); }
  stop() { this.stopped = true; this.timers.forEach(clearTimeout); this.timers.clear(); }
  log(m) { this.S.log.push(m); if (this.S.log.length > 120) this.S.log.splice(0, this.S.log.length - 120); }
  alive() { return this.S.players.filter((p) => p.alive); }
  aliveRole(role) { return this.S.players.filter((p) => p.alive && p.role === role); }
  speedMs(base) { const s = this.cfg.speed == null ? 1 : this.cfg.speed; return Math.round(base * s); }
  phaseDuration() {
    const ph = this.S.phase;
    if (ph === 'night') return this.speedMs(60000);
    if (ph === 'day') return this.speedMs(90000);
    if (ph === 'vote') return this.speedMs(45000);
    return 0;
  }
  armDeadline() { this.deadline = Date.now() + this.phaseDuration(); }

  /* ---------- الليل ---------- */
  startNight(first) {
    if (this.S.over) return;
    this.S.phase = 'night';
    if (!first) this.S.round++;
    this.night = { mafiaVotes: new Map(), doctor: null, detective: null };
    this.armDeadline();
    this.io.event({ e: 'phase', phase: 'night', round: this.S.round });
    this.log(`🌙 الليلة ${this.S.round}: المدينة تنام... المافيا والطبيب والمحقق يتحركون سراً.`);
    this.io.update();
    this.botsNight();
    this.later(() => this.phaseTimeout(), this.phaseDuration() + 60);
  }

  nightDone() {
    const n = this.night; if (!n) return true;
    const mafOk = this.aliveRole('mafia').every((p) => p.bot || n.mafiaVotes.has(p.id));
    const doc = this.aliveRole('doctor')[0];
    const det = this.aliveRole('detective')[0];
    const docOk = !doc || doc.bot || n.doctor !== null;
    const detOk = !det || det.bot || n.detective !== null;
    return mafOk && docOk && detOk;
  }

  /* فعل ليلي من هاتف لاعب: target = id */
  nightAct(pid, target) {
    const S = this.S; if (S.over || S.phase !== 'night') return false;
    const p = S.players[pid]; if (!p || !p.alive || p.bot) return false;
    const t = S.players[Number(target)]; if (!t || !t.alive || t.id === pid && p.role !== 'doctor') return false;
    if (p.role === 'mafia') {
      if (t.role === 'mafia') return false;
      this.night.mafiaVotes.set(pid, t.id);
    } else if (p.role === 'doctor') {
      if (this.lastSave === t.id) { this.io.private(pid, { t: 'ev', e: { e: 'toast', m: 'لا يمكنك حماية نفس الشخص ليلتين متتاليتين' } }); return false; }
      this.night.doctor = t.id;
    } else if (p.role === 'detective') {
      this.night.detective = t.id;
    } else return false;
    this.io.update();
    if (this.nightDone()) this.later(() => this.resolveNight(), 900);
    return true;
  }

  resolveNight() {
    const S = this.S; if (S.over || S.phase !== 'night' || !this.night) return;
    const n = this.night; this.night = null;
    /* ضحية المافيا: الأكثر تصويتاً بين المافيا، والتعادل يُحسم بأول تصويت */
    let victim = null, best = -1; const count = new Map();
    n.mafiaVotes.forEach((t) => count.set(t, (count.get(t) || 0) + 1));
    count.forEach((c, t) => { if (c > best) { best = c; victim = t; } });
    /* نتيجة المحقق (خاصة) */
    if (n.detective !== null && n.detective !== undefined) {
      const det = this.aliveRole('detective')[0];
      const tp = S.players[n.detective];
      if (det && tp) this.io.private(det.id, { t: 'investigate', target: tp.id, name: tp.name, isMafia: tp.role === 'mafia' });
      if (det) { det.known = det.known || {}; if (tp) det.known[tp.id] = tp.role === 'mafia'; }
    }
    this.lastSave = n.doctor;
    let died = null, saved = false;
    if (victim !== null && victim !== undefined) {
      if (n.doctor === victim) saved = true;
      else { died = S.players[victim]; died.alive = false; }
    }
    S.lastNight = { round: S.round, died: died ? died.id : null, saved };
    if (died) this.log(`☀️ صباح الليلة ${S.round}: وُجد ${died.name} مقتولاً! ${this.cfg.reveal ? `كان دوره: ${ROLES[died.role].icon} ${ROLES[died.role].name}.` : ''}`);
    else if (victim !== null && saved) this.log(`☀️ صباح الليلة ${S.round}: هاجمت المافيا أحدَهم لكن الطبيب أنقذه! لا قتلى الليلة.`);
    else this.log(`☀️ صباح الليلة ${S.round}: مرّت الليلة بسلام، لا قتلى.`);
    this.io.event({ e: 'morning', died: died ? died.id : null, saved });
    if (this.checkWin()) return;
    this.startDay();
  }

  /* ---------- النهار ---------- */
  startDay() {
    const S = this.S; if (S.over) return;
    S.phase = 'day'; this.ready = new Set();
    this.armDeadline();
    this.io.event({ e: 'phase', phase: 'day', round: S.round });
    this.log(`💬 نهار اليوم ${S.round}: ناقشوا وتبادلوا الاتهامات، ثم اضغطوا «جاهز للتصويت».`);
    this.io.update();
    this.alive().forEach((p) => { if (p.bot) this.ready.add(p.id); });
    this.later(() => this.phaseTimeout(), this.phaseDuration() + 60);
  }
  dayReady(pid) {
    const S = this.S; if (S.over || S.phase !== 'day') return false;
    const p = S.players[pid]; if (!p || !p.alive || p.bot) return false;
    this.ready.add(pid); this.io.update();
    if (this.alive().every((x) => this.ready.has(x.id))) this.startVote();
    return true;
  }

  /* ---------- التصويت ---------- */
  startVote() {
    const S = this.S; if (S.over || S.phase === 'vote') return;
    S.phase = 'vote'; this.votes = new Map(); S.voteTally = null;
    this.armDeadline();
    this.io.event({ e: 'phase', phase: 'vote', round: S.round });
    this.log(`🗳️ وقت التصويت! اختاروا من تريدون إقصاءه (أو امتنعوا).`);
    this.io.update();
    this.botsVote();
    if (this.votesDone()) this.later(() => this.resolveVote(), 900);
  }
  votesDone() { return this.alive().every((p) => this.votes.has(p.id)); }
  vote(pid, target) {
    const S = this.S; if (S.over || S.phase !== 'vote') return false;
    const p = S.players[pid]; if (!p || !p.alive || p.bot) return false;
    const t = Number(target);
    if (t !== -1) { const tp = S.players[t]; if (!tp || !tp.alive || tp.id === pid) return false; }
    this.votes.set(pid, t);
    this.io.update();
    if (this.votesDone()) this.later(() => this.resolveVote(), 900);
    return true;
  }
  resolveVote() {
    const S = this.S; if (S.over || S.phase !== 'vote') return;
    const count = new Map(); let abstain = 0;
    this.votes.forEach((t) => { if (t === -1) abstain++; else count.set(t, (count.get(t) || 0) + 1); });
    let top = null, best = 0, tie = false;
    count.forEach((c, t) => { if (c > best) { best = c; top = t; tie = false; } else if (c === best) tie = true; });
    const detail = [...count.entries()].map(([t, c]) => `${S.players[t].name}: ${c}`).join('، ');
    S.voteTally = { detail, abstain, out: tie ? null : top, counts: Object.fromEntries(count) };
    if (top === null || tie || best === 0) {
      this.log(`🗳️ نتيجة التصويت (${detail || 'لا أصوات'}${abstain ? `، امتناع: ${abstain}` : ''}) — ${best === 0 ? 'لا إقصاء اليوم.' : 'تعادل! لا إقصاء اليوم.'}`);
      this.io.event({ e: 'voteResult', out: null });
    } else {
      const out = S.players[top]; out.alive = false;
      this.log(`🗳️ نتيجة التصويت (${detail}${abstain ? `، امتناع: ${abstain}` : ''}) — أُقصي ${out.name}! ${this.cfg.reveal ? `كان دوره: ${ROLES[out.role].icon} ${ROLES[out.role].name}.` : ''}`);
      this.io.event({ e: 'voteResult', out: out.id });
    }
    this.votes = new Map();
    if (this.checkWin()) return;
    this.startNight();
  }

  /* ---------- الفوز ---------- */
  checkWin() {
    const S = this.S;
    const maf = this.aliveRole('mafia').length, town = this.alive().length - maf;
    let winner = null;
    if (maf === 0) winner = 'town';
    else if (maf >= town) winner = 'mafia';
    if (!winner) return false;
    S.over = true; S.phase = 'ended'; S.winner = winner;
    this.log(winner === 'town' ? `🏆 انتهت اللعبة: فاز الأبرياء! قضوا على المافيا كلها.` : `🏆 انتهت اللعبة: فازت المافيا! سيطرت على المدينة.`);
    this.io.event({ e: 'gameover', winner });
    this.io.update();
    return true;
  }

  phaseTimeout() {
    if (this.S.over) return;
    if (this.S.phase === 'night') this.resolveNight();
    else if (this.S.phase === 'day') this.startVote();
    else if (this.S.phase === 'vote') this.resolveVote();
  }

  /* ---------- اللاعبون الآليون ---------- */
  pickRandom(list) { return list.length ? list[Math.floor(this.rnd() * list.length)] : null; }
  botsNight() {
    const S = this.S, n = this.night; if (!n) return;
    const nonMafia = this.alive().filter((p) => p.role !== 'mafia');
    this.alive().filter((p) => p.bot).forEach((p, i) => {
      this.later(() => {
        if (this.S.phase !== 'night' || !this.night || !p.alive) return;
        if (p.role === 'mafia') { const t = this.pickRandom(nonMafia.filter((x) => x.alive)); if (t) this.night.mafiaVotes.set(p.id, t.id); }
        else if (p.role === 'doctor') { const cand = this.alive().filter((x) => x.id !== this.lastSave); const t = this.pickRandom(cand); if (t) this.night.doctor = t.id; }
        else if (p.role === 'detective') { const cand = this.alive().filter((x) => x.id !== p.id && !(p.known && p.known[x.id] !== undefined)); const t = this.pickRandom(cand); if (t) { this.night.detective = t.id; } }
        this.io.update();
        if (this.nightDone()) this.later(() => this.resolveNight(), 700);
      }, 700 + i * 450 + this.rnd() * 600);
    });
  }
  botsVote() {
    this.alive().filter((p) => p.bot).forEach((p, i) => {
      this.later(() => {
        if (this.S.phase !== 'vote' || !p.alive) return;
        let t;
        if (p.role === 'mafia') t = this.pickRandom(this.alive().filter((x) => x.role !== 'mafia' && x.id !== p.id));
        else if (p.role === 'detective' && p.known) { const knownMaf = Object.keys(p.known).filter((id) => p.known[id] && this.S.players[id].alive); t = knownMaf.length ? this.S.players[knownMaf[0]] : this.pickRandom(this.alive().filter((x) => x.id !== p.id && x.role !== 'mafia')); }
        else t = this.pickRandom(this.alive().filter((x) => x.id !== p.id));
        this.votes.set(p.id, t ? t.id : -1);
        this.io.update();
        if (this.votesDone()) this.later(() => this.resolveVote(), 700);
      }, 800 + i * 500 + this.rnd() * 700);
    });
  }

  /* ---------- اللقطات ---------- */
  /* viewer: id لاعب أو null للتلفاز/المشاهد. الأسرار لا تخرج إلا لصاحبها:
     دور اللاعب نفسه، زملاء المافيا للمافيا فقط، ومعرفة المحقق له وحده.
     الأموات يرون كل الأدوار (انتهت مشاركتهم). */
  snapshot(viewer) {
    const S = this.S;
    const me = viewer === null || viewer === undefined ? null : S.players[viewer];
    const meDead = !!(me && !me.alive);
    const revealAll = S.over || meDead;
    const players = S.players.map((p) => {
      const out = { id: p.id, name: p.name, bot: p.bot, alive: p.alive };
      const canSee = revealAll || (me && p.id === me.id) || (me && me.alive && me.role === 'mafia' && p.role === 'mafia') || (!p.alive && this.cfg.reveal);
      if (canSee) out.role = p.role;
      if (S.phase === 'vote') out.voted = this.votes.has(p.id);
      if (S.phase === 'day') out.ready = this.ready.has(p.id);
      return out;
    });
    const snap = {
      phase: S.phase, round: S.round, over: S.over, winner: S.winner,
      players, log: S.log.slice(-40), lastNight: S.lastNight, voteTally: S.voteTally,
      deadline: this.deadline, serverNow: Date.now(),
      counts: { alive: this.alive().length, mafiaAlive: revealAll ? this.aliveRole('mafia').length : undefined },
    };
    if (me) {
      snap.me = { id: me.id, role: me.role, alive: me.alive, known: me.known || {} };
      if (me.role === 'doctor') snap.me.lastSave = this.lastSave;
      snap.nightState = S.phase === 'night' && this.night ? {
        acted: me.role === 'mafia' ? this.night.mafiaVotes.has(me.id) : me.role === 'doctor' ? this.night.doctor !== null : me.role === 'detective' ? this.night.detective !== null : true,
        myTarget: me.role === 'mafia' ? this.night.mafiaVotes.get(me.id) : me.role === 'doctor' ? this.night.doctor : me.role === 'detective' ? this.night.detective : null,
        mafiaVotes: me.role === 'mafia' ? [...this.night.mafiaVotes.entries()].map(([k, v]) => ({ by: k, target: v })) : undefined,
      } : null;
      snap.myVote = S.phase === 'vote' ? (this.votes.has(me.id) ? this.votes.get(me.id) : null) : null;
      snap.myReady = S.phase === 'day' ? this.ready.has(me.id) : false;
    }
    return snap;
  }
}

module.exports = { MafiaGame, ROLES, roleDeck, maxMafia };
