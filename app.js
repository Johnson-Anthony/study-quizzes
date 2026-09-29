// Static quiz engine. Quizzes are data: quizzes/<term>/<course>/<name>.json, listed in quizzes/index.json.
// Question types: mc (answer: index), multi (answer: [indexes]), tf (answer: bool),
// text (answer: string | [accepted strings]), num (answer: number, tolerance?). Common: q, explain, topic.
(() => {
  'use strict';
  const app = document.getElementById('app');
  const crumb = document.getElementById('crumb');
  const md = (s) => DOMPurify.sanitize(marked.parse(String(s ?? '')));
  const mdInline = (s) => DOMPurify.sanitize(marked.parseInline(String(s ?? '')));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const getJSON = (url) => fetch(url, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${url}`))));
  let keyHandler = null;
  document.addEventListener('keydown', (e) => {
    if (keyHandler && !e.ctrlKey && !e.metaKey && !e.altKey) keyHandler(e);
  });

  // ── Index ──
  async function showIndex() {
    crumb.textContent = '';
    keyHandler = null;
    let list;
    try { list = await getJSON('quizzes/index.json'); } catch (e) {
      app.innerHTML = `<p class="muted">No quizzes yet (${esc(e.message)}).</p>`; return;
    }
    const groups = {};
    for (const q of list) (groups[`${q.term} · ${q.course}`] ||= []).push(q);
    app.innerHTML = `<h1>Quizzes</h1><p class="muted">${list.length} quizzes from your lessons.</p>` + Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([g, qs]) => `<h2>${esc(g)}</h2><div class="list">${qs.map((q) => {
        const last = store.get(`last:${q.path}`);
        return `<a class="item" href="#/q/${encodeURIComponent(q.path)}"><span>${esc(q.title)}<br><small>${q.questions} questions</small></span>`
          + `<span class="badge">${last ? `last ${last.right}/${last.total}` : 'not taken'}</span></a>`;
      }).join('')}</div>`).join('');
  }

  // ── Grading ──
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '').replace(/^0+(?=.)/, '');
  function grade(q, resp) {
    switch (q.type) {
      case 'mc': return resp === q.answer;
      case 'multi': return resp.length === q.answer.length && q.answer.every((a) => resp.includes(a));
      case 'tf': return resp === q.answer;
      case 'text': return [].concat(q.answer).some((a) => norm(a) === norm(resp));
      case 'num': {
        const v = Number(String(resp).replace(/,/g, ''));
        return Number.isFinite(v) && Math.abs(v - q.answer) <= (q.tolerance || 0);
      }
      default: return false;
    }
  }
  const answerText = (q) => {
    if (q.type === 'mc') return q.choices[q.answer];
    if (q.type === 'multi') return q.answer.map((i) => q.choices[i]).join('; ');
    if (q.type === 'tf') return q.answer ? 'True' : 'False';
    if (q.type === 'num') return `${q.answer}${q.tolerance ? ` (±${q.tolerance})` : ''}`;
    return [].concat(q.answer)[0];
  };

  // ── Quiz ──
  const cat = (q) => q.category || q.topic || 'General';

  // Equal draw: `per` questions from every category (all of a category if it has fewer),
  // rotating through question types inside a category so a draw isn't all one type.
  function draw(questions, per) {
    const byCat = {};
    questions.forEach((q, i) => (byCat[cat(q)] ||= []).push({ ...q, _i: i }));
    const picked = [];
    for (const qs of Object.values(byCat)) {
      const byType = {};
      for (const q of shuffle(qs)) (byType[q.type] ||= []).push(q);
      const lanes = shuffle(Object.values(byType));
      for (let taken = 0; taken < Math.min(per, qs.length);) {
        for (const lane of lanes) if (lane.length && taken < per) { picked.push(lane.shift()); taken++; }
      }
    }
    return picked;
  }

  async function showQuiz(path) {
    let quiz;
    try { quiz = await getJSON(`quizzes/${path}.json`); } catch (e) {
      app.innerHTML = `<p>Couldn't load quiz: ${esc(e.message)}</p><p><a href="#/">Back</a></p>`; return;
    }
    crumb.textContent = `/ ${quiz.course || ''} / ${quiz.title}`;
    showStart(quiz, path);
  }

  // Start screen: pick a quiz size, drawn equally from every category.
  function showStart(quiz, path) {
    keyHandler = null;
    const counts = {};
    for (const q of quiz.questions) counts[cat(q)] = (counts[cat(q)] || 0) + 1;
    const cats = Object.keys(counts);
    const total = quiz.questions.length;
    // 1–5 per category (a category with fewer questions gives all it has), then the whole quiz.
    const shown = [];
    for (let per = 1; per <= 5; per++) {
      const n = cats.reduce((s, c) => s + Math.min(per, counts[c]), 0);
      if (n < total && (!shown.length || n > shown[shown.length - 1].n)) shown.push({ per, n });
    }
    shown.push({ per: Infinity, n: total });
    const last = store.get(`last:${path}`);
    const saved = store.get(`size:${path}`);
    const pref = saved === 'all' ? Infinity : (saved ?? 1);
    app.innerHTML = `<div class="card"><h1>${esc(quiz.title)}</h1>
        <p class="muted">${total} questions across ${cats.length} categories${last ? ` · last attempt ${last.right}/${last.total}` : ''}</p>
        <h2>How many questions?</h2>
        <div class="choices">${shown.map((s, k) => `<button class="choice size${s.per === pref ? ' sel' : ''}" data-per="${s.per}">
          <span class="key">${k + 1}</span><span><strong>${s.n} questions</strong> · ${s.per === Infinity ? 'everything' : `${s.per} per category`}</span></button>`).join('')}</div>
        <div class="actions"><button class="btn" id="start">Start</button></div>
        <h2>Categories</h2><div class="topics">${cats.map((c) => `<div class="topic"><span>${esc(c)}</span><span></span><span class="muted">${counts[c]}</span></div>`).join('')}</div>
      </div>`;
    const btns = [...app.querySelectorAll('.size')];
    let per = btns.some((b) => b.classList.contains('sel')) ? Number(btns.find((b) => b.classList.contains('sel')).dataset.per) : 1;
    if (!btns.some((b) => b.classList.contains('sel'))) btns[0].classList.add('sel');
    const choose = (b) => { per = Number(b.dataset.per); btns.forEach((x) => x.classList.toggle('sel', x === b)); };
    btns.forEach((b) => b.addEventListener('click', () => choose(b)));
    const start = () => {
      store.set(`size:${path}`, per === Infinity ? 'all' : per);
      runQuiz(quiz, path, shuffle(draw(quiz.questions, per)));
    };
    app.querySelector('#start').onclick = start;
    keyHandler = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); start(); return; }
      const b = btns[Number(e.key) - 1];
      if (b) choose(b);
    };
  }

  function runQuiz(quiz, path, picked) {
    // Shuffle choice order unless the question fixes it; grading uses original indexes.
    const qs = picked.map((q) => ({ ...q, order: q.choices ? (q.fixed ? q.choices.map((_, i) => i) : shuffle(q.choices.map((_, i) => i))) : null }));
    const results = [];
    let n = 0;
    const render = () => {
      if (n >= qs.length) return finish();
      const q = qs[n];
      let resp = q.type === 'multi' ? [] : null;
      let submitted = false;
      const choiceList = q.type === 'tf' ? [{ i: true, html: 'True', k: 'T' }, { i: false, html: 'False', k: 'F' }]
        : q.order ? q.order.map((i, k) => ({ i, html: mdInline(q.choices[i]), k: String(k + 1) })) : null;

      app.innerHTML = `<div class="meta"><span>Question ${n + 1} of ${qs.length}</span><span>${esc(cat(q))}</span></div>
        <div class="progress"><div style="width:${(n / qs.length) * 100}%"></div></div>
        <div class="card">
          <div class="q">${md(q.q)}</div>
          ${q.type === 'multi' && !/select all/i.test(q.q) ? '<p class="muted" style="margin-top:-8px">Select all that apply.</p>' : ''}
          ${choiceList ? `<div class="choices">${choiceList.map((c) => `<button class="choice" data-i="${c.i}"><span class="key">${c.k}</span><span>${c.html}</span></button>`).join('')}</div>`
            : `<input type="text" id="free" autocomplete="off" spellcheck="false" placeholder="${q.type === 'num' ? 'Enter a number' : 'Type your answer'}">`}
          <div id="fb"></div>
          <div class="actions"><button class="btn" id="go" disabled>Check</button></div>
          <p class="hint">${choiceList ? (q.type === 'tf' ? 'T / F to choose' : '1–9 to choose') + ' · ' : ''}Enter to ${'check / continue'}</p>
        </div>`;

      const go = app.querySelector('#go');
      const buttons = [...app.querySelectorAll('.choice')];
      const free = app.querySelector('#free');
      const parseI = (v) => (v === 'true' ? true : v === 'false' ? false : Number(v));
      const pick = (btn) => {
        if (submitted) return;
        const i = parseI(btn.dataset.i);
        if (q.type === 'multi') {
          resp = resp.includes(i) ? resp.filter((x) => x !== i) : [...resp, i];
          btn.classList.toggle('sel');
        } else {
          resp = i;
          buttons.forEach((b) => b.classList.toggle('sel', b === btn));
        }
        go.disabled = q.type === 'multi' ? !resp.length : resp == null;
      };
      buttons.forEach((b) => b.addEventListener('click', () => pick(b)));
      if (free) {
        free.focus();
        free.addEventListener('input', () => { resp = free.value; go.disabled = !free.value.trim(); });
      }

      const submit = () => {
        if (submitted) { n++; return render(); }
        if (go.disabled) return;
        submitted = true;
        const ok = grade(q, resp);
        results.push({ q, ok, resp });
        buttons.forEach((b) => {
          b.disabled = true;
          const i = parseI(b.dataset.i);
          const correct = q.type === 'multi' ? q.answer.includes(i) : i === q.answer;
          const chosen = q.type === 'multi' ? resp.includes(i) : i === resp;
          if (correct) b.classList.add('right');
          else if (chosen) b.classList.add('wrong');
        });
        if (free) free.disabled = true;
        app.querySelector('#fb').innerHTML = `<div class="feedback ${ok ? 'good' : 'bad'}"><strong>${ok ? 'Correct' : 'Not quite'}</strong>`
          + `${ok || choiceList ? '' : `<p>Answer: ${mdInline(answerText(q))}</p>`}${q.explain ? md(q.explain) : ''}</div>`;
        go.textContent = n + 1 < qs.length ? 'Next' : 'See results';
        go.disabled = false;
        go.focus();
      };
      go.addEventListener('click', submit);
      keyHandler = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
        if (document.activeElement === free) return;
        const k = e.key.toUpperCase();
        const btn = buttons.find((b) => b.querySelector('.key').textContent === k);
        if (btn) pick(btn);
      };
    };

    const finish = () => {
      keyHandler = null;
      const right = results.filter((r) => r.ok).length;
      const pct = Math.round((right / results.length) * 100);
      store.set(`last:${path}`, { right, total: results.length });
      const topics = {};
      for (const r of results) { const t = (topics[cat(r.q)] ||= [0, 0]); t[1]++; if (r.ok) t[0]++; }
      const missed = results.filter((r) => !r.ok);
      app.innerHTML = `<div class="card"><div class="muted">${esc(quiz.title)} · ${results.length} questions</div>
          <div class="score">${pct}%</div><div class="muted">${right} of ${results.length} correct</div>
          <h2>By category</h2><div class="topics">${Object.entries(topics).sort((a, b) => a[1][0] / a[1][1] - b[1][0] / b[1][1]).map(([t, [r, n]]) =>
            `<div class="topic"><span>${esc(t)}</span><div class="bar"><div style="width:${(r / n) * 100}%;background:${r === n ? 'var(--good)' : r / n >= .5 ? 'var(--accent)' : 'var(--bad)'}"></div></div><span class="muted">${r}/${n}</span></div>`).join('')}</div>
          <div class="actions">
            ${missed.length ? '<button class="btn" id="retryMissed">Retry missed</button>' : ''}
            <button class="btn ghost" id="retryAll">New quiz</button>
            <button class="btn ghost" onclick="location.hash='#/'">All quizzes</button>
          </div></div>
        ${missed.length ? `<h2>Review</h2><div class="review">${missed.map((r) => `<div class="card"><div class="q">${md(r.q.q)}</div>
          <div class="feedback bad"><strong>Answer: ${mdInline(answerText(r.q))}</strong>${r.q.explain ? md(r.q.explain) : ''}</div></div>`).join('')}</div>` : ''}`;
      app.querySelector('#retryAll').onclick = () => showStart(quiz, path);
      const rm = app.querySelector('#retryMissed');
      if (rm) rm.onclick = () => runQuiz(quiz, path, shuffle(missed.map((r) => r.q)));
      window.scrollTo(0, 0);
    };

    render();
  }

  const route = () => {
    const m = location.hash.match(/^#\/q\/(.+)$/);
    window.scrollTo(0, 0);
    return m ? showQuiz(decodeURIComponent(m[1])) : showIndex();
  };
  window.addEventListener('hashchange', route);
  route();
})();
