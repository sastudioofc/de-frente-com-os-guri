// Pauta compartilhada, cronômetro do episódio e chat.
// Tudo sincronizado entre os participantes pelo próprio Trystero (sem servidor).

const $ = (s) => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function linkify(text) {
  return escapeHtml(text).replace(/\b(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}
function hhmmss(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const s = String(t % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function setupExtras({ mesh, myName, toast, openDrawer, isDrawerOpen }) {
  // ---------------- cronômetro ----------------
  // running: startedAt (relógio de quem iniciou) + acumulado antes da última pausa
  const timer = mesh.makeState('timer', { running: false, startedAt: 0, acc: 0 });
  const box = $('#timerBox');
  const tick = () => {
    const t = timer.get() || {};
    const ms = (t.acc || 0) + (t.running ? Date.now() - t.startedAt : 0);
    $('#timerText').textContent = hhmmss(ms);
    box.classList.toggle('running', !!t.running);
    $('#timerToggle').textContent = t.running ? '⏸' : '▶';
  };
  setInterval(tick, 500);
  timer.onChange(tick, { replay: true });
  $('#timerToggle').addEventListener('click', () => {
    timer.set((t) => (t.running
      ? { running: false, startedAt: 0, acc: (t.acc || 0) + (Date.now() - t.startedAt) }
      : { running: true, startedAt: Date.now(), acc: t.acc || 0 }));
  });
  $('#timerReset').addEventListener('click', () => {
    if (confirm('Zerar o cronômetro pra todo mundo?')) timer.set({ running: false, startedAt: 0, acc: 0 });
  });

  // ---------------- pauta ----------------
  const agenda = mesh.makeState('agenda', { items: [] });
  const renderAgenda = () => {
    const items = (agenda.get() || {}).items || [];
    const list = $('#agendaList');
    list.innerHTML = '';
    const firstOpen = items.findIndex((i) => !i.done);
    items.forEach((it, idx) => {
      const li = document.createElement('li');
      li.className = (it.done ? 'done' : '') + (idx === firstOpen ? ' current' : '');
      li.innerHTML = `<span class="txt"></span><button class="rm" title="Remover" type="button">✕</button>`;
      li.querySelector('.txt').textContent = it.text;
      li.addEventListener('click', () =>
        agenda.set((a) => ({ items: a.items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)) })));
      li.querySelector('.rm').addEventListener('click', (e) => {
        e.stopPropagation();
        agenda.set((a) => ({ items: a.items.filter((x) => x.id !== it.id) }));
      });
      list.append(li);
    });
    const done = items.filter((i) => i.done).length;
    $('#agendaProgress').textContent = items.length ? `${done} de ${items.length} tópicos falados` : 'Nenhum tópico ainda.';
  };
  agenda.onChange(renderAgenda, { replay: true });
  renderAgenda();
  $('#agendaForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#agendaInput').value.trim();
    if (!text) return;
    agenda.set((a) => ({ items: [...((a && a.items) || []), { id: uid(), text, done: false }] }));
    $('#agendaInput').value = '';
  });

  // ---------------- chat ----------------
  const chat = mesh.makeAction('chat');
  let unread = 0;
  const badge = $('#chatBadge');
  const setUnread = (n) => {
    unread = n;
    badge.textContent = n > 9 ? '9+' : String(n);
    badge.classList.toggle('hidden', n === 0);
  };
  const addMsg = ({ name, text, ts }, mine) => {
    const list = $('#chatList');
    list.querySelector('.hint')?.remove();
    const time = new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = 'msg' + (mine ? ' mine' : '');
    div.innerHTML = `<div class="who">${escapeHtml(mine ? 'Você' : name)}<span class="when">${time}</span></div><div class="body">${linkify(text)}</div>`;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    list.append(div);
    if (atBottom || mine) list.scrollTop = list.scrollHeight;
  };
  chat.onMessage((data) => {
    if (!data || typeof data.text !== 'string') return;
    const msg = { name: String(data.name || 'Guri').slice(0, 30), text: data.text.slice(0, 1000), ts: Date.now() };
    addMsg(msg, false);
    if (!isDrawerOpen('chatDrawer')) {
      setUnread(unread + 1);
      toast(`💬 ${msg.name}: ${msg.text.slice(0, 60)}`, 3000);
    }
  });
  $('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#chatInput').value.trim();
    if (!text) return;
    const msg = { name: myName(), text, ts: Date.now() };
    chat.send({ name: msg.name, text });
    addMsg(msg, true);
    $('#chatInput').value = '';
  });

  return {
    onChatOpened() { setUnread(0); setTimeout(() => $('#chatInput').focus(), 50); },
  };
}
