/**
 * Types ported from src/lib/types.ts
 */

/** @typedef {{ text: string, pos: string, definition: string, chinese_root?: string, grammar_note?: string, audio_path?: string|null, lemma?: string|null, gram_case?: number|null, gram_gender?: 'm'|'f'|'n'|null, gram_number?: 'sg'|'pl'|null, tense?: string|null, aspect?: 'pf'|'impf'|null, mood?: 'ind'|'subj'|'imp'|'cond'|null, gram_person?: 1|2|3|null }} Block */

/** @typedef {{ id: string, original: string, blocks: Block[], translation: string, audio_path?: string|null }} Sentence */

/** @typedef {{ headword: string, lemma: string, forms: string[], definition_html: string, matched_terms: string[] }} DictionaryEntry */

/** @typedef {{ query: string, normalized_query: string, results: DictionaryEntry[] }} DictionarySearchResponse */

export const PARSING_LANGUAGES = ["RU"];

export const POS_LABELS = {
  noun:       { label: "noun",       color: "pos-noun" },
  verb:       { label: "verb",       color: "pos-verb" },
  adjective:  { label: "adjective",  color: "pos-adj" },
  adverb:     { label: "adverb",     color: "pos-adverb" },
  pronoun:    { label: "pronoun",    color: "pos-pronoun" },
  preposition:{ label: "preposition",color: "pos-prep" },
  conjunction:{ label: "conjunction",color: "pos-conj" },
  particle:   { label: "particle",   color: "pos-particle" },
  punctuation:{ label: "punctuation",color: "pos-punct" },
  article:    { label: "article",    color: "pos-article" },
  interjection:{label: "interjection",color:"pos-interj" },
  ending:     { label: "ending",     color: "pos-ending" },
  unknown:    { label: "unknown",    color: "pos-unknown" },
  error:      { label: "error",      color: "pos-unknown" },
};

/**
 * Get the CSS class for a block based on its POS and language-specific rules.
 * Ported from Reader.svelte getBlockPosClass()
 * @param {Block} block
 * @returns {string[]}
 */
export function getBlockClasses(block) {
  const base = ["malim-token"];

  if (block.pos === "punctuation") {
    base.push("malim-punct");
    return base;
  }
  if (block.pos === "unknown" || block.pos === "error") {
    base.push("malim-unknown");
    return base;
  }

  // Russian noun/pronoun gender coloring (exactly as Reader.svelte)
  if (block.pos === "noun" || block.pos === "pronoun") {
    if (block.gram_gender === "m") {
      base.push("malim-gender-masc");
    } else if (block.gram_gender === "f") {
      base.push("malim-gender-fem");
    } else if (block.gram_gender === "n") {
      base.push("malim-gender-neut");
    } else {
      base.push("malim-noun");
    }
  } else if (block.pos === "verb") {
    base.push("malim-verb");
  } else if (block.pos === "adjective") {
    base.push("malim-adj");
  } else if (block.pos === "adverb") {
    base.push("malim-adverb");
  } else if (block.pos === "pronoun") {
    base.push("malim-pronoun");
  } else if (block.pos === "preposition" || block.pos === "conjunction" || block.pos === "particle") {
    base.push("malim-particle");
  } else if (block.pos === "article") {
    base.push("malim-article");
  } else {
    base.push("malim-unknown");
  }

  return base;
}
