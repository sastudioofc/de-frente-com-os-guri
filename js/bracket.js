// Chaveamento (mata-mata) com votação ao vivo.
import { sfx } from './sfx.js?v=__V__';
import { confetti } from './confetti.js?v=__V__';
import { makeThumb, uid, colorFor } from './images.js?v=__V__';

const EMPTY = { title: 'Chaveamento', phase: 'setup', entrants: [], rounds: [], seq: 0 };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const roundName = (matches) => ({ 1: 'Final', 2: 'Semifinal', 4: 'Quartas de final', 8: 'Oitavas de final', 16: '16 avos de final' }[matches] || `Rodada de ${matches * 2}`);

// ---------- lógica do chaveamento ----------
function build(entrants, shuffle) {
  const list = entrants.map((e) => e.id);
  if (shuffle) for (let i = list.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [list[i], list[j]] = [list[j], list[i]]; }
  let size = 2;
  while (size < list.length) size *= 2;
  const rounds = [];
  const r0 = [];
  for (let i = 0; i < size / 2; i++) r0.push({ a: list[i] ?? null, b: list[size - 1 - i] ?? null, w: null });
  rounds.push(r0);
  for (let n = size / 4; n >= 1; n /= 2) rounds.push(Array.from({ length: n }, () => ({ a: null, b: null, w: null })));
  // quem não tem adversário (bye) passa direto
  r0.forEach((m, i) => { if (!m.a || !m.b) setWinner(rounds, 0, i, m.a || m.b); });
  return rounds;
}
function setWinner(rounds, r, i, w) {
  rounds[r][i].w = w;
  if (r + 1 < rounds.length) rounds[r + 1][i >> 1][i % 2 === 0 ? 'a' : 'b'] = w;
}
function current(rounds) {
  for (let r = 0; r < rounds.length; r++)
    for (let i = 0; i < rounds[r].length; i++) { const m = rounds[r][i]; if (m.a && m.b && !m.w) return [r, i]; }
  return null;
}

export function setupBracket({ mesh, images, root, toast, onActivity, nameOf, getTierItems }) {
  const state = mesh.makeState('bracket', EMPTY, { maxBytes: 65536 });
  const votes = mesh.makeUserState('brvote', { k: '', c: '' });
  let myId = null;
  mesh.room.getSelf().then((s) => { myId = s.userId; render(); }).catch(() => {});
  let shuffle = true;
  let celebrating = null; // { r, i, w, until }
  let prev = null;
  let titleTimer = null;

  const S = () => state.get() || EMPTY;
  const entrant = (id) => S().entrants.find((e) => e.id === id);
  const update = (fn) => state.set((p) => fn(structuredClone(p && p.phase ? p : EMPTY)));
  const avStyle = (e) => {
    if (!e) return '';
    if (e.img) { const src = images.get(e.id); return src ? `background-image:url('${src}')` : `--item-bg:${colorFor(e.label)}`; }
    return `--item-bg:${colorFor(e.label)}`;
  };
  const initials = (e) => (e && !(e.img && images.get(e.id)) ? esc(e.label.slice(0, 2).toUpperCase()) : '');

  // ---------- telas ----------
  function renderSetup() {
    const s = S();
    root.innerHTML = `
      <div class="br-head">
        <input class="br-title" id="brTitle" maxlength="60" value="${esc(s.title)}" aria-label="Título do chaveamento" />
      </div>
      <div class="br-setup">
        <div class="br-card glass">
          <h3>Participantes <span class="hint" style="font-family:Inter">(${s.entrants.length}/32)</span></h3>
          <form class="inline-form" id="brAdd" autocomplete="off" style="flex-wrap:wrap">
            <input id="brAddText" maxlength="40" placeholder="Nome do participante…" />
            <button class="btn primary" type="submit"><svg><use href="#i-plus"/></svg>Adicionar</button>
            <label class="btn" style="flex-direction:row;color:var(--cream);font-size:15px;font-weight:500;letter-spacing:0"><svg><use href="#i-upload"/></svg>Imagens<input type="file" id="brFiles" accept="image/*" multiple hidden /></label>
          </form>
          <div class="br-entrants">${s.entrants.map((e) => `
            <span class="br-chip"><span class="av" style="${avStyle(e)}">${initials(e)}</span>${esc(e.label)}<button data-rm="${esc(e.id)}" title="Remover" type="button"><svg><use href="#i-x"/></svg></button></span>`).join('') || '<p class="hint">Nenhum participante ainda.</p>'}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" id="brImport" type="button"><svg><use href="#i-tier"/></svg>Puxar itens da Tier List</button>
            ${s.entrants.length ? '<button class="btn ghost" id="brClearE" type="button"><svg><use href="#i-trash"/></svg>Limpar</button>' : ''}
          </div>
        </div>
        <div class="br-card glass">
          <h3>Como funciona</h3>
          <p class="hint" style="font-size:14px;line-height:1.6">Monte a lista e comece. A cada duelo, <b>cada um vota</b> clicando no seu favorito. Quando todo mundo votar, qualquer um clica em <b>Decidir</b> e o vencedor avança. Se der empate, a moeda decide. 🪙</p>
          <div style="margin:14px 0 18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span class="hint" style="margin:0">Ordem:</span>
            <div class="seg"><button type="button" data-shuf="1" class="${shuffle ? 'active' : ''}">Sorteada</button><button type="button" data-shuf="0" class="${shuffle ? '' : 'active'}">Na ordem da lista</button></div>
          </div>
          <button class="btn primary big shine" id="brStart" type="button" style="width:100%" ${s.entrants.length < 2 ? 'disabled' : ''}><svg><use href="#i-trophy"/></svg>Começar chaveamento</button>
          ${s.entrants.length < 2 ? '<p class="hint">Precisa de pelo menos 2 participantes.</p>' : `<p class="hint">${s.entrants.length} participantes → ${Math.ceil(Math.log2(s.entrants.length))} rodadas.</p>`}
        </div>
      </div>`;
    const $ = (q) => root.querySelector(q);
    $('#brTitle').addEventListener('input', (e) => { clearTimeout(titleTimer); const v = e.target.value.slice(0, 60); titleTimer = setTimeout(() => update((x) => { x.title = v; return x; }), 400); });
    $('#brAdd').addEventListener('submit', (e) => {
      e.preventDefault();
      const l = $('#brAddText').value.trim();
      if (!l) return;
      if (S().entrants.length >= 32) { toast('Máximo de 32 participantes.'); return; }
      $('#brAddText').value = '';
      update((x) => { x.entrants.push({ id: uid(), label: l, img: false }); return x; });
      sfx('pop');
    });
    $('#brFiles').addEventListener('change', async (e) => {
      const files = [...e.target.files].slice(0, 32 - S().entrants.length);
      const add = [];
      for (const f of files) {
        try { const d = await makeThumb(f); const id = uid(); images.put(id, d); add.push({ id, label: f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 40) || 'Imagem', img: true }); } catch {}
      }
      if (add.length) { update((x) => { x.entrants.push(...add); return x; }); sfx('pop'); }
    });
    $('#brImport').addEventListener('click', () => {
      const items = getTierItems();
      if (!items.length) { toast('A Tier List está vazia.'); sfx('error'); return; }
      update((x) => {
        const have = new Set(x.entrants.map((e) => e.id));
        for (const it of items) if (!have.has(it.id) && x.entrants.length < 32) x.entrants.push({ id: it.id, label: it.label, img: it.img });
        return x;
      });
      sfx('whoosh');
      toast('Itens da Tier List adicionados (na ordem dos tiers).');
    });
    $('#brClearE')?.addEventListener('click', () => update((x) => { x.entrants = []; return x; }));
    root.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => update((x) => { x.entrants = x.entrants.filter((e) => e.id !== b.dataset.rm); return x; })));
    root.querySelectorAll('[data-shuf]').forEach((b) => b.addEventListener('click', () => { shuffle = b.dataset.shuf === '1'; renderSetup(); }));
    $('#brStart').addEventListener('click', () => {
      update((x) => { x.rounds = build(x.entrants, shuffle); x.phase = 'running'; x.seq = (x.seq || 0) + 1; return x; });
      sfx('vs');
    });
  }

  function voteKey(s, cur) { return `${s.seq}:${cur[0]}:${cur[1]}`; }
  function tally(s, cur) {
    const k = voteKey(s, cur);
    const all = votes.getAll() || {};
    const res = { a: [], b: [] };
    for (const [userId, v] of Object.entries(all)) {
      if (!v || v.k !== k || (v.c !== 'a' && v.c !== 'b')) continue;
      res[v.c].push(userId === myId ? 'Você' : (nameOf(userId) || 'Guri').split(' ')[0]);
    }
    return res;
  }

  function fighterHtml(e, side, t, total, mine, cls = '') {
    const n = t[side].length;
    const pct = total ? Math.round((n / total) * 100) : 0;
    return `<div class="fighter ${mine === side ? 'voted' : ''} ${cls}" data-side="${side}">
      <div class="pic" style="${avStyle(e)}">${e && !(e.img && images.get(e.id)) ? esc(e.label) : ''}</div>
      <div class="fname">${esc(e ? e.label : '?')}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="votes">${t[side].map((nm) => `<span>${esc(nm)}</span>`).join('')}</div>
    </div>`;
  }

  function treeHtml(s, cur) {
    return `<div class="bracket">${s.rounds.map((round, r) => `
      <div class="br-round"><h5>${roundName(round.length)}</h5>${round.map((m, i) => {
        const slot = (id, other) => {
          const e = id ? entrant(id) : null;
          let cls = !id ? (r === 0 ? 'bye' : 'tbd') : m.w ? (m.w === id ? 'win' : 'lose') : '';
          if (r === 0 && !id && other) cls = 'bye';
          return `<div class="br-slot ${cls}"><span class="av" style="${avStyle(e)}">${e ? initials(e) : ''}</span><span class="nm">${e ? esc(e.label) : r === 0 ? '— passa direto' : 'a definir'}</span></div>`;
        };
        const isCur = cur && cur[0] === r && cur[1] === i;
        return `<div class="br-match ${isCur ? 'current' : ''}">${slot(m.a, m.b)}${slot(m.b, m.a)}</div>`;
      }).join('')}</div>`).join('')}</div>`;
  }

  function renderRunning() {
    const s = S();
    let cur = current(s.rounds);
    let showing = cur;
    let celebrate = null;
    if (celebrating && performance.now() < celebrating.until) { showing = [celebrating.r, celebrating.i]; celebrate = celebrating; }
    const final = s.rounds[s.rounds.length - 1][0];
    const champ = !cur && final.w ? entrant(final.w) : null;

    let top = '';
    if (champ && !celebrate) {
      top = `<div class="champion">
        <div class="crown"><svg><use href="#i-crown"/></svg></div>
        <div class="pic" style="${avStyle(champ)}">${champ.img && images.get(champ.id) ? '' : esc(champ.label)}</div>
        <h2>${esc(champ.label)}</h2><p>Campeão · ${esc(s.title)}</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn primary" id="brAgain" type="button"><svg><use href="#i-shuffle"/></svg>Jogar de novo</button>
          <button class="btn" id="brEdit" type="button"><svg><use href="#i-sliders"/></svg>Editar participantes</button>
        </div></div>`;
    } else if (showing) {
      const m = s.rounds[showing[0]][showing[1]];
      const t = celebrate ? celebrate.tally : tally(s, showing);
      const total = t.a.length + t.b.length;
      const myVote = (votes.get() || {}).k === voteKey(s, showing) ? votes.get().c : '';
      const cls = (side) => (celebrate ? (m[side] === celebrate.w ? 'winner' : 'loser') : '');
      const peopleCount = 1 + [...mesh.peers.values()].length;
      top = `<div class="duel" data-key="${voteKey(s, showing)}">
        <div class="duel-round">${roundName(s.rounds[showing[0]].length)} · duelo ${showing[1] + 1} de ${s.rounds[showing[0]].length}</div>
        ${fighterHtml(entrant(m.a), 'a', t, total, myVote, cls('a'))}
        <div class="vs">VS</div>
        ${fighterHtml(entrant(m.b), 'b', t, total, myVote, cls('b'))}
        <div class="duel-actions">
          ${celebrate ? `<p class="hint" style="font-size:15px;color:var(--gold-2)">${esc(entrant(celebrate.w)?.label || '')} avança! ${celebrate.coin ? '🪙 (empate, a moeda decidiu)' : ''}</p>` : `
          <p class="hint">${total}/${peopleCount} votaram · clique no seu favorito</p>
          <button class="btn primary" id="brDecide" type="button" ${total ? '' : 'disabled'}><svg><use href="#i-crown"/></svg>Decidir</button>`}
        </div></div>`;
    }

    root.innerHTML = `
      <div class="br-head">
        <input class="br-title" id="brTitle" maxlength="60" value="${esc(s.title)}" aria-label="Título do chaveamento" />
        <button class="btn" id="brUndo" type="button" title="Volta o último resultado"><svg><use href="#i-reset"/></svg>Desfazer</button>
        <button class="btn danger" id="brRestart" type="button"><svg><use href="#i-x"/></svg>Encerrar</button>
      </div>
      ${top}
      ${treeHtml(s, cur)}`;
    const $ = (q) => root.querySelector(q);
    $('#brTitle').addEventListener('input', (e) => { clearTimeout(titleTimer); const v = e.target.value.slice(0, 60); titleTimer = setTimeout(() => update((x) => { x.title = v; return x; }), 400); });
    root.querySelectorAll('.duel .fighter').forEach((f) => f.addEventListener('click', () => {
      if (celebrate || !cur) return;
      votes.set({ k: voteKey(s, cur), c: f.dataset.side });
      sfx('vote');
      f.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    }));
    $('#brDecide')?.addEventListener('click', () => {
      const t = tally(s, cur);
      let side = t.a.length > t.b.length ? 'a' : t.b.length > t.a.length ? 'b' : null;
      let coin = false;
      if (!side) { side = Math.random() < 0.5 ? 'a' : 'b'; coin = true; }
      const [r, i] = cur;
      update((x) => {
        const c = current(x.rounds);
        if (!c || c[0] !== r || c[1] !== i) return x; // alguém já decidiu
        setWinner(x.rounds, r, i, x.rounds[r][i][side]);
        x.last = { r, i, coin, a: t.a, b: t.b };
        return x;
      });
    });
    $('#brUndo').addEventListener('click', () => update((x) => {
      // desfaz o último duelo decidido (que não seja bye)
      for (let r = x.rounds.length - 1; r >= 0; r--)
        for (let i = x.rounds[r].length - 1; i >= 0; i--) {
          const m = x.rounds[r][i];
          if (m.w && m.a && m.b && (r + 1 >= x.rounds.length || !x.rounds[r + 1][i >> 1].w)) {
            m.w = null;
            if (r + 1 < x.rounds.length) x.rounds[r + 1][i >> 1][i % 2 === 0 ? 'a' : 'b'] = null;
            x.seq++;
            x.last = null;
            return x;
          }
        }
      return x;
    }));
    $('#brRestart').addEventListener('click', () => { if (confirm('Encerrar o chaveamento e voltar pra lista de participantes?')) update((x) => { x.phase = 'setup'; x.rounds = []; x.last = null; return x; }); });
    $('#brAgain')?.addEventListener('click', () => { update((x) => { x.rounds = build(x.entrants, true); x.seq++; x.last = null; return x; }); sfx('vs'); });
    $('#brEdit')?.addEventListener('click', () => update((x) => { x.phase = 'setup'; x.rounds = []; x.last = null; return x; }));

    // imagens que faltam
    const need = S().entrants.filter((e) => e.img && !images.has(e.id)).map((e) => e.id);
    if (need.length) images.ensure(need);
  }

  function render() {
    const s = S();
    // preserva o que a pessoa está digitando (o render recria a tela)
    const a = document.activeElement;
    const keep = a && root.contains(a) && a.id ? { id: a.id, v: a.value, ss: a.selectionStart, se: a.selectionEnd } : null;
    if (s.phase === 'running' && s.rounds?.length) renderRunning();
    else renderSetup();
    if (keep) {
      const el = root.querySelector('#' + keep.id);
      if (el) { if (keep.id !== 'brTitle' || el.value !== keep.v) el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.ss, keep.se); } catch {} }
    }
  }

  // detecta resultado novo -> anima vencedor, depois mostra o próximo duelo
  state.onChange((val, ctx) => {
    const s = val && val.phase ? val : EMPTY;
    if (prev && s.phase === 'running' && s.last && prev.rounds?.length && s.rounds.length === prev.rounds.length) {
      const { r, i } = s.last;
      const before = prev.rounds[r]?.[i];
      const after = s.rounds[r]?.[i];
      if (before && after && !before.w && after.w) {
        celebrating = { r, i, w: after.w, coin: s.last.coin, tally: { a: s.last.a || [], b: s.last.b || [] }, until: performance.now() + 1900 };
        sfx('advance');
        const isFinal = r === s.rounds.length - 1;
        setTimeout(() => {
          celebrating = null;
          render();
          if (isFinal) { sfx('win'); confetti({ count: 220 }); }
          else sfx('vs');
        }, 1900);
      }
    }
    if (prev && prev.phase !== 'running' && s.phase === 'running' && ctx && !ctx.self) sfx('vs');
    if (ctx && !ctx.self) onActivity?.();
    prev = structuredClone(s);
    render();
  });
  votes.onChange((v, ctx) => {
    if (ctx && !ctx.self) sfx('tick');
    if (!celebrating) render();
  });

  prev = structuredClone(S());
  render();
  return { refresh: render };
}
