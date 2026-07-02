/**
 * Content script — injected into every page.
 * Self-contained (no imports), communicates with background via sendMessage.
 */
const LOG = (...args) => console.log('[Malim:content]', ...args);
const ERR = (...args) => console.error('[Malim:content]', ...args);
LOG('Content script loaded');

let activePopover = null;
let activeDictPopover = null;
let pressTimer = null;
let currentWrapper = null;

// ── Keep SW alive ────────────────────────────────────────────
// Chrome terminates the service worker when idle.  Keeping a
// port open prevents that.  We also re-connect on disconnect.
(function connectBg() {
  try {
    const p = chrome.runtime.connect({ name: 'malim-keepalive' });
    p.onDisconnect.addListener(() => setTimeout(connectBg, 200));
  } catch (_) {
    setTimeout(connectBg, 200);
  }
})();

// ── Message handlers ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  LOG('onMessage:', msg.type);
  switch (msg.type) {
    case 'malim:parse_selection':
      handleSelectionParse(msg.text);
      break;
    case 'malim:parse_result':
      applyParseResult(msg.sentences);
      break;
    case 'malim:error':
      ERR('Error:', msg.error);
      restoreOriginalText();
      showError(msg.error);
      break;
  }
});

// ── Selection → placeholder → parse ──────────────────────────

function handleSelectionParse(text) {
  if (!text || !text.trim()) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const selectedText = range.toString().trim();
  if (!selectedText) return;

  const wrapper = document.createElement('span');
  wrapper.className = 'malim-parse-wrapper';
  wrapper.dataset.malimParse = '1';
  wrapper.dataset.originalText = selectedText;
  currentWrapper = wrapper;

  try {
    range.deleteContents();
    const textNode = document.createTextNode(selectedText);
    wrapper.appendChild(textNode);
    range.insertNode(wrapper);
    sel.removeAllRanges();
  } catch (e) {
    ERR('DOM error:', e);
    return;
  }

  // Blur overlay + hourglass spinner
  const overlay = document.createElement('div');
  overlay.className = 'malim-parsing-overlay';
  const svgNS = 'http://www.w3.org/2000/svg';
  const spinSvg = document.createElementNS(svgNS, 'svg');
  spinSvg.setAttribute('class', 'malim-parsing-spinner');
  spinSvg.setAttribute('width', '26');
  spinSvg.setAttribute('height', '26');
  spinSvg.setAttribute('viewBox', '0 0 24 24');
  spinSvg.setAttribute('fill', 'none');
  spinSvg.setAttribute('stroke', 'currentColor');
  spinSvg.setAttribute('stroke-width', '1.6');
  spinSvg.setAttribute('stroke-linecap', 'round');
  spinSvg.setAttribute('stroke-linejoin', 'round');
  const g = document.createElementNS(svgNS, 'g');
  g.innerHTML = '<path d="M5 3h14M5 3 9 8l3 3M19 3 15 8l-3 3"/><path d="M5 21h14M5 21 9 16l3-3M19 21 15 16l-3-3"/><circle cx="12" cy="4.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="19.5" r="1.3" fill="currentColor" stroke="none"/>';
  spinSvg.appendChild(g);
  overlay.appendChild(spinSvg);
  wrapper.appendChild(overlay);

  LOG('sending malim:parse');
  chrome.runtime.sendMessage({ type: 'malim:parse', text: selectedText })
    .catch(e => ERR('sendMessage:', e.message));
}

// ── Restore original text on failure ─────────────────────────

function restoreOriginalText() {
  if (!currentWrapper) return;
  const orig = currentWrapper.dataset.originalText;
  if (orig) {
    currentWrapper.textContent = '';
    currentWrapper.className = 'malim-parse-wrapper';
    currentWrapper.appendChild(document.createTextNode(orig));
  }
  currentWrapper = null;
}

// ── Apply parse result ───────────────────────────────────────

function applyParseResult(sentences) {
  const wrapper = document.querySelector('.malim-parse-wrapper');
  if (!wrapper) return;
  wrapper.textContent = '';
  wrapper.className = 'malim-parse-wrapper malim-parsed';
  for (let si = 0; si < sentences.length; si++) {
    const s = sentences[si];
    if (si > 0) wrapper.appendChild(document.createTextNode(' '));
    for (const block of s.blocks) {
      const token = document.createElement('span');
      token.className = getBlockClasses(block).join(' ');
      token.textContent = block.text;
      token.dataset.def = block.definition || '';
      token.dataset.lemma = block.lemma || '';
      token.dataset.pos = block.pos || '';
      token.dataset.case = block.gram_case != null ? String(block.gram_case) : '';
      token.dataset.gender = block.gram_gender || '';
      token.dataset.num = block.gram_number || '';
      token.dataset.tense = block.tense || '';
      token.dataset.asp = block.aspect || '';
      token.dataset.note = block.grammar_note || '';
      token.setAttribute('role', 'button');
      token.tabIndex = -1;
      if (block.gram_case) {
        const sup = document.createElement('sup');
        sup.className = 'malim-case-sup';
        sup.textContent = String(block.gram_case);
        token.appendChild(sup);
      }
      wrapper.appendChild(token);
    }
  }
  currentWrapper = null;
}

// ── Color classes ────────────────────────────────────────────

function getBlockClasses(block) {
  const pos = block.pos || '';
  if (pos === 'punctuation') return ['malim-token', 'malim-punct'];
  if (pos === 'unknown' || pos === 'error') return ['malim-token', 'malim-unknown'];
  if (pos === 'noun' || pos === 'pronoun') {
    const g = block.gram_gender || '';
    if (g === 'm') return ['malim-token', 'malim-gender-masc'];
    if (g === 'f') return ['malim-token', 'malim-gender-fem'];
    if (g === 'n') return ['malim-token', 'malim-gender-neut'];
    return ['malim-token', 'malim-noun'];
  }
  if (pos === 'verb') return ['malim-token', 'malim-verb'];
  if (pos === 'adjective') return ['malim-token', 'malim-adj'];
  if (pos === 'adverb') return ['malim-token', 'malim-adverb'];
  if (['preposition', 'conjunction', 'particle'].includes(pos)) return ['malim-token', 'malim-particle'];
  if (pos === 'article') return ['malim-token', 'malim-article'];
  return ['malim-token', 'malim-unknown'];
}

// ── Event delegation ─────────────────────────────────────────

document.addEventListener('click', (e) => {
  const token = e.target.closest('.malim-token');
  if (token) { e.stopPropagation(); handleTokenClick(e, token); return; }
  if (!e.target.closest('.malim-popover') && !e.target.closest('.malim-dict-popover')) closePopovers();
}, true);

document.addEventListener('contextmenu', (e) => {
  const token = e.target.closest('.malim-token');
  if (token && !token.classList.contains('malim-punct')) { e.preventDefault(); handleTokenRightClick(token); }
}, true);

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopovers(); });

document.addEventListener('pointerdown', (e) => {
  const token = e.target.closest('.malim-token');
  if (token && !token.classList.contains('malim-punct')) pressTimer = setTimeout(() => handleTokenRightClick(token), 500);
}, true);
document.addEventListener('pointerup', () => { clearTimeout(pressTimer); pressTimer = null; });
document.addEventListener('pointercancel', () => { clearTimeout(pressTimer); pressTimer = null; });

function handleTokenClick(_event, tokenEl) {
  const pos = tokenEl.dataset.pos;
  if (pos === 'punctuation' || pos === 'unknown' || pos === 'error') return;
  closePopovers();
  showWordPopover(tokenEl, {
    text: tokenEl.textContent.trim(),
    pos, definition: tokenEl.dataset.def || '',
    lemma: tokenEl.dataset.lemma || null,
    gram_case: tokenEl.dataset.case ? parseInt(tokenEl.dataset.case, 10) : null,
    gram_gender: tokenEl.dataset.gender || null,
    gram_number: tokenEl.dataset.num || null,
    tense: tokenEl.dataset.tense || null,
    aspect: tokenEl.dataset.asp || null,
    grammar_note: tokenEl.dataset.note || null,
  });
}

function handleTokenRightClick(tokenEl) {
  const lemma = tokenEl.dataset.lemma || tokenEl.textContent.trim();
  if (!lemma) return;
  closePopovers();
  showDictPopover(tokenEl, lemma);
}

// ── Word Popover ──────────────────────────────────────────────

function showWordPopover(tokenEl, block) {
  const rect = tokenEl.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const pw = 260, gap = 10, arrowW = 12;
  const cx = rect.left + rect.width / 2;
  let left = Math.max(10, Math.min(cx - pw / 2, vw - pw - 20));
  let arrowLeft = Math.max(8, Math.min(cx - left - arrowW / 2, pw - arrowW - 8));
  const onTop = vh - rect.bottom < 250 && rect.top > vh - rect.bottom;
  const pop = document.createElement('div');
  pop.className = 'malim-popover';
  pop.style.left = left + 'px';
  pop.style.top = (onTop ? rect.top - gap : rect.bottom + gap) + 'px';
  pop.style.transform = onTop ? 'translateY(-100%)' : 'none';
  let h = '<div class="malim-popover-inner">';
  if (block.gram_number === 'pl') h += '<div class="malim-popover-badge">P</div>';
  h += `<div class="malim-popover-def">${esc(block.definition)}</div>`;
  if (block.pos === 'verb') {
    h += '<div class="malim-popover-grammar-row">';
    if (block.tense) h += `<span class="malim-grammar-tag malim-tag-tense">${block.tense}</span>`;
    if (block.aspect) h += `<span class="malim-grammar-tag ${block.aspect === 'pf' ? 'malim-tag-pf' : 'malim-tag-impf'}">${block.aspect === 'pf' ? 'PF' : 'IPF'}</span>`;
    h += '</div>';
  }
  if (block.lemma) h += `<div class="malim-popover-lemma"><span class="malim-popover-lemma-label">Lemma:</span> <span class="malim-popover-lemma-value">${esc(block.lemma)}</span></div>`;
  if (block.grammar_note) h += `<div class="malim-popover-note">${esc(block.grammar_note)}</div>`;
  h += '</div>';
  h += `<div class="malim-popover-arrow" style="${onTop ? 'bottom:-' + (arrowW/2) + 'px;' : 'top:-' + (arrowW/2) + 'px;'}left:${arrowLeft}px;"></div>`;
  pop.innerHTML = h;
  document.body.appendChild(pop);
  activePopover = pop;
}

// ── Dictionary Popover ───────────────────────────────────────

async function showDictPopover(tokenEl, lemma) {
  const rect = tokenEl.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const dpw = 380, gap = 10;
  const cx = rect.left + rect.width / 2;
  let left = Math.max(10, Math.min(cx - dpw / 2, vw - dpw - 20));
  const onTop = vh - rect.bottom < 300 && rect.top > vh - rect.bottom;
  const pop = document.createElement('div');
  pop.className = 'malim-dict-popover';
  pop.innerHTML = '<div class="malim-dict-empty">Loading dictionary...</div>';
  pop.style.left = left + 'px';
  pop.style.top = (onTop ? rect.top - gap : rect.bottom + gap) + 'px';
  pop.style.transform = onTop ? 'translateY(-100%)' : 'none';
  document.body.appendChild(pop);
  activeDictPopover = pop;

  try {
    const result = await chrome.runtime.sendMessage({ type: 'malim:dict_lookup', word: lemma });
    if (result && result.definition) {
      let def = result.definition.replace(/<link[^>]*href="[^"]*style\.css"[^>]*>/g, '');
      pop.innerHTML = '<div class="malim-dict-popover-inner"><div class="malim-dict-content">' + def + '</div></div>';
    } else {
      pop.innerHTML = '<div class="malim-dict-empty">No dictionary entry found.</div>';
    }
  } catch (e) {
    pop.innerHTML = '<div class="malim-dict-empty">Lookup failed.</div>';
  }
}

function closePopovers() {
  if (activePopover) { activePopover.remove(); activePopover = null; }
  if (activeDictPopover) { activeDictPopover.remove(); activeDictPopover = null; }
}

function showError(message) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:12px;right:12px;z-index:999999;background:#fef2f2;color:#dc2626;padding:10px 16px;border-radius:8px;font-size:14px;font-family:sans-serif;max-width:420px;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
  el.textContent = 'Malim: ' + message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 10000);
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}