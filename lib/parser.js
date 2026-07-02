/**
 * Parser: sentence splitting, API orchestration, response parsing, ruaccent alignment.
 * Ported from src-tauri/src/lib.rs parse_text(), build_sentence_result()
 */
import { buildSentencePrompt, buildBatchPrompt } from './prompt-builder.js';
import { countSentenceUnits, bfdGrouping, splitIntoKGroups } from './batching.js';

const LOG = (...args) => console.log('[Malim:parser]', ...args);
const ERR = (...args) => console.error('[Malim:parser]', ...args);

/**
 * Split text into sentences.
 * Ported from lib.rs lines 1761-1784
 */
export function splitSentences(text) {
  const sentences = [];
  let current = '';
  const chars = [...text];

  for (let i = 0; i < chars.length; i++) {
    current += chars[i];
    if (/[.。!?\n]/.test(chars[i])) {
      while (i + 1 < chars.length && /[.。!?\n]/.test(chars[i + 1])) {
        i++;
        current += chars[i];
      }
      const trimmed = current.trim();
      if (trimmed) sentences.push(trimmed);
      current = '';
    }
  }

  const trimmed = current.trim();
  if (trimmed) sentences.push(trimmed);

  return sentences;
}

/**
 * Fetch accented text from the RUAccent server.
 * Ported from lib.rs fetch_accented_text()
 * @param {string} text
 * @param {string} serverUrl
 * @returns {Promise<string>}
 */
export async function fetchAccentedText(text, serverUrl) {
  const cleanText = text.replace(/́/g, '');
  const url = `${serverUrl.replace(/\/+$/, '')}/accentize`;
  LOG('fetchAccentedText -> POST', url, 'text:', cleanText.slice(0, 60));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: cleanText }),
  });

  if (!res.ok) {
    throw new Error(`RUAccent server returned ${res.status}`);
  }

  const data = await res.json();
  LOG('fetchAccentedText <-', (data.accented_text || '').slice(0, 60));
  return data.accented_text;
}

/**
 * Align accented sentence characters back onto parsed word blocks.
 * Ported from lib.rs align_accents closure (lines 1484-1527)
 * @param {import('./types.js').Block[]} blocks
 * @param {string} accentedSentence
 */
function alignAccents(blocks, accentedSentence) {
  LOG('alignAccents: applying', accentedSentence.length, 'chars across', blocks.length, 'blocks');
  const chars = [...accentedSentence];
  let ci = 0;

  function charsMatch(a, b) {
    if (a === b) return true;
    const aL = a.toLowerCase();
    const bL = b.toLowerCase();
    return aL === bL || (aL === 'ё' && bL === 'е') || (aL === 'е' && bL === 'ё');
  }

  for (const block of blocks) {
    const cleanBlock = block.text.replace(/́/g, '');
    let newText = '';
    const bc = [...cleanBlock];

    for (const bch of bc) {
      let matched = false;
      while (ci < chars.length) {
        if (chars[ci] === '́') {
          newText += chars[ci++];
        } else if (charsMatch(chars[ci], bch)) {
          newText += chars[ci++];
          matched = true;
          break;
        } else {
          ci++;
        }
      }
      if (!matched) newText += bch;
    }

    while (ci < chars.length && chars[ci] === '́') {
      newText += chars[ci++];
    }

    if (newText !== block.text) {
      LOG('alignAccents: block', `"${block.text}"`, '->', `"${newText}"`);
    }
    block.text = newText;
  }
}

/**
 * Check if a lemma needs accent from the RUAccent server.
 * Ported from lib.rs lemma_needs_accent (lines 1529-1542)
 */
function lemmaNeedsAccent(lemma) {
  const vowels = new Set(['а', 'е', 'ё', 'и', 'о', 'у', 'ы', 'э', 'ю', 'я']);
  let vowelCount = 0;
  for (const ch of [...lemma].filter(c => c !== '́')) {
    const lc = ch.toLowerCase();
    if (vowels.has(lc)) vowelCount++;
  }
  const result = vowelCount >= 2 && !lemma.includes('́') && !lemma.includes('ё');
  if (result) LOG('lemmaNeedsAccent: YES for', lemma);
  return result;
}

/**
 * Call the AI API (OpenAI-compatible).
 */
async function callAIApi(config, prompt) {
  const body = {
    model: config.modelName,
    messages: [
      { role: 'system', content: 'You are a helpful assistant that outputs only JSON.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0,
    stream: false,
    max_tokens: 8196,
    response_format: { type: 'json_object' }
  };

  LOG('callAIApi ->', config.apiUrl, 'model:', config.modelName, 'prompt.len:', prompt.length);
  const start = Date.now();

  const res = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Cannot read response body');
    ERR('API response NOT OK:', res.status, errText.slice(0, 200));
    throw new Error(`API Error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const responseText = await res.text();
  LOG('callAIApi <-', (Date.now() - start) + 'ms', 'response.len:', responseText.length);
  LOG('callAIApi raw:', responseText.slice(0, 200));

  const jsonRes = JSON.parse(responseText);
  let content = jsonRes.choices?.[0]?.message?.content;
  if (!content) throw new Error('API returned empty content field');

  content = content.trim();
  if (content.startsWith('```json')) content = content.slice(7);
  if (content.endsWith('```')) content = content.slice(0, -3);
  content = content.trim();

  return content;
}

/**
 * Try to parse JSON robustly — if the AI includes unescaped characters
 * inside string values, standard JSON.parse fails. We try to extract the
 * outermost { ... } block and handle common issues.
 */
function robustJsonParse(text) {
  // First, try standard parse
  try {
    return JSON.parse(text);
  } catch (_) {}

  // Find outermost { ... } block (handles the case where the response
  // has extra text before/after the JSON)
  let depth = 0;
  let start = -1;
  let end = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  if (start >= 0 && end > start) {
    const candidate = text.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch (_) {}
  }

  throw new Error(`Cannot parse AI response as JSON. Raw: ${text.slice(0, 300)}`);
}

/**
 * Call AI for a single sentence.
 */
export async function callAiSingle(config, sentence, stressMark, showGrammarNotes) {
  try {
    const prompt = buildSentencePrompt(sentence, stressMark, showGrammarNotes);
    const content = await callAIApi(config, prompt);
    return robustJsonParse(content);
  } catch (e) {
    ERR('callAiSingle failed for:', sentence.slice(0, 50), e);
    throw e;
  }
}

/**
 * Call AI for a batch of sentences.
 */
export async function callAiBatch(config, sentences, stressMark, showGrammarNotes) {
  try {
    const prompt = buildBatchPrompt(sentences, stressMark, showGrammarNotes);
    const content = await callAIApi(config, prompt);
    const result = robustJsonParse(content);
    return result.items || [];
  } catch (e) {
    ERR('callAiBatch failed for', sentences.length, 'sentences:', e);
    throw e;
  }
}

/**
 * Post-process all sentences with RUAccent: fetch accented text for each sentence,
 * align accents onto blocks, and accent lemmas that need it.
 * Ported from build_sentence_result() accent-related logic (lib.rs lines 1586-1637, 1692-1698)
 * @param {import('./types.js').Sentence[]} sentences
 * @param {string} ruaccentUrl
 * @param {number} ruaccentConcurrency
 */
export async function applyRuAccent(sentences, ruaccentUrl, ruaccentConcurrency = 4) {
  LOG('applyRuAccent: processing', sentences.length, 'sentences via', ruaccentUrl);

  const promises = sentences.map(async (sent) => {
    const raw = sent.original;
    const hasText = [...raw].some(c => /[a-zA-Zа-яА-ЯёЁ0-9]/.test(c));
    if (!hasText) return sent;

    const hasTextAccents = sent.blocks.some(b => b.text && b.text.includes('́'));

    let accentedSentence = null;
    if (!hasTextAccents) {
      try {
        accentedSentence = await fetchAccentedText(raw.replace(/́/g, ''), ruaccentUrl);
      } catch (e) {
        LOG('applyRuAccent: sentence failed, skipping:', e.message.slice(0, 60));
      }
    }

    if (accentedSentence) {
      alignAccents(sent.blocks, accentedSentence);
    }

    // Lemma accentization
    const lemmasToAccent = [];
    for (let bi = 0; bi < sent.blocks.length; bi++) {
      const lemma = sent.blocks[bi].lemma;
      if (lemma && lemmaNeedsAccent(lemma)) {
        lemmasToAccent.push(bi);
      }
    }

    if (lemmasToAccent.length > 0) {
      const results = await Promise.all(
        lemmasToAccent.map(async (bi) => {
          const cleanL = sent.blocks[bi].lemma.replace(/́/g, '');
          try {
            const accL = await fetchAccentedText(cleanL, ruaccentUrl);
            return { bi, lemma: accL };
          } catch {
            return { bi, lemma: sent.blocks[bi].lemma };
          }
        })
      );
      for (const r of results) {
        sent.blocks[r.bi].lemma = r.lemma;
      }
    }

    return sent;
  });

  // Run with concurrency limit
  const results = [];
  for (let i = 0; i < sentences.length; i += ruaccentConcurrency) {
    const batch = sentences.slice(i, i + ruaccentConcurrency);
    const done = await Promise.all(batch.map(s => promises[sentences.indexOf(s)]));
    results.push(...done);
  }

  LOG('applyRuAccent: done');
  return results;
}

/**
 * The main parse function.
 * Ported from lib.rs parse_text() plus accent integration.
 */
export async function parseText(text, id, config, options = {}) {
  const {
    concurrency = 1,
    criticalValue = 80,
    stressMark = true,
    showGrammarNotes = false,
    ruaccentUrl = '',
    ruaccentEnabled = false,
    ruaccentConcurrency = 4,
  } = options;

  LOG('parseText called. text.len:', text.length, 'concurrency:', concurrency,
      'stressMark:', stressMark, 'ruaccentEnabled:', ruaccentEnabled);

  if (!config.apiKey) {
    ERR('API Key is missing');
    throw new Error('API Key is missing');
  }
  LOG('API config:', JSON.stringify({apiUrl: config.apiUrl, modelName: config.modelName, key: (config.apiKey || '').slice(0, 8) + '...'}));

  const rawSentences = splitSentences(text);
  LOG('splitSentences:', rawSentences.length, 'sentences');

  if (rawSentences.length === 0) {
    LOG('no sentences found');
    return [];
  }

  const total = rawSentences.length;

  const sentenceWeights = rawSentences.map((s, i) => [i, countSentenceUnits(s)]);
  LOG('sentenceWeights:', JSON.stringify(sentenceWeights.slice(0, 10)));

  // Build groups
  let groups = bfdGrouping(sentenceWeights, criticalValue);
  LOG('bfdGrouping (criticalValue=' + criticalValue + '):', groups.length, 'groups');

  if (groups.length <= concurrency) {
    groups = splitIntoKGroups(sentenceWeights, concurrency);
    LOG('splitIntoKGroups:', groups.length, 'groups');
  }

  LOG('groups:', JSON.stringify(groups.map(g => `[${g.join(',')}]`)));

  // Process each group
  const groupPromises = groups.map(async (groupIndices, gi) => {
    LOG(`Group ${gi}: processing indices [${groupIndices.join(',')}]`);
    const analyses = new Map();
    const pending = [];

    for (const idx of groupIndices) {
      const raw = rawSentences[idx];
      const hasTextContent = [...raw].some(c => /[a-zA-Zа-яА-ЯёЁ0-9]/.test(c));
      LOG(`  Sentence ${idx}: hasText=${hasTextContent} text="${raw.slice(0, 40)}..."`);

      if (!hasTextContent) {
        analyses.set(idx, {
          blocks: [{
            text: raw, pos: 'punctuation', definition: raw,
            lemma: null, gram_case: null, gram_gender: null, gram_number: null,
            tense: null, aspect: null, mood: null, gram_person: null,
            chinese_root: null, grammar_note: null, audio_path: null
          }],
          translation: raw
        });
        continue;
      }

      pending.push([idx, raw]);
    }

    // API calls
    if (pending.length === 1) {
      const [idx, raw] = pending[0];
      LOG(`  Single sentence API call for idx=${idx}`);
      try {
        const result = await callAiSingle(config, raw, stressMark, showGrammarNotes);
        LOG(`  AI result for idx=${idx}:`, result.translation?.slice(0, 30), result.blocks?.length, 'blocks');
        analyses.set(idx, result);
      } catch (err) {
        ERR(`  Single API failed for idx=${idx}:`, err.message);
        analyses.set(idx, {
          blocks: [{ text: raw, pos: 'error', definition: `Error: ${err.message}`, lemma: null, gram_case: null, gram_gender: null, gram_number: null, tense: null, aspect: null, mood: null, gram_person: null, chinese_root: null, grammar_note: null, audio_path: null }],
          translation: 'Translation unavailable due to error.'
        });
      }
    } else if (pending.length > 1) {
      LOG(`  Batch API call for ${pending.length} sentences`);
      try {
        const items = await callAiBatch(config, pending, stressMark, showGrammarNotes);
        LOG(`  Batch returned ${items.length} items`);
        const resultMap = new Map(items.map(item => [item.index, item]));
        for (const [idx] of pending) {
          if (resultMap.has(idx)) {
            const r = resultMap.get(idx);
            analyses.set(idx, { blocks: r.blocks, translation: r.translation });
          } else {
            ERR(`  Batch missing idx=${idx}`);
            const raw = rawSentences[idx];
            analyses.set(idx, {
              blocks: [{ text: raw, pos: 'error', definition: 'Batch result missing', lemma: null, gram_case: null, gram_gender: null, gram_number: null, tense: null, aspect: null, mood: null, gram_person: null, chinese_root: null, grammar_note: null, audio_path: null }],
              translation: 'Translation unavailable due to error.'
            });
          }
        }
      } catch (err) {
        ERR(`  Batch API failed:`, err.message);
        for (const [idx, raw] of pending) {
          analyses.set(idx, {
            blocks: [{ text: raw, pos: 'error', definition: `Error: ${err.message}`, lemma: null, gram_case: null, gram_gender: null, gram_number: null, tense: null, aspect: null, mood: null, gram_person: null, chinese_root: null, grammar_note: null, audio_path: null }],
            translation: 'Translation unavailable due to error.'
          });
        }
      }
    }

    // Build final sentences
    const groupResults = [];
    for (const idx of groupIndices) {
      const raw = rawSentences[idx];
      const analysis = analyses.get(idx);
      if (!analysis) {
        const hasText = [...raw].some(c => /[a-zA-Zа-яА-ЯёЁ0-9]/.test(c));
        groupResults.push({
          id: `${id}_${idx}`,
          original: raw,
          blocks: [{ text: raw, pos: hasText ? 'error' : 'punctuation', definition: hasText ? 'Missing analysis' : raw, lemma: null, gram_case: null, gram_gender: null, gram_number: null, tense: null, aspect: null, mood: null, gram_person: null, chinese_root: null, grammar_note: null, audio_path: null }],
          translation: hasText ? 'Translation unavailable.' : raw
        });
      } else {
        groupResults.push({
          id: `${id}_${idx}`,
          original: raw,
          blocks: analysis.blocks,
          translation: analysis.translation
        });
      }
    }
    LOG(`Group ${gi}: returning ${groupResults.length} sentences`);
    return groupResults;
  });

  const results = await Promise.all(groupPromises);
  const flat = results.flat();

  flat.sort((a, b) => {
    const ai = parseInt(a.id.split('_').pop(), 10);
    const bi = parseInt(b.id.split('_').pop(), 10);
    return ai - bi;
  });

  LOG('parseText: returning', flat.length, 'sentences');

  // Apply RUAccent if enabled
  if (ruaccentEnabled && ruaccentUrl) {
    LOG('parseText: applying RUAccent...');
    const accented = await applyRuAccent(flat, ruaccentUrl, ruaccentConcurrency);
    LOG('parseText: RUAccent done');
    return accented;
  }

  return flat;
}
