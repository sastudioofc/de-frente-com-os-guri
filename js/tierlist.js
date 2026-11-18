// Tier List compartilhada: todo mundo vê e arrasta ao vivo.
import { sfx } from './sfx.js?v=__V__';
import { makeThumb, uid, colorFor } from './images.js?v=__V__';

export const DEFAULT_TIERS = [
  { id: 's', label: 'S', color: '#ff6b6b' },
  { id: 'a', label: 'A', color: '#ff9f5a' },
  { id: 'b', label: 'B', color: '#ffd166' },
  { id: 'c', label: 'C', color: '#f4e285' },
  { id: 'd', label: 'D', color: '#a8d672' },
  { id: 'f', label: 'F', color: '#7fc8d6' },
];
const EMPTY = { title: 'Tier List do episódio', tiers: DEFAULT_TIERS, items: {} };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function setupTierList({ mesh, images, root, toast, onActivity, nameOf }) {
  const state = mesh.makeState('tier', EMPTY, { maxBytes: 65536 });
  const dragPresence = mesh.makeUserState('tldrag', { id: null });
  let drag = null; // arrasto local em andamento
  let titleTimer = null;

  root.innerHTML = `
    <div class="tl-head">
      <input class="tl-title" id="tlTitle" maxlength="60" aria-label="Título da tier list" />
      <button class="btn" id="tlTiers"><svg><use href="#i-sliders"/></svg>Editar tiers</button>
      <button class="btn" id="tlReset"><svg><use href="#i-reset"/></svg>Devolver itens</button>
      <button class="btn danger" id="tlClear"><svg><use href="#i-trash"/></svg>Apagar tudo</button>
    </div>
    <div class="tl-layout">
    <div class="tl-board" id="tlBoard"></div>
    <div class="tl-pool-wrap">
      <div class="tl-pool-head">
        <h4>Itens pra classificar</h4>
        <form class="tl-add" id="tlAddForm" autocomplete="off">
          <input id="tlAddText" maxlength="40" placeholder="Nome do item…" />
          <button class="btn primary" type="submit"><svg><use href="#i-plus"/></svg>Texto</button>
          <label class="btn" style="flex-direction:row;color:var(--cream);font-size:15px;font-weight:500;letter-spacing:0">
            <svg><use href="#i-upload"/></svg>Imagens<input type="file" id="tlFiles" accept="image/*" multiple hidden />
          </label>
        </form>
      </div>
      <div class="tl-pool" id="tlPool" data-tier=""></div>
      <p class="hint">Dica: dá pra colar imagem com <b>Ctrl+V</b> ou arrastar arquivos do computador pra cá. O nome do arquivo vira o nome do item.</p>
    </div>
    </div>`;
  const $ = (s) => root.querySelector(s);

  // ---------- render com animação FLIP (itens deslizam pro lugar novo) ----------
  function snapshot() {
    const m = new Map();
    root.querySelectorAll('.tl-item[data-id]').forEach((el) => m.set(el.dataset.id, el.getBoundingClientRect()));
    return m;
  }
  function flip(before) {
    root.querySelectorAll('.tl-item[data-id]').forEach((el) => {
      const a = before.get(el.dataset.id);
      if (!a || el.classList.contains('ghost')) return;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
  }

  function itemEl(id, it) {
    const el = document.createElement('div');
    el.className = 'tl-item';
    el.dataset.id = id;
    el.title = it.l;
    if (it.img) {
      const src = images.get(id);
      el.innerHTML = `<img alt="" ${src ? `src="${src}"` : ''}/><span class="lbl">${esc(it.l)}</span>`;
      if (!src) el.classList.add('loading');
    } else {
      el.classList.add('text-only');
      el.style.setProperty('--item-bg', colorFor(it.l));
      el.innerHTML = `<span class="lbl">${esc(it.l)}</span>`;
    }
    el.insertAdjacentHTML('beforeend', `<button class="rm" title="Remover item" type="button"><svg><use href="#i-x"/></svg></button>`);
    return el;
  }

  function render(animate = true) {
    const s = state.get() || EMPTY;
    const before = animate ? snapshot() : null;
    if (document.activeElement !== $('#tlTitle')) $('#tlTitle').value = s.title || '';

    const board = $('#tlBoard');
    board.innerHTML = '';
    for (const t of s.tiers) {
      const row = document.createElement('div');
      row.className = 'tl-row';
      row.innerHTML = `<div class="tl-label${t.label.length > 3 ? ' long' : ''}" style="--c:${esc(t.color)}" title="Clique pra editar os tiers">${esc(t.label)}</div><div class="tl-items" data-tier="${esc(t.id)}"></div>`;
      board.append(row);
    }
    const pool = $('#tlPool');
    pool.innerHTML = '';
    const tierIds = new Set(s.tiers.map((t) => t.id));
    const entries = Object.entries(s.items || {}).sort((a, b) => a[1].o - b[1].o);
    const missing = [];
    for (const [id, it] of entries) {
      const target = it.t && tierIds.has(it.t) ? board.querySelector(`.tl-items[data-tier="${CSS.escape(it.t)}"]`) : pool;
      const el = itemEl(id, it);
      if (drag && drag.started && drag.id === id) el.classList.add('ghost');
      target.append(el);
      if (it.img && !images.has(id)) missing.push(id);
    }
    if (missing.length) images.ensure(missing);
    renderPresence();
    if (drag && drag.id) {
      // reposiciona o fantasma onde o mouse está
      const ghost = root.querySelector(`.tl-item[data-id="${CSS.escape(drag.id)}"]`);
      if (ghost) drag.ghost = ghost;
    }
    if (before) flip(before);
  }

  function renderPresence() {
    root.querySelectorAll('.tl-item .who').forEach((e) => e.remove());
    const all = dragPresence.getAll() || {};
    for (const [userId, v] of Object.entries(all)) {
      if (!v || !v.id) continue;
      const el = root.querySelector(`.tl-item[data-id="${CSS.escape(v.id)}"]`);
      const nm = nameOf(userId);
      if (el && nm) el.insertAdjacentHTML('beforeend', `<span class="who">${esc(nm.split(' ')[0])}</span>`);
    }
  }

  // ---------- atualizações ----------
  let lastSig = '';
  state.onChange((val, ctx) => {
    render(true);
    const sig = JSON.stringify(val);
    if (ctx && !ctx.self && sig !== lastSig) onActivity?.();
    lastSig = sig;
  });
  dragPresence.onChange(() => renderPresence());

  function update(fn) {
    state.set((prev) => fn(structuredClone(prev && prev.tiers ? prev : EMPTY)));
  }

  // ---------- adicionar itens ----------
  $('#tlAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const l = $('#tlAddText').value.trim();
    if (!l) return;
    const id = uid();
    update((s) => { s.items[id] = { l, t: null, o: Date.now(), img: false }; return s; });
    $('#tlAddText').value = '';
    sfx('pop');
  });

  async function addImages(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/')).slice(0, 30);
    if (!list.length) return;
    const count = Object.keys((state.get() || EMPTY).items).length;
    if (count + list.length > 60) { toast('Máximo de 60 itens por tier list.'); sfx('error'); return; }
    const added = [];
    for (const f of list) {
      try {
        const d = await makeThumb(f);
        const id = uid();
        images.put(id, d);
        const name = (f.name || 'Imagem').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 40) || 'Imagem';
        added.push([id, { l: name, t: null, o: Date.now() + added.length, img: true }]);
      } catch (err) { console.warn('imagem inválida', err); }
    }
    if (!added.length) return;
    update((s) => { for (const [id, it] of added) s.items[id] = it; return s; });
    sfx('pop');
    toast(`${added.length} ${added.length === 1 ? 'item adicionado' : 'itens adicionados'}`);
  }
  $('#tlFiles').addEventListener('change', (e) => { addImages(e.target.files); e.target.value = ''; });
  const pool = $('#tlPool');
  pool.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); pool.classList.add('over'); } });
  pool.addEventListener('dragleave', () => pool.classList.remove('over'));
  pool.addEventListener('drop', (e) => { e.preventDefault(); pool.classList.remove('over'); addImages(e.dataTransfer.files); });
  document.addEventListener('paste', (e) => {
    if (root.classList.contains('hidden') || e.target.matches('input, textarea')) return;
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) addImages(files);
  });

  // ---------- título / tiers / limpar ----------
  $('#tlTitle').addEventListener('input', (e) => {
    clearTimeout(titleTimer);
    const v = e.target.value.slice(0, 60);
    titleTimer = setTimeout(() => update((s) => { s.title = v; return s; }), 400);
  });
  $('#tlReset').addEventListener('click', () => {
    update((s) => { for (const it of Object.values(s.items)) it.t = null; return s; });
    sfx('whoosh');
  });
  $('#tlClear').addEventListener('click', () => {
    if (!confirm('Apagar todos os itens da tier list pra todo mundo?')) return;
    update((s) => { s.items = {}; return s; });
    sfx('whoosh');
  });
  $('#tlTiers').addEventListener('click', openTierEditor);
  root.addEventListener('click', (e) => {
    if (e.target.closest('.tl-label')) openTierEditor();
    const rm = e.target.closest('.tl-item .rm');
    if (rm) {
      const id = rm.closest('.tl-item').dataset.id;
      const el = rm.closest('.tl-item');
      el.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.5)', opacity: 0 }], { duration: 200, easing: 'ease-in' }).onfinish = () =>
        update((s) => { delete s.items[id]; return s; });
      sfx('pop');
    }
  });

  function openTierEditor() {
    const s = state.get() || EMPTY;
    let tiers = structuredClone(s.tiers);
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `<h3>Editar tiers</h3><div class="tier-edit"></div>
      <div class="dialog-actions" style="justify-content:space-between">
        <span style="display:flex;gap:8px"><button class="btn" data-a="add" type="button"><svg><use href="#i-plus"/></svg>Tier</button><button class="btn ghost" data-a="def" type="button">Padrão (S–F)</button></span>
        <span style="display:flex;gap:8px"><button class="btn" data-a="cancel" type="button">Cancelar</button><button class="btn primary" data-a="save" type="button">Salvar</button></span>
      </div>`;
    document.body.append(dlg);
    const box = dlg.querySelector('.tier-edit');
    const draw = () => {
      box.innerHTML = '';
      tiers.forEach((t, i) => {
        const r = document.createElement('div');
        r.className = 'te-row';
        r.innerHTML = `<input type="color" value="${esc(t.color)}" /><input type="text" maxlength="24" value="${esc(t.label)}" />
          <button class="btn icon-btn" data-up title="Subir" type="button">↑</button><button class="btn icon-btn danger" data-del title="Remover" type="button"><svg><use href="#i-trash"/></svg></button>`;
        r.querySelector('[type=color]').oninput = (e) => (t.color = e.target.value);
        r.querySelector('[type=text]').oninput = (e) => (t.label = e.target.value);
        r.querySelector('[data-up]').onclick = () => { if (i > 0) { [tiers[i - 1], tiers[i]] = [tiers[i], tiers[i - 1]]; draw(); } };
        r.querySelector('[data-del]').onclick = () => { tiers.splice(i, 1); draw(); };
        box.append(r);
      });
    };
    draw();
    dlg.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'add' && tiers.length < 12) { tiers.push({ id: uid(), label: 'Novo', color: '#c9a14a' }); draw(); }
      if (a === 'def') { tiers = structuredClone(DEFAULT_TIERS); draw(); }
      if (a === 'cancel') dlg.close();
      if (a === 'save') {
        const clean = tiers.map((t) => ({ id: t.id, label: (t.label || '?').trim().slice(0, 24) || '?', color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#c9a14a' }));
        update((st) => { st.tiers = clean; const ids = new Set(clean.map((t) => t.id)); for (const it of Object.values(st.items)) if (it.t && !ids.has(it.t)) it.t = null; return st; });
        sfx('toggleOn');
        dlg.close();
      }
    });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
  }

  // ---------- arrastar (mouse e toque) ----------
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.tl-item');
    if (!el || e.target.closest('.rm') || e.button > 0) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    drag = { id: el.dataset.id, startX: e.clientX, startY: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top, started: false, el, ghost: el, clone: null, pid: e.pointerId };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
      drag.started = true;
      const clone = drag.el.cloneNode(true);
      clone.classList.add('dragging');
      clone.querySelector('.rm')?.remove();
      clone.style.width = drag.el.offsetWidth + 'px';
      clone.style.height = drag.el.offsetHeight + 'px';
      document.body.append(clone);
      drag.clone = clone;
      drag.ghost.classList.add('ghost');
      dragPresence.set({ id: drag.id });
      sfx('pick');
    }
    drag.clone.style.left = e.clientX - drag.offX + 'px';
    drag.clone.style.top = e.clientY - drag.offY + 'px';
    drag.x = e.clientX;
    drag.y = e.clientY;
    moveGhost(e.clientX, e.clientY);
    if (!drag.scroller) drag.scroller = requestAnimationFrame(autoScroll);
  });
  // rola a lista sozinho quando o item chega perto da borda
  function autoScroll() {
    if (!drag || !drag.started) return;
    drag.scroller = null;
    const scrollers = [root, root.querySelector('.tl-pool')].filter(Boolean);
    let moved = false;
    for (const sc of scrollers) {
      if (sc.scrollHeight <= sc.clientHeight) continue;
      const r = sc.getBoundingClientRect();
      if (drag.x < r.left || drag.x > r.right) continue;
      const edge = 70;
      let dy = 0;
      if (drag.y < r.top + edge && drag.y > r.top - 40) dy = -Math.ceil((r.top + edge - drag.y) / 5);
      else if (drag.y > r.bottom - edge && drag.y < r.bottom + 40) dy = Math.ceil((drag.y - (r.bottom - edge)) / 5);
      if (dy) { sc.scrollTop += dy; moved = true; break; }
    }
    if (moved) { moveGhost(drag.x, drag.y); drag.scroller = requestAnimationFrame(autoScroll); }
  }
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    root.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
    if (!d.started) return;
    dragPresence.set({ id: null });
    const ghost = d.ghost;
    const container = ghost.parentElement;
    const tier = container?.dataset.tier || null;
    // ordem nova = meio entre os vizinhos
    const s = state.get() || EMPTY;
    const sib = [...container.querySelectorAll('.tl-item[data-id]')];
    const idx = sib.indexOf(ghost);
    const prevO = idx > 0 ? s.items[sib[idx - 1].dataset.id]?.o : null;
    const nextO = idx < sib.length - 1 ? s.items[sib[idx + 1].dataset.id]?.o : null;
    let o;
    if (prevO != null && nextO != null) o = (prevO + nextO) / 2;
    else if (prevO != null) o = prevO + 1000;
    else if (nextO != null) o = nextO - 1000;
    else o = Date.now();
    // animação de pouso: o clone voa até o lugar
    const tr = ghost.getBoundingClientRect();
    const cr = d.clone.getBoundingClientRect();
    d.clone.animate(
      [{ transform: 'rotate(-4deg) scale(1.12)', left: cr.left + 'px', top: cr.top + 'px' }, { transform: 'none', left: tr.left + 'px', top: tr.top + 'px' }],
      { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' },
    ).onfinish = () => {
      d.clone.remove();
      ghost.classList.remove('ghost');
      ghost.classList.add('landed');
    };
    sfx('drop');
    const id = d.id;
    update((st) => { if (st.items[id]) { st.items[id].t = tier; st.items[id].o = o; } return st; });
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  function moveGhost(x, y) {
    const under = document.elementFromPoint(x, y);
    const container = under?.closest('.tl-items, .tl-pool');
    root.querySelectorAll('.over').forEach((el) => el !== container?.closest('.tl-row, .tl-pool') && el.classList.remove('over'));
    if (!container) return;
    (container.closest('.tl-row') || container).classList.add('over');
    const items = [...container.querySelectorAll('.tl-item[data-id]')].filter((el) => el !== drag.ghost);
    let before = null;
    for (const el of items) {
      const r = el.getBoundingClientRect();
      if (y < r.top) { before = el; break; }
      if (y <= r.bottom && x < r.left + r.width / 2) { before = el; break; }
    }
    if (drag.ghost.parentElement === container && drag.ghost.nextElementSibling === before) return;
    const snap = snapshot();
    container.insertBefore(drag.ghost, before);
    flip(snap);
  }

  images.onUpdate = (id) => {
    const el = root.querySelector(`.tl-item[data-id="${CSS.escape(id)}"]`);
    if (el) { const img = el.querySelector('img'); if (img) img.src = images.get(id); el.classList.remove('loading'); }
    onImage?.(id);
  };
  let onImage = null;

  render(false);
  return {
    getItems() {
      const s = state.get() || EMPTY;
      const order = new Map(s.tiers.map((t, i) => [t.id, i]));
      return Object.entries(s.items)
        .sort((a, b) => (order.get(a[1].t) ?? 99) - (order.get(b[1].t) ?? 99) || a[1].o - b[1].o)
        .map(([id, it]) => ({ id, label: it.l, img: it.img, tier: it.t }));
    },
    setImageListener(fn) { onImage = fn; },
    refresh: () => render(false),
  };
}
