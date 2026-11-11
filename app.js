'use strict';
/* Marginalia — local-first reading tracker. Data lives in localStorage; optional Google Drive sync. */

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const dstr = d => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => dstr(new Date());
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return dstr(d); };
const nice = s => s ? pd(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS = { reading: 'Currently reading', want: 'Want to read', read: 'Read', dnf: 'Did not finish' };
const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };

// ---------- state ----------
const KEY = 'marginalia.v1';
const blank = () => ({ settings: { wpp: 275, goodreadsUrl: '', clientId: '' }, goals: {}, books: [], sessions: [], quotes: [], speedTests: [], timer: null, updated: 0 });
const normalize = o => { const b = blank(); return { ...b, ...o, settings: { ...b.settings, ...(o.settings || {}) } }; };
let S = blank();
try { const raw = localStorage.getItem(KEY); if (raw) S = normalize(JSON.parse(raw)); } catch (e) { console.warn(e); }

function persist() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save — browser storage is full or blocked.'); } }
function save() { S.updated = Date.now(); persist(); render(); scheduleSync(); }
const book = id => S.books.find(b => b.id === id);
const goalFor = y => S.goals[y] || 12;

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500); }

// ---------- metrics ----------
function metrics() {
  const now = new Date(), Y = now.getFullYear(), t = today();
  const jan1 = new Date(Y, 0, 1), diy = (new Date(Y + 1, 0, 1) - jan1) / 864e5;
  const doy = Math.round((pd(t) - jan1) / 864e5) + 1, daysLeft = diy - doy + 1;
  const goal = goalFor(Y);
  const read = S.books.filter(b => b.status === 'read');
  const done = read.filter(b => (b.finished || '').startsWith(Y)).length;
  const withPages = read.filter(b => b.pages);
  const avgPages = withPages.length ? Math.round(withPages.reduce((a, b) => a + b.pages, 0) / withPages.length) : 300;

  const dayPages = {};
  for (const s of S.sessions) dayPages[s.date] = (dayPages[s.date] || 0) + s.pages;
  const timed = S.sessions.filter(s => s.minutes > 0 && s.pages > 0).slice(-20);
  const tm = timed.reduce((a, s) => a + s.minutes, 0);
  const lastTest = S.speedTests[S.speedTests.length - 1];
  let pph = tm ? timed.reduce((a, s) => a + s.pages, 0) / tm * 60 : lastTest ? lastTest.wpm * 60 / S.settings.wpp : null;
  const wpm = pph ? Math.round(pph * S.settings.wpp / 60) : null;

  let streak = 0, d = dayPages[t] ? t : addDays(t, -1);
  while (dayPages[d] > 0) { streak++; d = addDays(d, -1); }
  let longest = 0, run = 0, prev = null;
  for (const k of Object.keys(dayPages).sort()) { if (!dayPages[k]) continue; run = prev && addDays(prev, 1) === k ? run + 1 : 1; longest = Math.max(longest, run); prev = k; }

  let recent = 0; for (let i = 0; i < 14; i++) recent += dayPages[addDays(t, -i)] || 0;
  const recentPace = recent / 14;

  const reading = S.books.filter(b => b.status === 'reading');
  const remaining = Math.max(0, goal - done);
  const left = b => Math.max(0, (b.pages || avgPages) - (b.currentPage || 0));
  const pagesNeeded = reading.slice(0, remaining).reduce((a, b) => a + left(b), 0) + Math.max(0, remaining - reading.length) * avgPages;
  const dailyTarget = Math.ceil(pagesNeeded / daysLeft);
  const expected = goal * doy / diy, diff = done - expected;
  const projected = recentPace > 0 ? done + Math.floor(recentPace * daysLeft / avgPages) : Math.round(done / doy * diy);
  return { Y, t, doy, diy, daysLeft, goal, done, avgPages, dayPages, pph, wpm, streak, longest, recentPace, reading, remaining,
    left, dailyTarget, diff, projected, todayPages: dayPages[t] || 0, minsPerDay: pph ? Math.round(dailyTarget / pph * 60) : null };
}

function coach(m) {
  const tips = [];
  const want = S.books.filter(b => b.status === 'want');
  if (!S.books.length) return [{ ico: '👋', t: 'Start by adding a book', b: 'Add what you are reading now, or import your whole Goodreads library from Sync & settings.' }];
  if (m.remaining === 0) tips.push({ ico: '🏆', t: `Goal reached — ${m.done} books in ${m.Y}`, b: 'Raise the goal if you want a new target for the rest of the year.' });
  else if (m.diff <= -1) tips.push({ ico: '⏱️', t: `Catch-up plan: ${m.dailyTarget} pages a day`, b: `You are ${Math.ceil(-m.diff)} book${Math.ceil(-m.diff) > 1 ? 's' : ''} behind pace. ${m.dailyTarget} pages daily${m.minsPerDay ? ` (about ${m.minsPerDay} min at your speed)` : ''} gets you to ${m.goal} by Dec 31. Two short sessions are easier to keep than one long one.` });
  if (!m.todayPages && m.streak > 0) tips.push({ ico: '🔥', t: `Keep your ${m.streak}-day streak alive`, b: 'Nothing logged today yet. Even 10 pages counts — consistency beats marathon sessions.' });
  if (!S.sessions.some(s => s.minutes > 0)) tips.push({ ico: '⏲️', t: 'Time one session to learn your speed', b: 'Hit "Start timer" on a book. Once the app knows your pages per hour it can tell you exactly how many minutes a day your goal needs.' });
  for (const b of m.reading) {
    const last = S.sessions.filter(s => s.bookId === b.id).map(s => s.date).sort().pop() || b.started;
    if (last && (pd(m.t) - pd(last)) / 864e5 >= 14) tips.push({ ico: '🪦', t: `"${b.title}" has stalled`, b: 'No progress in two weeks. Books that drag are the biggest goal-killer — pick it back up today or move it to Did not finish without guilt.', act: 'open-book', id: b.id, label: 'Decide' });
  }
  if (m.reading.length > 3) tips.push({ ico: '📚', t: `${m.reading.length} books in progress`, b: 'Finishing is what counts toward the goal. Try focusing on the one closest to done.' });
  if (!m.reading.length && want.length) {
    const sorted = [...want].sort((a, b) => m.diff < 0 ? (a.pages || 9999) - (b.pages || 9999) : (a.added || '').localeCompare(b.added || ''));
    const n = sorted[0];
    tips.push({ ico: '👉', t: `Next up: ${n.title}`, b: m.diff < 0 ? `It is the shortest on your list${n.pages ? ` (${n.pages} pages)` : ''} — a quick win to get back on pace.` : 'It has waited longest on your want-to-read shelf.', act: 'start-reading', id: n.id, label: 'Start reading' });
  }
  const buckets = {};
  for (const s of S.sessions) if (s.minutes > 0 && s.pages > 0 && s.hour != null) {
    const k = s.hour < 5 ? 'late at night' : s.hour < 12 ? 'in the morning' : s.hour < 17 ? 'in the afternoon' : s.hour < 22 ? 'in the evening' : 'late at night';
    (buckets[k] = buckets[k] || { p: 0, m: 0, n: 0 }); buckets[k].p += s.pages; buckets[k].m += s.minutes; buckets[k].n++;
  }
  const bk = Object.entries(buckets).filter(([, v]) => v.n >= 2).map(([k, v]) => [k, v.p / v.m * 60]).sort((a, b) => b[1] - a[1]);
  if (bk.length >= 2) tips.push({ ico: '🌅', t: `You read fastest ${bk[0][0]}`, b: `${Math.round(bk[0][1])} pages/hour versus ${Math.round(bk[bk.length - 1][1])} ${bk[bk.length - 1][0]}. Schedule your main session then.` });
  if (m.diff > 1 && m.remaining) tips.push({ ico: '🚀', t: 'Ahead of schedule', b: `At your recent pace you will finish about ${m.projected} books this year. A good moment for that long book you have been putting off.` });
  return tips.slice(0, 5);
}

// ---------- small renderers ----------
function cover(b, cls = '') {
  const ph = `<button class="cover ${cls}" data-action="open-book" data-id="${b.id}">${esc(b.title)}</button>`;
  if (!b.cover) return ph;
  return `<img class="cover ${cls}" src="${esc(b.cover)}" alt="" loading="lazy" data-action="open-book" data-id="${b.id}" data-ph="${esc(b.title)}">`;
}
const stars = n => n ? `<span class="stars" aria-label="${n} of 5 stars">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>` : '';
function ring(pct, big, small) {
  const r = 64, c = 2 * Math.PI * r;
  return `<div class="ring"><svg width="150" height="150"><circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--line)" stroke-width="12"/>
    <circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--accent)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.min(1, pct))}"/></svg>
    <div class="c"><b>${big}</b><span class="muted small">${small}</span></div></div>`;
}
function barChart(data, { target, every = 1 } = {}) {
  const W = 640, H = 190, L = 34, B = 22, T = 10, max = Math.ceil(Math.max(2, target || 0, ...data.map(d => d.v)) / 2) * 2;
  const bw = (W - L) / data.length, y = v => T + (H - T - B) * (1 - v / max);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img">`;
  for (const g of [0, max / 2, max]) s += `<line class="grid-l" x1="${L}" x2="${W}" y1="${y(g)}" y2="${y(g)}"/><text x="${L - 6}" y="${y(g) + 4}" text-anchor="end">${Math.round(g)}</text>`;
  data.forEach((d, i) => {
    const x = L + i * bw + bw * 0.15, w = bw * 0.7, h = H - B - y(d.v), r = Math.min(4, w / 2, h);
    if (d.v > 0) s += `<path class="b" data-tip="${esc(d.tip)}" d="M${x},${H - B}v${-(h - r)}q0,${-r} ${r},${-r}h${w - 2 * r}q${r},0 ${r},${r}v${h - r}z"/>`;
    if (i % every === 0) s += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${esc(d.l)}</text>`;
  });
  if (target) s += `<line class="target" x1="${L}" x2="${W}" y1="${y(target)}" y2="${y(target)}"/>`;
  return s + '</svg>';
}
function heatmap(m) {
  const start = new Date(m.Y, 0, 1), off = start.getDay(), c = 13;
  let s = `<svg width="${54 * c}" height="${7 * c + 16}">`;
  MONTHS.forEach((mo, i) => { const d = Math.round((new Date(m.Y, i, 1) - start) / 864e5); s += `<text x="${Math.floor((d + off) / 7) * c}" y="10" class="mo">${mo}</text>`; });
  for (let i = 0; i < m.diy; i++) {
    const ds = addDays(`${m.Y}-01-01`, i), p = m.dayPages[ds] || 0;
    const lvl = !p ? '' : p < 15 ? 'l1' : p < 30 ? 'l2' : p < 60 ? 'l3' : 'l4';
    s += `<rect class="${lvl}" x="${Math.floor((i + off) / 7) * c}" y="${((i + off) % 7) * c + 16}" width="11" height="11" data-tip="${nice(ds)}: ${p} pages"/>`;
  }
  return `<div class="heat chart">${s}</svg></div>`;
}

// ---------- views ----------
function viewHome() {
  const m = metrics(), behind = m.diff <= -1, ahead = m.diff >= 1;
  const head = m.remaining === 0 ? `You hit your ${m.Y} goal 🎉` : behind ? `${Math.ceil(-m.diff)} book${Math.ceil(-m.diff) > 1 ? 's' : ''} behind schedule` : ahead ? `${Math.floor(m.diff)} book${Math.floor(m.diff) > 1 ? 's' : ''} ahead of schedule` : 'Right on schedule';
  const every = m.remaining ? (m.daysLeft / m.remaining) : 0;
  const q = S.quotes.length ? S.quotes[(m.doy + S.quotes.length) % S.quotes.length] : null;
  const tips = coach(m);
  return `
  <section class="card hero">
    ${ring(m.done / m.goal, m.done, `of ${m.goal} books`)}
    <div class="txt">
      <span class="pill ${behind ? 'warn' : ''}">${m.Y} reading goal · ${m.daysLeft} days left</span>
      <h1 style="margin-top:8px">${head}</h1>
      ${m.remaining ? `<p>To finish ${m.goal}: one book every <b>${every >= 2 ? Math.floor(every) : every.toFixed(1)} days</b>, about <b>${m.dailyTarget} pages a day</b>${m.minsPerDay ? ` (~<b>${m.minsPerDay} min</b> at your speed)` : ''}.</p>` : ''}
      <p class="muted small">At your current pace you will finish about ${m.projected} books this year.</p>
      <button class="btn sm" data-action="edit-goal">Change goal</button>
    </div>
  </section>
  <section class="grid tiles" style="margin-top:14px">
    <div class="card tile"><div class="label">Today</div><div class="big">${m.todayPages}<span class="muted" style="font-size:16px"> / ${m.dailyTarget} pages</span></div>
      <div class="bar"><i style="width:${Math.min(100, m.dailyTarget ? m.todayPages / m.dailyTarget * 100 : 100)}%"></i></div></div>
    <div class="card tile"><div class="label">Streak</div><div class="big">${m.streak} day${m.streak === 1 ? '' : 's'}</div><div class="sub">Longest: ${m.longest}</div></div>
    <div class="card tile"><div class="label">Reading speed</div><div class="big">${m.pph ? Math.round(m.pph) : '—'}<span class="muted" style="font-size:16px"> pages/hr</span></div><div class="sub">${m.wpm ? `≈ ${m.wpm} words/min` : 'Time a session to measure'}</div></div>
    <div class="card tile"><div class="label">Last 14 days</div><div class="big">${Math.round(m.recentPace)}<span class="muted" style="font-size:16px"> pages/day</span></div><div class="sub">${m.recentPace >= m.dailyTarget ? 'Enough to hit your goal' : `Need ${m.dailyTarget}`}</div></div>
  </section>
  <h2>Currently reading</h2>
  <div class="grid two">${m.reading.length ? m.reading.map(b => readingCard(b, m)).join('') : `<div class="card empty">Nothing in progress. <button class="btn ghost" data-action="add-book">Add a book</button></div>`}</div>
  <div class="grid two" style="margin-top:14px">
    <section class="card"><h3 style="margin-bottom:12px">Coach</h3>${tips.map(t => `<div class="tipcard"><div class="ico">${t.ico}</div><div><b>${esc(t.t)}</b><div class="muted small">${esc(t.b)}</div>${t.act ? `<button class="btn sm" style="margin-top:6px" data-action="${t.act}" data-id="${t.id}">${t.label}</button>` : ''}</div></div>`).join('') || '<p class="muted">All good — keep reading.</p>'}</section>
    <section class="card"><h3 style="margin-bottom:12px">From your quotes</h3>${q ? `<blockquote>“${esc(q.text)}”</blockquote><cite>${esc(book(q.bookId)?.title || '')}${q.page ? `, p. ${q.page}` : ''}</cite>` : `<p class="muted">Save lines worth keeping while you read. <a href="#quotes">Add your first quote</a>.</p>`}</section>
  </div>`;
}
function readingCard(b, m) {
  const pct = b.pages ? Math.min(100, Math.round((b.currentPage || 0) / b.pages * 100)) : 0, left = m.left(b);
  const pace = Math.max(m.recentPace, 1), days = Math.ceil(left / Math.max(pace, m.dailyTarget || 1));
  const eta = b.pages ? `${left} pages left${m.pph ? ` · ~${(left / m.pph).toFixed(1)} h` : ''} · done by ${nice(addDays(m.t, days))} at ${Math.round(Math.max(pace, m.dailyTarget || 1))} pages/day` : 'Add a page count to see your finish date';
  return `<div class="card reading">${cover(b)}<div class="body">
    <div class="title">${esc(b.title)}</div><div class="muted small">${esc(b.author)}</div>
    <div class="spread small" style="margin:8px 0 4px"><span>Page ${b.currentPage || 0}${b.pages ? ` of ${b.pages}` : ''}</span><b>${pct}%</b></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="muted small" style="margin:6px 0 10px">${eta}</div>
    <div class="row"><button class="btn sm primary" data-action="start-timer" data-id="${b.id}">▶ Start timer</button>
    <button class="btn sm" data-action="log" data-id="${b.id}">Log progress</button>
    <button class="btn sm" data-action="add-quote" data-id="${b.id}">+ Quote</button></div></div></div>`;
}

let libFilter = 'all', libQuery = '', libSort = 'recent';
const customShelves = () => [...new Set(S.books.flatMap(b => b.shelves || []))].sort();
function viewLibrary() {
  const chips = [['all', 'All'], ...Object.entries(STATUS), ...customShelves().map(s => ['#' + s, s])];
  return `<div class="spread"><h1>Library</h1><div class="row"><input id="libq" type="search" placeholder="Search title or author" value="${esc(libQuery)}" style="width:220px">
    <select id="libsort" style="width:auto"><option value="recent">Recently added</option><option value="title">Title</option><option value="rating">Rating</option><option value="finished">Date finished</option><option value="pages">Shortest first</option></select></div></div>
  <div class="chips">${chips.map(([k, l]) => `<button class="chip ${libFilter === k ? 'on' : ''}" data-action="lib-filter" data-id="${esc(k)}">${esc(l)} <span>${k === 'all' ? S.books.length : k[0] === '#' ? S.books.filter(b => (b.shelves || []).includes(k.slice(1))).length : S.books.filter(b => b.status === k).length}</span></button>`).join('')}</div>
  <div class="books" id="libgrid">${libGrid()}</div>`;
}
function libGrid() {
  const q = libQuery.toLowerCase();
  let list = S.books.filter(b => (libFilter === 'all' || (libFilter[0] === '#' ? (b.shelves || []).includes(libFilter.slice(1)) : b.status === libFilter)) && (!q || (b.title + ' ' + b.author).toLowerCase().includes(q)));
  const by = { recent: (a, b) => (b.added || '').localeCompare(a.added || ''), title: (a, b) => a.title.localeCompare(b.title), rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    finished: (a, b) => (b.finished || '').localeCompare(a.finished || ''), pages: (a, b) => (a.pages || 9999) - (b.pages || 9999) };
  list.sort(by[libSort]);
  if (!list.length) return `<div class="empty" style="grid-column:1/-1">No books here yet.</div>`;
  return list.map(b => `<div class="card bookcard" data-action="open-book" data-id="${b.id}">${cover(b)}<div style="min-width:0">
    <div class="title clamp">${esc(b.title)}</div><div class="muted small">${esc(b.author)}</div>
    <div class="small" style="margin-top:4px"><span class="pill">${STATUS[b.status]}</span> ${stars(b.rating)}</div>
    <div class="muted small">${b.pages ? b.pages + ' pages' : ''}${b.finished ? ' · finished ' + nice(b.finished) : ''}</div>
    ${b.review ? `<div class="small clamp" style="margin-top:4px">${esc(b.review)}</div>` : ''}</div></div>`).join('');
}

let quoteQuery = '';
function viewQuotes() {
  const q = quoteQuery.toLowerCase();
  const list = S.quotes.filter(x => !q || (x.text + ' ' + (x.tags || '') + ' ' + (x.note || '') + ' ' + (book(x.bookId)?.title || '')).toLowerCase().includes(q))
    .sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (b.date || '').localeCompare(a.date || ''));
  return `<div class="spread"><h1>Quotes</h1><div class="row"><input id="quoteq" type="search" placeholder="Search quotes, tags, books" value="${esc(quoteQuery)}" style="width:240px"><button class="btn primary" data-action="add-quote">+ Add quote</button></div></div>
  <div id="quotelist" style="margin-top:16px">${list.length ? list.map(x => `<div class="card quote"><blockquote>“${esc(x.text)}”</blockquote>
    <cite>${esc(book(x.bookId)?.title || 'Unknown book')}${x.page ? `, p. ${x.page}` : ''}${x.tags ? ' · ' + esc(x.tags) : ''}</cite>
    ${x.note ? `<p class="small" style="margin-top:6px">${esc(x.note)}</p>` : ''}
    <div class="row" style="margin-top:8px"><button class="btn sm ghost" data-action="fav-quote" data-id="${x.id}">${x.fav ? '★ Favourite' : '☆ Favourite'}</button>
    <button class="btn sm ghost" data-action="copy-quote" data-id="${x.id}">Copy</button><button class="btn sm ghost danger" data-action="del-quote" data-id="${x.id}">Delete</button></div></div>`).join('')
    : `<div class="card empty">${S.quotes.length ? 'No quotes match.' : 'No quotes yet. Capture a line the moment it strikes you.'}</div>`}</div>`;
}

function viewStats() {
  const m = metrics(), y = String(m.Y);
  const fin = S.books.filter(b => b.status === 'read' && (b.finished || '').startsWith(y));
  const monthly = MONTHS.map((l, i) => { const v = fin.filter(b => +b.finished.slice(5, 7) === i + 1).length; return { l, v, tip: `${l}: ${v} book${v === 1 ? '' : 's'}` }; });
  const daily = Array.from({ length: 30 }, (_, i) => { const d = addDays(m.t, i - 29), v = m.dayPages[d] || 0; return { l: String(pd(d).getDate()), v, tip: `${nice(d)}: ${v} pages` }; });
  const timed = S.sessions.filter(s => s.minutes > 0 && s.pages > 0).slice(-15).map(s => { const v = Math.round(s.pages / s.minutes * 60); return { l: s.date.slice(5).replace('-', '/'), v, tip: `${nice(s.date)}: ${v} pages/hr (${s.pages} pages in ${s.minutes} min)` }; });
  const pagesY = Object.entries(m.dayPages).filter(([k]) => k.startsWith(y)).reduce((a, [, v]) => a + v, 0) || fin.reduce((a, b) => a + (b.pages || 0), 0);
  const rated = S.books.filter(b => b.rating), dur = fin.filter(b => b.started && b.finished).map(b => (pd(b.finished) - pd(b.started)) / 864e5 + 1);
  const lt = S.speedTests[S.speedTests.length - 1];
  return `<h1>Stats</h1>
  <section class="grid tiles" style="margin-top:16px">
    <div class="card tile"><div class="label">Books in ${y}</div><div class="big">${m.done}</div><div class="sub">Goal ${m.goal}</div></div>
    <div class="card tile"><div class="label">Pages in ${y}</div><div class="big">${pagesY.toLocaleString()}</div><div class="sub">Avg book: ${m.avgPages} pages</div></div>
    <div class="card tile"><div class="label">Avg days per book</div><div class="big">${dur.length ? Math.round(dur.reduce((a, b) => a + b, 0) / dur.length) : '—'}</div><div class="sub">Need one every ${m.remaining ? Math.floor(m.daysLeft / m.remaining) : '—'}</div></div>
    <div class="card tile"><div class="label">Avg rating</div><div class="big">${rated.length ? (rated.reduce((a, b) => a + b.rating, 0) / rated.length).toFixed(1) : '—'}</div><div class="sub">${rated.length} rated</div></div>
  </section>
  <h2>Books finished per month</h2><div class="card">${barChart(monthly, { target: m.goal / 12 })}<p class="muted small">Dashed line: the ${(m.goal / 12).toFixed(1)} books a month your goal needs.</p></div>
  <h2>Pages per day, last 30 days</h2><div class="card">${barChart(daily, { target: m.dailyTarget, every: 3 })}<p class="muted small">Dashed line: today's target of ${m.dailyTarget} pages.</p></div>
  <h2>Reading days in ${y}</h2><div class="card">${heatmap(m)}</div>
  <h2>Speed by timed session</h2><div class="card">${timed.length ? barChart(timed, { every: Math.ceil(timed.length / 8) }) + '<p class="muted small">Pages per hour, most recent sessions.</p>' : '<p class="muted">Use the timer on a book to chart your speed over time.</p>'}</div>
  <h2>Speed test</h2><div class="card" id="speedtest"><p>Read a short passage at your normal pace to measure words per minute. ${lt ? `Last result: <b>${lt.wpm} wpm</b> on ${nice(lt.date)}.` : 'Most adults read around 200–300 wpm.'}</p>
    <button class="btn primary" data-action="speed-start">Start test</button></div>`;
}
const PASSAGE = `Reading faster is less about moving your eyes quickly and more about removing the small habits that slow you down. The first is regression: the urge to jump back and reread a line you have already passed. Most of the time the meaning would have arrived anyway a sentence later, so trust the page and keep going. Running a finger or a pen under the line gives your eyes something to follow and quietly discourages them from wandering backward. The second habit is reading every word at the same weight. Good readers take in phrases rather than single words, and they slow down only where the ideas get dense. A chapter of narrative can go by quickly, while one difficult paragraph deserves a second, deliberate pass. The third habit has nothing to do with technique at all. It is simply attention. A phone in another room is worth more than any speed method, because ten uninterrupted minutes cover more ground than thirty minutes of half reading. Finally, speed follows volume. People who read a little every day become faster without trying, because familiar words and familiar structures stop needing effort. So set a modest daily target, protect the time, give up on books that bore you, and let the pace take care of itself.`;

function viewSettings() {
  const cid = clientId();
  return `<h1>Sync &amp; settings</h1>
  <div class="grid two" style="margin-top:16px">
  <section class="card"><h3>Goodreads</h3>
    <p class="muted small" style="margin-top:6px">Goodreads closed its public API in 2020, so no site can log in to it directly. The supported route is its library export, which carries your shelves, ratings, reviews and dates.</p>
    <ol class="small"><li>Open <a href="https://www.goodreads.com/review/import" target="_blank" rel="noopener">goodreads.com/review/import</a> and choose <b>Export Library</b>.</li><li>Upload the downloaded CSV here. Re-importing later only adds or updates, never duplicates.</li></ol>
    <label>Goodreads CSV file<input type="file" id="grfile" accept=".csv"></label>
    <label>Your Goodreads profile link (optional)<input id="grurl" placeholder="https://www.goodreads.com/user/show/…" value="${esc(S.settings.goodreadsUrl)}"></label>
    <div class="row"><button class="btn sm" data-action="export-gr">Export as Goodreads CSV</button>${S.settings.goodreadsUrl ? `<a class="btn sm" href="${esc(S.settings.goodreadsUrl)}" target="_blank" rel="noopener">Open my Goodreads</a>` : ''}</div>
  </section>
  <section class="card"><h3>Sign in with Google</h3>
    <p class="muted small" style="margin-top:6px">Signing in stores your library in a private app folder in <i>your own</i> Google Drive, so it follows you across devices. Anyone who visits can sign in and keep their own separate library.</p>
    ${G.token ? `<p><span class="pill">Connected</span> <span class="muted small">${G.status || 'Changes sync automatically.'}</span></p><div class="row"><button class="btn sm" data-action="g-sync">Sync now</button><button class="btn sm" data-action="g-out">Sign out</button></div>`
      : cid ? `<button class="btn primary" data-action="g-in">Sign in with Google</button>` : `<p class="small">Not set up yet — this needs a free Google OAuth Client ID (steps in the README).</p>`}
    <label style="margin-top:12px">Google OAuth Client ID<input id="gcid" placeholder="1234-abc.apps.googleusercontent.com" value="${esc(S.settings.clientId)}"></label>
  </section>
  <section class="card"><h3>Reading</h3>
    <div class="f2" style="margin-top:8px"><label>${new Date().getFullYear()} goal (books)<input id="setgoal" type="number" min="1" value="${goalFor(new Date().getFullYear())}"></label>
    <label>Words per page (for wpm)<input id="setwpp" type="number" min="100" max="600" value="${S.settings.wpp}"></label></div>
  </section>
  <section class="card"><h3>Backup</h3><p class="muted small" style="margin-top:6px">Without Google sign-in, your data lives only in this browser. Download a backup now and then.</p>
    <div class="row"><button class="btn sm" data-action="export-json">Download backup</button><label class="btn sm" style="margin:0;color:var(--ink)">Restore backup<input type="file" id="jsonfile" accept=".json" hidden></label>
    <button class="btn sm danger" data-action="wipe">Erase everything</button></div>
  </section></div>`;
}

const VIEWS = { home: viewHome, library: viewLibrary, quotes: viewQuotes, stats: viewStats, settings: viewSettings };
function render() {
  const r = location.hash.slice(1) in VIEWS ? location.hash.slice(1) : 'home';
  $('#view').innerHTML = VIEWS[r]();
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + r));
  const ls = $('#libsort'); if (ls) ls.value = libSort;
  renderTimer();
}

// ---------- dialogs ----------
const dlg = $('#dlg');
function openDlg(html) { dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); }
const closeBtn = `<button type="button" class="btn" data-action="close">Cancel</button>`;

function dlgAddBook() {
  openDlg(`<h2>Add a book</h2><input id="olq" type="search" placeholder="Search by title, author or ISBN" value="${esc(olQuery)}" autofocus>
  <div id="olres" style="margin:8px 0;max-height:300px;overflow:auto"><p class="muted small">Type at least 3 letters. Results come from Open Library.</p></div>
  <details><summary class="small">Or add manually</summary><form data-form="manual" style="margin-top:8px"><div class="f2"><label>Title<input name="title" required></label><label>Author<input name="author"></label><label>Pages<input name="pages" type="number" min="1"></label><label>Shelf<select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === 'want' ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div><button class="btn sm primary">Save book</button></form></details>
  <div class="dfoot"><span></span>${closeBtn}</div>`);
  if (olQuery.length >= 3) olSearch(olQuery);
}
function dlgConfirmBook(i) {
  const d = olResults[i]; if (!d) return;
  const cov = d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '';
  openDlg(`<form data-form="confirm"><h2>Check the details</h2><div style="display:flex;gap:16px">${cov ? `<img class="cover lg" src="${cov}" alt="">` : ''}
  <div style="flex:1"><label>Title<input name="title" value="${esc(d.title)}" required></label><label>Author<input name="author" value="${esc((d.author_name || []).slice(0, 2).join(', '))}"></label></div></div>
  <div class="f2"><label>Shelf<select name="status" autofocus>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === 'want' ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>Pages<input name="pages" type="number" min="0" value="${d.number_of_pages_median || ''}"></label>
  <label>Current page (if reading)<input name="currentPage" type="number" min="0"></label><label>Date finished (if read)<input name="finished" type="date" max="${today()}"></label></div>
  <input type="hidden" name="cover" value="${cov}"><input type="hidden" name="isbn" value="${esc((d.isbn || [])[0] || '')}">
  <div class="dfoot"><button type="button" class="btn" data-action="add-book">← Back to results</button><div class="row">${closeBtn}<button class="btn primary">Save book</button></div></div></form>`);
}
let olTimer, olResults = [], olQuery = '';
async function olSearch(q) {
  const box = $('#olres'); if (!box) return;
  box.innerHTML = '<p class="muted small">Searching…</p>';
  try {
    const r = await fetch(`https://openlibrary.org/search.json?limit=8&fields=key,title,author_name,number_of_pages_median,cover_i,isbn&q=${encodeURIComponent(q)}`);
    olResults = (await r.json()).docs || [];
    if (!$('#olres')) return;
    box.innerHTML = olResults.length ? olResults.map((d, i) => `<button class="result" data-action="pick-ol" data-id="${i}">${d.cover_i ? `<img src="https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg" alt="">` : '<span class="ph"></span>'}
      <span><b>${esc(d.title)}</b><br><span class="muted small">${esc((d.author_name || []).slice(0, 2).join(', '))}${d.number_of_pages_median ? ` · ${d.number_of_pages_median} pages` : ''}</span></span></button>`).join('') : '<p class="muted small">No matches — add it manually below.</p>';
  } catch (e) { box.innerHTML = '<p class="muted small">Search is unavailable right now — add the book manually below.</p>'; }
}
function addBook(o) {
  const st = o.status || 'want', t = today();
  const b = { id: uid(), title: '', author: '', pages: 0, cover: '', isbn: '', status: st, shelves: [], rating: 0, review: '', started: st === 'reading' || st === 'read' ? t : '', finished: st === 'read' ? t : '', currentPage: 0, added: t, ...o };
  if (b.status === 'read') b.currentPage = b.pages;
  S.books.push(b); return b;
}

function dlgBook(id) {
  const b = book(id); if (!b) return;
  const qs = S.quotes.filter(q => q.bookId === id);
  openDlg(`<form data-form="book" data-id="${id}"><div style="display:flex;gap:16px;margin-bottom:12px">${cover(b, 'lg').replace('data-action="open-book"', '')}
    <div style="flex:1"><label>Title<input name="title" value="${esc(b.title)}" required></label><label>Author<input name="author" value="${esc(b.author)}"></label>
    <div class="rate" id="rate">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="${n <= b.rating ? 'on' : ''}" data-action="rate" data-id="${n}" aria-label="${n} stars">★</button>`).join('')}<input type="hidden" name="rating" value="${b.rating || 0}"></div></div></div>
  <div class="f3"><label>Shelf<select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === b.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Pages<input name="pages" type="number" min="0" value="${b.pages || ''}"></label><label>Current page<input name="currentPage" type="number" min="0" value="${b.currentPage || ''}"></label></div>
  <div class="f2"><label>Started<input name="started" type="date" value="${b.started || ''}"></label><label>Finished<input name="finished" type="date" value="${b.finished || ''}"></label></div>
  <label>Custom shelves (comma separated)<input name="shelves" value="${esc((b.shelves || []).join(', '))}" placeholder="favourites, book-club, non-fiction"></label>
  <label>Review<textarea name="review" placeholder="What did you think? What will you remember?">${esc(b.review)}</textarea></label>
  ${qs.length ? `<p class="small"><b>${qs.length} quote${qs.length > 1 ? 's' : ''}</b></p>${qs.slice(0, 3).map(q => `<p class="small muted">“${esc(q.text.slice(0, 140))}${q.text.length > 140 ? '…' : ''}”</p>`).join('')}` : ''}
  <div class="dfoot"><div class="row"><button type="button" class="btn sm danger" data-action="del-book" data-id="${id}">Delete</button><button type="button" class="btn sm" data-action="add-quote" data-id="${id}">+ Quote</button></div>
    <div class="row">${closeBtn}<button class="btn primary">Save</button></div></div></form>`);
}
function dlgLog(id, timed) {
  const b = book(id); if (!b) return;
  openDlg(`<form data-form="log" data-id="${id}"><h2>${timed ? 'Session done' : 'Log progress'}</h2><p class="muted">${esc(b.title)} — you were on page ${b.currentPage || 0}${b.pages ? ` of ${b.pages}` : ''}.</p>
  <div class="f3"><label>Now on page<input name="page" type="number" min="0" ${b.pages ? `max="${b.pages}"` : ''} required autofocus></label>
  <label>Minutes read<input name="minutes" type="number" min="0" value="${timed || ''}" placeholder="optional"></label><label>Date<input name="date" type="date" value="${today()}" max="${today()}"></label></div>
  <div class="dfoot">${b.pages ? `<button type="button" class="btn sm" data-action="finish" data-id="${id}">I finished it</button>` : '<span></span>'}<div class="row">${closeBtn}<button class="btn primary">Save</button></div></div></form>`);
}
function logSession(b, page, minutes, date) {
  const pages = Math.max(0, page - (b.currentPage || 0));
  if (pages || minutes) S.sessions.push({ id: uid(), bookId: b.id, date, hour: new Date().getHours(), minutes, startPage: b.currentPage || 0, endPage: page, pages });
  b.currentPage = page;
  if (b.status !== 'reading' && b.status !== 'read') { b.status = 'reading'; b.started = b.started || date; }
  const fin = b.pages && page >= b.pages;
  if (fin) { b.status = 'read'; b.finished = date; }
  save();
  if (fin) { dlgBook(b.id); toast('Finished! Rate it and jot a quick review while it is fresh.'); }
  else { dlg.close(); toast(`Logged ${pages} pages${minutes && pages ? ` · ${Math.round(pages / minutes * 60)} pages/hr` : ''}`); }
}
function dlgQuote(bookId) {
  if (!S.books.length) return toast('Add a book first.');
  const list = [...S.books].sort((a, b) => (a.status === 'reading' ? 0 : 1) - (b.status === 'reading' ? 0 : 1) || a.title.localeCompare(b.title));
  openDlg(`<form data-form="quote"><h2>Add a quote</h2><label>Book<select name="bookId">${list.map(b => `<option value="${b.id}" ${b.id === bookId ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select></label>
  <label>Quote<textarea name="text" required autofocus></textarea></label>
  <div class="f2"><label>Page<input name="page" type="number" min="0"></label><label>Tags<input name="tags" placeholder="habits, love"></label></div>
  <label>Your note<input name="note" placeholder="Why it stuck with you"></label>
  <div class="dfoot"><span></span><div class="row">${closeBtn}<button class="btn primary">Save quote</button></div></div></form>`);
}

// ---------- timer ----------
function renderTimer() {
  const bar = $('#timerbar'), t = S.timer, b = t && book(t.bookId);
  clearInterval(renderTimer.i);
  if (!b) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = `<span>Reading <b>${esc(b.title)}</b></span><span class="clock"></span><button class="btn sm" data-action="stop-timer">Stop &amp; log</button><button class="btn sm ghost" style="color:inherit" data-action="cancel-timer">Discard</button>`;
  const tick = () => { const s = Math.floor((Date.now() - t.start) / 1000); $('.clock', bar).textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
  tick(); renderTimer.i = setInterval(tick, 1000);
}

// ---------- Goodreads CSV ----------
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function importGoodreads(text) {
  const rows = parseCSV(text.replace(/^﻿/, '')), h = rows.shift() || [], col = n => h.indexOf(n);
  if (col('Title') < 0 || col('Exclusive Shelf') < 0) return toast('That does not look like a Goodreads export (no Title / Exclusive Shelf columns).');
  const get = (r, n) => (r[col(n)] || '').trim(), map = { 'read': 'read', 'currently-reading': 'reading', 'to-read': 'want' };
  let added = 0, updated = 0;
  for (const r of rows) {
    const title = get(r, 'Title'); if (!title) continue;
    const isbn = (get(r, 'ISBN13') || get(r, 'ISBN')).replace(/[^0-9Xx]/g, ''), grId = get(r, 'Book Id'), shelf = get(r, 'Exclusive Shelf');
    const status = map[shelf] || (/dnf|abandon|did-not-finish/.test(shelf) ? 'dnf' : 'want');
    const data = { title, author: get(r, 'Author'), pages: num(get(r, 'Number of Pages')), isbn, grId, status, rating: num(get(r, 'My Rating')), review: get(r, 'My Review').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''),
      finished: status === 'read' ? get(r, 'Date Read').replace(/\//g, '-') : '', added: get(r, 'Date Added').replace(/\//g, '-') || today(),
      shelves: get(r, 'Bookshelves').split(',').map(s => s.trim()).filter(s => s && !map[s] && s !== shelf) };
    const ex = S.books.find(b => (grId && b.grId === grId) || (b.title.toLowerCase() === title.toLowerCase() && (b.author || '').toLowerCase() === data.author.toLowerCase()));
    if (ex) { Object.assign(ex, { grId, isbn: ex.isbn || isbn, pages: ex.pages || data.pages, rating: data.rating || ex.rating, review: data.review || ex.review, finished: data.finished || ex.finished, shelves: [...new Set([...(ex.shelves || []), ...data.shelves])] });
      if (ex.status !== 'reading' || status === 'read') ex.status = status; updated++; }
    else { addBook({ ...data, started: '', cover: isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` : '' }); added++; }
  }
  save(); toast(`Goodreads import: ${added} added, ${updated} updated.`);
}
const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
function exportGoodreads() {
  const rev = { read: 'read', reading: 'currently-reading', want: 'to-read', dnf: 'did-not-finish' };
  const lines = [['Title', 'Author', 'ISBN13', 'My Rating', 'Number of Pages', 'Date Read', 'Date Added', 'Bookshelves', 'Exclusive Shelf', 'My Review']];
  for (const b of S.books) lines.push([b.title, b.author, b.isbn, b.rating || 0, b.pages || '', (b.finished || '').replace(/-/g, '/'), (b.added || '').replace(/-/g, '/'), (b.shelves || []).join(', '), rev[b.status], b.review]);
  download('marginalia-goodreads.csv', lines.map(l => l.map(csvCell).join(',')).join('\n'), 'text/csv');
}
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

// ---------- Google Drive sync (optional) ----------
const G = { token: null, fileId: null, status: '', client: null };
const DRIVE = 'https://www.googleapis.com/drive/v3/files', UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const clientId = () => S.settings.clientId || (window.READTRACK_CONFIG || {}).googleClientId || '';
const loadGsi = () => new Promise((res, rej) => { if (window.google?.accounts?.oauth2) return res(); const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res; s.onerror = () => rej(new Error('Could not load Google sign-in')); document.head.appendChild(s); });
async function gSignIn() {
  try {
    await loadGsi();
    G.client = google.accounts.oauth2.initTokenClient({ client_id: clientId(), scope: 'https://www.googleapis.com/auth/drive.appdata',
      callback: async r => { if (r.error) return toast('Google sign-in failed: ' + r.error); G.token = r.access_token; try { await gPull(); } catch (e) { toast(e.message); } render(); },
      error_callback: e => toast('Google sign-in was cancelled or blocked (' + (e.type || 'error') + ').') });
    G.client.requestAccessToken();
  } catch (e) { toast(e.message); }
}
async function gFetch(url, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + G.token } });
  if (r.status === 401) { G.token = null; render(); throw new Error('Google session expired — sign in again.'); }
  if (!r.ok) throw new Error('Google Drive error ' + r.status);
  return r;
}
async function gPull() {
  const list = await (await gFetch(`${DRIVE}?spaces=appDataFolder&fields=files(id)&q=${encodeURIComponent("name='marginalia.json'")}`)).json();
  G.fileId = list.files?.[0]?.id || null;
  if (G.fileId) {
    const remote = await (await gFetch(`${DRIVE}/${G.fileId}?alt=media`)).json();
    if ((remote.updated || 0) > (S.updated || 0)) {
      if (S.books.length && !confirm('Your Google Drive has a newer library than this browser. Replace what is here with it?')) return;
      S = normalize(remote); persist(); G.status = 'Loaded from Google Drive.'; return;
    }
  }
  await gPush();
}
async function gPush() {
  if (!G.token) return;
  const data = JSON.stringify({ ...S, timer: null });
  if (G.fileId) await gFetch(`${UPLOAD}/${G.fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: data });
  else {
    const b = 'mg' + uid(), body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: 'marginalia.json', parents: ['appDataFolder'] })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${data}\r\n--${b}--`;
    G.fileId = (await (await gFetch(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body })).json()).id;
  }
  G.status = 'Synced at ' + new Date().toLocaleTimeString() + '.';
}
function scheduleSync() { if (!G.token) return; clearTimeout(scheduleSync.t); scheduleSync.t = setTimeout(() => gPush().catch(e => toast(e.message)), 2500); }

// ---------- events ----------
const ACT = {
  'add-book': () => dlgAddBook(),
  'close': () => dlg.close(),
  'open-book': id => dlgBook(id),
  'pick-ol': i => dlgConfirmBook(i),
  'rate': n => { const inp = $('#rate input'); n = +n === +inp.value ? 0 : +n; inp.value = n; document.querySelectorAll('#rate button').forEach((b, i) => b.classList.toggle('on', i < n)); },
  'del-book': id => { if (!confirm('Delete this book with its sessions and quotes?')) return; S.books = S.books.filter(b => b.id !== id); S.sessions = S.sessions.filter(s => s.bookId !== id); S.quotes = S.quotes.filter(q => q.bookId !== id); if (S.timer?.bookId === id) S.timer = null; dlg.close(); save(); },
  'log': id => dlgLog(id),
  'finish': id => { const b = book(id), f = dlg.querySelector('form'); logSession(b, b.pages, num(f.minutes.value), f.date.value || today()); },
  'start-reading': id => { const b = book(id); b.status = 'reading'; b.started = today(); save(); toast('Moved to Currently reading.'); },
  'start-timer': id => { S.timer = { bookId: id, start: Date.now() }; persist(); renderTimer(); toast('Timer running. Phone away, enjoy.'); },
  'stop-timer': () => { const t = S.timer; if (!t) return; const mins = Math.max(1, Math.round((Date.now() - t.start) / 60000)); S.timer = null; persist(); renderTimer(); dlgLog(t.bookId, mins); },
  'cancel-timer': () => { S.timer = null; persist(); renderTimer(); },
  'add-quote': id => dlgQuote(id),
  'fav-quote': id => { const q = S.quotes.find(x => x.id === id); q.fav = !q.fav; save(); },
  'del-quote': id => { if (confirm('Delete this quote?')) { S.quotes = S.quotes.filter(x => x.id !== id); save(); } },
  'copy-quote': id => { const q = S.quotes.find(x => x.id === id), b = book(q.bookId); navigator.clipboard?.writeText(`“${q.text}” — ${b ? `${b.author ? b.author + ', ' : ''}${b.title}` : ''}`).then(() => toast('Copied.'), () => toast('Copy was blocked by the browser.')); },
  'lib-filter': k => { libFilter = k; render(); },
  'edit-goal': () => { const y = new Date().getFullYear(), v = num(prompt(`How many books do you want to read in ${y}?`, goalFor(y))); if (v) { S.goals[y] = v; save(); } },
  'speed-start': () => { speedStart = Date.now(); $('#speedtest').innerHTML = `<p class="passage">${PASSAGE}</p><button class="btn primary" data-action="speed-stop">Done reading</button>`; },
  'speed-stop': () => { const mins = (Date.now() - speedStart) / 60000, wpm = Math.round(PASSAGE.split(/\s+/).length / mins); if (mins < 0.33) return toast('That was too fast to be a real read — try again.'); S.speedTests.push({ date: today(), wpm }); save(); toast(`${wpm} words per minute — a 300-page book takes you about ${(300 * S.settings.wpp / wpm / 60).toFixed(1)} hours.`); },
  'export-gr': () => exportGoodreads(),
  'export-json': () => download(`marginalia-backup-${today()}.json`, JSON.stringify(S, null, 1), 'application/json'),
  'wipe': () => { if (confirm('Erase every book, session and quote from this browser? This cannot be undone.')) { S = blank(); save(); } },
  'g-in': () => gSignIn(),
  'g-out': () => { if (window.google?.accounts?.oauth2 && G.token) google.accounts.oauth2.revoke(G.token); G.token = G.fileId = null; render(); },
  'g-sync': () => gPull().then(() => { render(); toast('Synced.'); }, e => toast(e.message)),
};
let speedStart = 0;
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const fn = ACT[el.dataset.action]; if (fn) { e.preventDefault(); fn(el.dataset.id); }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]'); if (!f) return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f)), kind = f.dataset.form;
  if (kind === 'manual') { addBook({ title: v.title.trim(), author: v.author.trim(), pages: num(v.pages), status: v.status }); dlg.close(); save(); toast('Book added.'); }
  if (kind === 'confirm') {
    const o = { title: v.title.trim(), author: v.author.trim(), pages: num(v.pages), status: v.status, cover: v.cover, isbn: v.isbn };
    if (v.status === 'read' && v.finished) o.finished = v.finished;
    if (v.status === 'reading' || v.status === 'dnf') o.currentPage = num(v.currentPage);
    addBook(o); olQuery = ''; olResults = []; dlg.close(); save(); toast(`Added "${o.title}" to ${STATUS[o.status]}.`);
  }
  if (kind === 'book') {
    const b = book(f.dataset.id), was = b.status, t = today();
    Object.assign(b, { title: v.title.trim(), author: v.author.trim(), status: v.status, pages: num(v.pages), currentPage: num(v.currentPage), started: v.started, finished: v.finished, rating: num(v.rating), review: v.review.trim(), shelves: v.shelves.split(',').map(s => s.trim()).filter(Boolean) });
    if (b.status === 'reading' && !b.started) b.started = t;
    if (b.status === 'read') { if (!b.finished) b.finished = t; if (b.pages) b.currentPage = b.pages; } else if (was === 'read') b.finished = '';
    dlg.close(); save();
  }
  if (kind === 'log') logSession(book(f.dataset.id), num(v.page), num(v.minutes), v.date || today());
  if (kind === 'quote') { S.quotes.push({ id: uid(), bookId: v.bookId, text: v.text.trim().replace(/^[“"]|[”"]$/g, ''), page: num(v.page), tags: v.tags.trim(), note: v.note.trim(), date: today(), fav: false }); dlg.close(); save(); toast('Quote saved.'); }
});
document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'olq') { clearTimeout(olTimer); const q = olQuery = e.target.value.trim(); if (q.length >= 3) olTimer = setTimeout(() => olSearch(q), 350); }
  if (id === 'libq') { libQuery = e.target.value; $('#libgrid').innerHTML = libGrid(); }
  if (id === 'quoteq') { quoteQuery = e.target.value; const pos = e.target.selectionStart; render(); const n = $('#quoteq'); n.focus(); n.setSelectionRange(pos, pos); }
});
document.addEventListener('change', e => {
  const el = e.target, id = el.id, read = (cb) => { const f = el.files[0]; if (f) f.text().then(cb); };
  if (id === 'libsort') { libSort = el.value; $('#libgrid').innerHTML = libGrid(); }
  if (id === 'grfile') read(importGoodreads);
  if (id === 'jsonfile') read(t => { try { const o = JSON.parse(t); if (!Array.isArray(o.books)) throw 0; if (confirm(`Replace this browser's library with the backup (${o.books.length} books)?`)) { S = normalize(o); save(); toast('Backup restored.'); } } catch (x) { toast('That file is not a Marginalia backup.'); } });
  if (id === 'grurl') { const u = el.value.trim(); S.settings.goodreadsUrl = /^https:\/\/(www\.)?goodreads\.com\//.test(u) ? u : ''; if (u && !S.settings.goodreadsUrl) toast('Use a link that starts with https://www.goodreads.com/'); save(); }
  if (id === 'gcid') { S.settings.clientId = el.value.trim(); save(); }
  if (id === 'setgoal' && num(el.value)) { S.goals[new Date().getFullYear()] = num(el.value); save(); }
  if (id === 'setwpp' && num(el.value)) { S.settings.wpp = num(el.value); save(); }
});
// broken cover images fall back to a title placeholder
document.addEventListener('error', e => {
  const el = e.target;
  if (el.tagName === 'IMG' && el.classList.contains('cover')) { const b = document.createElement('button'); b.className = el.className; b.textContent = el.dataset.ph || ''; if (el.dataset.action) { b.dataset.action = el.dataset.action; b.dataset.id = el.dataset.id; } el.replaceWith(b); }
}, true);
// tooltips for chart marks
const tipEl = $('#tip');
document.addEventListener('mousemove', e => {
  const el = e.target.closest?.('[data-tip]');
  if (!el) { tipEl.hidden = true; return; }
  tipEl.textContent = el.dataset.tip; tipEl.hidden = false;
  tipEl.style.left = Math.min(e.clientX + 12, innerWidth - tipEl.offsetWidth - 8) + 'px'; tipEl.style.top = e.clientY - 34 + 'px';
});
window.addEventListener('hashchange', render);
render();
