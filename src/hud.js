// DOM overlay: station bar, objectives, inventory, station panel (meters), hint line, toasts, modal.
const $ = id => document.getElementById(id);
const clamp01 = v => Math.max(0, Math.min(1, v));

export class Hud {
  constructor() {
    this.stationsEl = $('stations'); this.objEl = $('objectives'); this.invEl = $('inventory');
    this.panelEl = $('panel'); this.hintEl = $('hint'); this.toastEl = $('toasts');
    this.modalEl = $('modal'); this.modalBox = $('modalBox'); this.reticle = $('reticle');
    this.meters = {}; this._obj = ''; this._inv = ''; this._hint = null; this.buttons = {};
  }
  buildStations(list, onClick) {
    for (const s of list) {
      const b = document.createElement('button');
      b.textContent = s.label; b.disabled = !!s.locked;
      if (s.locked) b.title = 'Coming in the next phase';
      b.onclick = () => onClick(s.id);
      this.stationsEl.appendChild(b); this.buttons[s.id] = b;
    }
    const k = document.createElement('span'); k.className = 'keys'; k.textContent = 'A / D';
    this.stationsEl.appendChild(k);
  }
  setStation(activeId, targetId) {
    for (const [id, b] of Object.entries(this.buttons)) {
      b.classList.toggle('active', id === activeId);
      b.classList.toggle('target', id === targetId);
    }
  }
  setObjectives(items, title = 'Smelting') {
    const html = `<h3>${title}</h3>` + items.map(o =>
      `<div class="obj${o.done ? ' done' : ''}${o.active ? ' active' : ''}${o.optional ? ' optional' : ''}">${o.text}</div>`).join('');
    if (html !== this._obj) { this.objEl.innerHTML = html; this._obj = html; }
  }
  setInventory(html) { if (html !== this._inv) { this.invEl.innerHTML = html; this._inv = html; } }
  hint(text) { text = text || ''; if (text !== this._hint) { this.hintEl.textContent = text; this._hint = text; } }

  panel(title, defs) {
    const p = this.panelEl; p.innerHTML = ''; this.meters = {};
    const h = document.createElement('h3'); h.textContent = title; p.appendChild(h);
    for (const d of defs) {
      const row = document.createElement('div');
      row.className = 'row ' + (d.type || 'meter') + (d.cls ? ' ' + d.cls : '');
      const m = { el: row, d };
      if (d.type === 'text') { row.innerHTML = d.html || ''; m.html = d.html || ''; }
      else if (d.type === 'button') {
        const b = document.createElement('button'); b.textContent = d.label; b.onclick = d.onClick;
        row.appendChild(b); m.btn = b;
      } else {
        const span = d.max - d.min, pct = v => clamp01((v - d.min) / span) * 100;
        row.innerHTML = `<div class="lab"><span>${d.label}</span><span class="val"></span></div><div class="bar">` +
          (d.bands || []).map(b => `<div class="band ${b.cls}" style="left:${pct(b.from)}%;width:${pct(b.to) - pct(b.from)}%"></div>`).join('') +
          `<div class="fill"${d.color ? ` style="background:${d.color}"` : ''}></div>${d.marker ? '<div class="mark"></div>' : ''}</div>`;
        m.val = row.querySelector('.val'); m.fill = row.querySelector('.fill'); m.mark = row.querySelector('.mark');
      }
      this.meters[d.id] = m;
      p.appendChild(row);
    }
  }
  set(id, v, text) {
    const m = this.meters[id]; if (!m || !m.fill) return;
    const k = clamp01((v - m.d.min) / (m.d.max - m.d.min));
    m.fill.style.width = (k * 100).toFixed(1) + '%';
    if (m.mark) m.mark.style.left = (k * 100).toFixed(1) + '%';
    if (text !== undefined && m.val.textContent !== text) m.val.textContent = text;
  }
  text(id, html) { const m = this.meters[id]; if (m && m.html !== html) { m.el.innerHTML = html; m.html = html; } }
  enable(id, on) { const m = this.meters[id]; if (m && m.btn) m.btn.disabled = !on; }
  show(id, on) { const m = this.meters[id]; if (m) m.el.style.display = on ? '' : 'none'; }

  toast(text, kind = 'info', dur = 3.2) {
    // collapse repeats
    for (const el of this.toastEl.children) if (el.textContent === text) { el.remove(); }
    const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = text;
    this.toastEl.prepend(el);
    while (this.toastEl.children.length > 4) this.toastEl.lastChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, dur * 1000);
  }
  modal(html, buttons = []) {
    this.modalBox.innerHTML = html + '<div class="btns"></div>';
    const bw = this.modalBox.querySelector('.btns');
    for (const b of buttons) {
      const el = document.createElement('button'); el.textContent = b.label;
      el.onclick = () => { if (!b.keepOpen) this.closeModal(); b.onClick && b.onClick(); };
      bw.appendChild(el);
    }
    this.modalEl.hidden = false;
  }
  closeModal() { this.modalEl.hidden = true; }
  get modalOpen() { return !this.modalEl.hidden; }
  moveReticle(x, y) { this.reticle.style.left = x + 'px'; this.reticle.style.top = y + 'px'; }
}
