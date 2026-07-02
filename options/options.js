const DEFAULTS = {
  apiKey: '',
  apiUrl: 'https://api.deepseek.com/chat/completions',
  modelName: 'deepseek-chat',
  concurrency: 2,
  criticalValue: 80,
  stressMark: true,
  showGrammarNotes: true,
  darkMode: false,
  ruaccentEnabled: false,
  ruaccentUrl: 'http://localhost:8001',
  ruaccentConcurrency: 4,
};

async function load() {
  const result = await chrome.storage.sync.get('settings');
  const settings = { ...DEFAULTS, ...(result.settings || {}) };

  document.getElementById('apiKey').value = settings.apiKey;
  document.getElementById('apiUrl').value = settings.apiUrl;
  document.getElementById('modelName').value = settings.modelName;
  document.getElementById('concurrency').value = settings.concurrency;
  document.getElementById('stressMark').checked = settings.stressMark;
  document.getElementById('showGrammarNotes').checked = settings.showGrammarNotes;
  document.getElementById('ruaccentEnabled').checked = settings.ruaccentEnabled;
  document.getElementById('ruaccentUrl').value = settings.ruaccentUrl;
}

async function save() {
  const settings = {
    apiKey: document.getElementById('apiKey').value.trim(),
    apiUrl: document.getElementById('apiUrl').value.trim(),
    modelName: document.getElementById('modelName').value.trim(),
    concurrency: parseInt(document.getElementById('concurrency').value, 10) || 2,
    criticalValue: 80,
    stressMark: document.getElementById('stressMark').checked,
    showGrammarNotes: document.getElementById('showGrammarNotes').checked,
    darkMode: false,
    ruaccentEnabled: document.getElementById('ruaccentEnabled').checked,
    ruaccentUrl: document.getElementById('ruaccentUrl').value.trim(),
    ruaccentConcurrency: 4,
  };

  await chrome.storage.sync.set({ settings });

  const status = document.getElementById('status');
  status.textContent = '✓ Settings saved!';
  status.className = 'status';
  setTimeout(() => { status.textContent = ''; }, 2000);
}

document.addEventListener('DOMContentLoaded', load);
document.getElementById('save').addEventListener('click', save);
