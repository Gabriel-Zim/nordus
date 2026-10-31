// Nordus: ensinar uma tarefa (frente G). Script injetado em cada pagina do Chrome do robo enquanto grava.
// Fala com o servidor pelo binding "__nordusTeach" (Runtime.addBinding). Regra de ouro: o valor de um campo
// secreto (senha, codigo de uso unico, cartao, chave) NUNCA entra no payload; o servidor confere de novo.
import { TEACH_SECRET_AUTOCOMPLETE_SOURCE, TEACH_SECRET_FIELD_SOURCE } from "../../shared/teach.ts";

export const TEACH_BINDING = "__nordusTeach";

export const TEACH_PAGE_SCRIPT = String.raw`(() => {
  if (window.__nordusTeachOn) return;
  try { Object.defineProperty(window, '__nordusTeachOn', { value: true, configurable: true }); } catch { window.__nordusTeachOn = true; }
  const SECRET = new RegExp(${JSON.stringify(TEACH_SECRET_FIELD_SOURCE)}, 'i');
  const AUTO = new RegExp(${JSON.stringify(TEACH_SECRET_AUTOCOMPLETE_SOURCE)}, 'i');
  const send = (o) => { try { if (typeof window.${TEACH_BINDING} === 'function') window.${TEACH_BINDING}(JSON.stringify(o)); } catch {} };
  const squash = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
  const CLICKABLE = 'a,button,[role],input[type=submit],input[type=button],input[type=checkbox],input[type=radio],label,summary,[onclick]';
  const IMPLICIT = { a: 'link', button: 'button', summary: 'button', label: 'label', select: 'combobox', textarea: 'textbox' };

  const labelOf = (el) => {
    const labelled = (el.getAttribute && el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map((id) => { const n = document.getElementById(id); return n ? n.textContent : ''; }).join(' ');
    const labels = el.labels ? Array.from(el.labels).map((l) => l.textContent).join(' ') : '';
    return squash(labelled || el.getAttribute('aria-label') || labels || el.getAttribute('placeholder') ||
      el.getAttribute('title') || el.getAttribute('name') || el.id || '', 80);
  };
  const isField = (el) => {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') return !['checkbox', 'radio', 'file', 'hidden', 'submit', 'button', 'reset', 'image', 'range', 'color'].includes((el.type || '').toLowerCase());
    return el.isContentEditable === true;
  };
  const secretKind = (el) => {
    const type = (el.type || '').toLowerCase();
    const auto = el.getAttribute ? (el.getAttribute('autocomplete') || '') : '';
    const text = [el.name, el.id, el.getAttribute && el.getAttribute('aria-label'), el.getAttribute && el.getAttribute('placeholder'),
      el.labels ? Array.from(el.labels).map((l) => l.textContent).join(' ') : ''].join(' ');
    if (type === 'password') return 'password';
    if (!(AUTO.test(auto) || SECRET.test(text))) return '';
    const probe = auto + ' ' + text;
    if (/cc-|cvc|cvv|card|cart[aã]o/i.test(probe)) return 'card';
    if (/one.?time|otp|2fa|mfa|security.?code|c[oó]digo|verif/i.test(probe)) return 'code';
    if (/password|passwd|passcode|pwd|senha/i.test(probe)) return 'password';
    return 'secret';
  };
  const selectorOf = (el) => {
    const q = (s) => { try { return document.querySelectorAll(s).length === 1; } catch { return false; } };
    if (el.id && !/\d{4,}/.test(el.id) && q('#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
    for (const attr of ['data-testid', 'name', 'aria-label']) {
      const v = el.getAttribute && el.getAttribute(attr);
      if (v && v.length < 60) {
        const s = el.tagName.toLowerCase() + '[' + attr + '=' + JSON.stringify(v) + ']';
        if (q(s)) return s;
      }
    }
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 4 && n !== document.body; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      let idx = 1;
      for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) idx++;
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
    }
    return parts.join(' > ');
  };

  document.addEventListener('click', (e) => {
    const target = e.target && e.target.closest ? e.target.closest(CLICKABLE) : null;
    if (!target) return;
    const tag = target.tagName.toLowerCase();
    const type = (target.type || '').toLowerCase();
    const buttonish = tag === 'input' && ['submit', 'button'].includes(type);
    const text = squash((buttonish ? target.value : '') || target.getAttribute('aria-label') ||
      (tag === 'input' ? labelOf(target) : target.innerText) || target.getAttribute('title') || target.getAttribute('alt') || '', 80);
    const role = target.getAttribute('role') || (tag === 'input' ? (['checkbox', 'radio'].includes(type) ? type : buttonish ? 'button' : 'textbox') : (IMPLICIT[tag] || tag));
    send({ t: 'click', text, role, selector: selectorOf(target), inputType: type, autocomplete: target.getAttribute('autocomplete') || '' });
  }, true);

  const lastSent = new WeakMap();
  const flush = (el) => {
    if (!isField(el)) return;
    const secret = secretKind(el);
    const field = labelOf(el);
    const base = { t: 'type', field, selector: selectorOf(el), inputType: (el.type || '').toLowerCase(), autocomplete: el.getAttribute('autocomplete') || '' };
    if (secret) {
      // Nunca le o valor de um campo secreto: so avisa que houve digitacao.
      if (lastSent.get(el) === '\u0000secret') return;
      lastSent.set(el, '\u0000secret');
      send({ ...base, secret });
      return;
    }
    const value = (el.isContentEditable && !('value' in el) ? el.innerText : el.value) || '';
    if (lastSent.get(el) === value || !value) return;
    lastSent.set(el, value);
    send({ ...base, value: String(value).slice(0, 2000) });
  };
  document.addEventListener('change', (e) => flush(e.target), true);
  document.addEventListener('blur', (e) => flush(e.target), true);

  const SPECIAL = new Set(['Enter', 'Escape', 'Tab', 'Delete']);
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const plain = SPECIAL.has(e.key) || (e.key === 'Backspace' && mod);
    const chord = mod && e.key.length === 1;
    if (!plain && !chord) return;
    const active = document.activeElement;
    if (e.key === 'Enter' || e.key === 'Tab') flush(active);
    const key = (e.ctrlKey ? 'Ctrl+' : '') + (e.metaKey ? 'Cmd+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey && chord ? 'Shift+' : '') + (chord ? e.key.toUpperCase() : e.key);
    send({ t: 'key', key, field: isField(active) ? labelOf(active) : '' });
  }, true);

  const lastScroll = new Map();
  let scrollTimer = 0;
  let scrollFrom = null;
  document.addEventListener('scroll', (e) => {
    const el = e.target === document || e.target === document.documentElement ? null : e.target;
    const y = el ? el.scrollTop : window.scrollY;
    if (scrollFrom === null) scrollFrom = lastScroll.get(el) || 0;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const delta = y - scrollFrom;
      lastScroll.set(el, y);
      scrollFrom = null;
      if (delta) send({ t: 'scroll', direction: delta > 0 ? 'down' : 'up', amount: Math.abs(Math.round(delta)) });
    }, 600);
  }, true);
})()`;
