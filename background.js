/**
 * Background service worker for Malim CRX.
 */

import { parseText } from './lib/parser.js';
import { initDictionary, getDictionary } from './lib/mdx-parser.js';

const LOG = (...args) => console.log('[Malim:bg]', ...args);
const ERR = (...args) => console.error('[Malim:bg]', ...args);

// ── Storage ──────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  apiKey: '',
  apiUrl: 'https://api.deepseek.com/chat/completions',
  modelName: 'deepseek-chat',
  concurrency: 2,
  criticalValue: 80,
  stressMark: true,
  showGrammarNotes: true,
  ruaccentEnabled: false,
  ruaccentUrl: 'http://localhost:8001',
  ruaccentConcurrency: 4,
};

async function getSettings() {
  const result = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

function saveSettings(settings) {
  return chrome.storage.sync.set({ settings });
}

// ── Keepalive ────────────────────────────────────────────────
// Content scripts connect with a named port to prevent the SW
// from being terminated while idle.  Without this listener the
// port is immediately closed and the SW still gets killed.

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'malim-keepalive') {
    LOG('keepalive port connected');
    port.onDisconnect.addListener(() => LOG('keepalive port disconnected'));
  }
});

// ── Context menu ─────────────────────────────────────────────

const MENU_ID = 'malim-parse-selection';

chrome.runtime.onInstalled.addListener(() => {
  LOG('onInstalled');
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Parse with Malim',
    contexts: ['selection'],
  });
});

// ── Message router (same reliable onMessage API as before) ───

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  LOG('onMessage:', msg.type);

  if (msg.type === 'malim:parse') {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    LOG('-> handleParseRequest');
    getSettings().then(async (settings) => {
      if (!settings.apiKey) {
        chrome.tabs.sendMessage(tabId, { type: 'malim:error', error: 'No API key. Right-click Malim icon → Options to configure.' }).catch(() => {});
        return;
      }
      try {
        const sentences = await parseText(msg.text, 'crx_' + Date.now(), {
          apiKey: settings.apiKey, apiUrl: settings.apiUrl, modelName: settings.modelName
        }, {
          concurrency: settings.concurrency,
          criticalValue: settings.criticalValue,
          stressMark: settings.stressMark,
          showGrammarNotes: settings.showGrammarNotes,
          ruaccentUrl: settings.ruaccentUrl,
          ruaccentEnabled: settings.ruaccentEnabled,
          ruaccentConcurrency: settings.ruaccentConcurrency,
        });
        LOG('parseText returned', sentences.length, 'sentences');
        chrome.tabs.sendMessage(tabId, { type: 'malim:parse_result', sentences }).catch(() => {});
      } catch (e) {
        ERR('parseText threw:', e.message);
        chrome.tabs.sendMessage(tabId, { type: 'malim:error', error: e.message }).catch(() => {});
      }
    }).catch(e => ERR('settings error:', e.message));
    return false;
  }

  if (msg.type === 'malim:dict_lookup') {
    LOG('dict_lookup:', msg.word?.slice(0, 40));
    handleDictLookup(msg.word).then(sendResponse);
    return true;
  }

  if (msg.type === 'malim:get_settings') {
    getSettings().then(sendResponse);
    return true;
  }

  if (msg.type === 'malim:save_settings') {
    saveSettings(msg.settings).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'malim:ping') {
    sendResponse({ ok: true, version: '0.1.0' });
    return true;
  }

  return false;
});

async function handleDictLookup(word) {
  try {
    if (!getDictionary()) {
      LOG('loading MDX...');
      const resp = await fetch(chrome.runtime.getURL('OpenRussian.mdx'));
      const buf = await resp.arrayBuffer();
      await initDictionary(buf);
      LOG('MDX loaded, keyBlocks:', getDictionary()?.keyBlockInfoList?.length);
    }
    const dict = getDictionary();
    if (!dict) return { keyText: word, definition: null };
    const result = await dict.lookup(word);
    LOG('dict result:', result?.definition?.slice(0, 60) || 'null');
    return result;
  } catch (e) {
    ERR('dict error:', e.message);
    return { keyText: word, definition: null };
  }
}

// ── Context menu click ───────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  LOG('contextMenu clicked:', info.selectionText?.slice(0, 40));
  if (info.menuItemId === MENU_ID && info.selectionText && tab?.id) {
    // Try sending directly — if content script is loaded it'll work
    chrome.tabs.sendMessage(tab.id, {
      type: 'malim:parse_selection',
      text: info.selectionText
    }).catch(async () => {
      // Content script not loaded — inject it
      LOG('injecting content script...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content.css']
        });
        // Give it a moment to initialize, then send
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'malim:parse_selection',
            text: info.selectionText
          }).catch(e => ERR('send after inject:', e.message));
        }, 100);
      } catch (e) {
        ERR('inject failed:', e.message);
      }
    });
  }
});

LOG('Background script loaded');
