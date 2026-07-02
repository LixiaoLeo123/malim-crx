/**
 * Prompt builder for Russian linguistic analysis.
 * Direct port from src-tauri/src/lib.rs build_prompt() and build_batch_prompt()
 */

/**
 * Build a single-sentence AI prompt
 * Ported from lib.rs:57-275 (RU branch)
 */
export function buildSentencePrompt(sentence, stressMark = true, showGrammarNotes = false) {
  let prompt = '';

  prompt += 'STRICT RULES:\n';
  prompt += '1. Output must be a single, valid JSON object.\n';

  prompt += 'Task: Russian linguistic analysis.\n';
  prompt += 'CORE: Context determines grammar. Analyze SYNTAX (verb government, prepositions, etc).\n';
  prompt += 'POS: noun, verb, adjective, adverb, pronoun, preposition, conjunction, particle, punctuation, unknown.\n';
  prompt += 'FIELDS (if meaningful): text, pos, definition, lemma, gram_case (1-7), gram_gender (m/f/n), gram_number (sg/pl), tense (pres/past/fut/imp/inf/gerund), aspect (pf/impf).\n';
  prompt += 'RULES:\n';
  prompt += '- Nouns: Case depends on context and word form.\n';
  prompt += '- Adjectives: Omit case/gender/number. Participles=adjective.\n';
  prompt += '- Verbs: Lemma MUST be Infinitive (preserve aspect). Gerunds=verb(tense:gerund).\n';
  prompt += '- Pronouns: 1st/2nd person defaults to \'m\'.\n';

  if (stressMark) {
    prompt += '- Stress: Add acute accents (´) to stressed vowels in \'text\' and \'lemma\'. NO stress on monosyllabic/English words.\n';
  }

  if (showGrammarNotes) {
    prompt += '- Grammar Note: Briefly explain syntactic role and why its form looks like this.\n';
  }
  prompt += '\n';

  const he = 'Он';
  const read = stressMark ? 'прочита́л' : 'прочитал';
  const readLemma = stressMark ? 'прочита́ть' : 'прочитать';
  const book = stressMark ? 'кни́гу' : 'книгу';
  const bookLemma = stressMark ? 'кни́га' : 'книга';
  const table = stressMark ? 'столе́' : 'столе';
  const tableLemma = stressMark ? 'сто́л' : 'стол';

  const notePron = showGrammarNotes
    ? ', "grammar_note": "Nominative form of 3rd person singular masculine pronoun."'
    : '';
  const noteVerb = showGrammarNotes
    ? ', "grammar_note": "Past tense masculine singular ending \'-л\'."'
    : '';
  const noteNoun1 = showGrammarNotes
    ? ', "grammar_note": "Feminine singular accusative ending \'-у\' replacing nominative \'-а\'."'
    : '';
  const notePrep = showGrammarNotes
    ? ', "grammar_note": "Preposition denoting location, governing the prepositional case."'
    : '';
  const noteNoun2 = showGrammarNotes
    ? ', "grammar_note": "Masculine singular prepositional ending \'-е\' (hard consonant stem)."'
    : '';
  const notePunct = showGrammarNotes
    ? ', "grammar_note": null'
    : '';

  prompt += `Example Output:\n`;
  prompt += `{\n`;
  prompt += `  "translation": "He read the book on the table.",\n`;
  prompt += `  "blocks": [\n`;
  prompt += `    { "text": "${he}", "pos": "pronoun", "definition": "he", "lemma": "он", "gram_case": 1, "gram_gender": "m", "gram_number": "sg"${notePron} },\n`;
  prompt += `    { "text": "${read}", "pos": "verb", "definition": "read", "lemma": "${readLemma}", "tense": "past", "aspect": "pf"${noteVerb} },\n`;
  prompt += `    { "text": "${book}", "pos": "noun", "definition": "book", "lemma": "${bookLemma}", "gram_case": 4, "gram_gender": "f", "gram_number": "sg"${noteNoun1} },\n`;
  prompt += `    { "text": "на", "pos": "preposition", "definition": "on", "lemma": "на"${notePrep} },\n`;
  prompt += `    { "text": "${table}", "pos": "noun", "definition": "table", "lemma": "${tableLemma}", "gram_case": 6, "gram_gender": "m", "gram_number": "sg"${noteNoun2} },\n`;
  prompt += `    { "text": ".", "pos": "punctuation", "definition": "."${notePunct} }\n`;
  prompt += `  ]\n`;
  prompt += `}\n`;

  prompt += `\nSentence to analyze: ${sentence}\n`;

  return prompt;
}

/**
 * Build a batch AI prompt for multiple sentences.
 * Ported from lib.rs build_batch_prompt() RU branch (lines 516-739)
 */
export function buildBatchPrompt(sentences, stressMark = true, showGrammarNotes = false) {
  let prompt = '';

  prompt += 'STRICT RULES:\n';
  prompt += '1. Output must be a single, valid JSON object.\n';
  prompt += '2. The JSON object must contain one key: \'items\'.\n';
  prompt += '3. \'items\' must be an array of objects.\n';
  prompt += '4. Each item must include: index, translation, blocks.\n';
  prompt += '5. The \'index\' field must match the input sentence index.\n';
  prompt += '6. Do not merge or reorder sentences.\n\n';

  prompt += 'Task: Russian linguistic analysis.\n';
  prompt += 'CORE: Context determines grammar. Analyze SYNTAX (verb government, prepositions, etc).\n';
  prompt += 'POS: noun, verb, adjective, adverb, pronoun, preposition, conjunction, particle, punctuation, unknown.\n';
  prompt += 'FIELDS (if meaningful): text, pos, definition, lemma, gram_case (1-7), gram_gender (m/f/n), gram_number (sg/pl), tense (pres/past/fut/imp/inf/gerund), aspect (pf/impf).\n';
  prompt += 'RULES:\n';
  prompt += '- Nouns: Case depends on context and word form.\n';
  prompt += '- Adjectives: Omit case/gender/number. Participles=adjective.\n';
  prompt += '- Verbs: Lemma MUST be Infinitive (preserve aspect). Gerunds=verb(tense:gerund).\n';
  prompt += '- Pronouns: 1st/2nd person defaults to \'m\'.\n';
  if (stressMark) {
    prompt += '- Stress: Add acute accents (´) to stressed vowels in \'text\' and \'lemma\'. NO stress on monosyllabic/English words.\n';
  }
  if (showGrammarNotes) {
    prompt += '- Grammar Note: Explain WHY the word takes this specific ending. Do NOT just repeat the case/tense. Focus on morphological rules, declension/conjugation patterns, animacy rules (e.g., \'Acc=Gen for animate masculine\'), and spelling rules (e.g., \'7-letter rule: и instead of ы after к/г/х/ж/ч/ш/щ\').\n';
  }
  prompt += '\n';

  const he = 'Он';
  const read = stressMark ? 'прочита́л' : 'прочитал';
  const readLemma = stressMark ? 'прочита́ть' : 'прочитать';
  const book = stressMark ? 'кни́гу' : 'книгу';
  const bookLemma = stressMark ? 'кни́га' : 'книга';
  const table = stressMark ? 'столе́' : 'столе';
  const tableLemma = stressMark ? 'сто́л' : 'стол';

  const iPron = 'Я';
  const withPrep = 'с';
  const give = stressMark ? 'даю́' : 'даю';
  const giveLemma = stressMark ? 'дава́ть' : 'давать';
  const brother = stressMark ? 'бра́ту' : 'брату';
  const brotherLemma = stressMark ? 'бра́т' : 'брат';
  const cup = stressMark ? 'ча́шку' : 'чашку';
  const cupLemma = stressMark ? 'ча́шка' : 'чашка';
  const tea = stressMark ? 'ча́я' : 'чая';
  const teaLemma = stressMark ? 'ча́й' : 'чай';
  const milk = stressMark ? 'молоко́м' : 'молоком';
  const milkLemma = stressMark ? 'молоко́' : 'молоко';

  const notePron1 = showGrammarNotes ? ', "grammar_note": "Nominative form of 3rd person singular masculine pronoun."' : '';
  const noteVerb1 = showGrammarNotes ? ', "grammar_note": "Past tense masculine singular ending \'-л\'."' : '';
  const noteNoun1Acc = showGrammarNotes ? ', "grammar_note": "Feminine singular accusative ending \'-у\' replacing nominative \'-а\'."' : '';
  const notePrep1 = showGrammarNotes ? ', "grammar_note": "Preposition denoting location, governing the prepositional case."' : '';
  const noteNoun1Prep = showGrammarNotes ? ', "grammar_note": "Masculine singular prepositional ending \'-е\' (hard consonant stem)."' : '';
  const notePunct = showGrammarNotes ? ', "grammar_note": null' : '';

  const notePron2 = showGrammarNotes ? ', "grammar_note": "1st person singular pronoun in nominative."' : '';
  const noteVerb2 = showGrammarNotes ? ', "grammar_note": "1st person singular present ending \'-ю\' (stem ending in vowel)."' : '';
  const noteNoun2Dat = showGrammarNotes ? ', "grammar_note": "Masculine singular dative ending \'-у\' (hard consonant stem)."' : '';
  const noteNoun2Acc = showGrammarNotes ? ', "grammar_note": "Feminine singular accusative ending \'-у\' replacing nominative \'-а\'."' : '';
  const noteNoun2Gen = showGrammarNotes ? ', "grammar_note": "Masculine singular genitive ending \'-я\' (soft stem/partitive)."' : '';
  const notePrep2 = showGrammarNotes ? ', "grammar_note": "Preposition denoting accompaniment, governing the instrumental case."' : '';
  const noteNoun2Inst = showGrammarNotes ? ', "grammar_note": "Neuter singular instrumental ending \'-ом\'."' : '';

  prompt += `Example Output:\n`;
  prompt += `{\n`;
  prompt += `  "items": [\n`;
  prompt += `    {\n`;
  prompt += `      "index": 0,\n`;
  prompt += `      "translation": "He read the book on the table.",\n`;
  prompt += `      "blocks": [\n`;
  prompt += `        { "text": "${he}", "pos": "pronoun", "definition": "he", "lemma": "он", "gram_case": 1, "gram_gender": "m", "gram_number": "sg"${notePron1} },\n`;
  prompt += `        { "text": "${read}", "pos": "verb", "definition": "read", "lemma": "${readLemma}", "tense": "past", "aspect": "pf"${noteVerb1} },\n`;
  prompt += `        { "text": "${book}", "pos": "noun", "definition": "book", "lemma": "${bookLemma}", "gram_case": 4, "gram_gender": "f", "gram_number": "sg"${noteNoun1Acc} },\n`;
  prompt += `        { "text": "на", "pos": "preposition", "definition": "on", "lemma": "на"${notePrep1} },\n`;
  prompt += `        { "text": "${table}", "pos": "noun", "definition": "table", "lemma": "${tableLemma}", "gram_case": 6, "gram_gender": "m", "gram_number": "sg"${noteNoun1Prep} },\n`;
  prompt += `        { "text": ".", "pos": "punctuation", "definition": "."${notePunct} }\n`;
  prompt += `      ]\n`;
  prompt += `    },\n`;
  prompt += `    {\n`;
  prompt += `      "index": 1,\n`;
  prompt += `      "translation": "I give my brother a cup of tea with milk.",\n`;
  prompt += `      "blocks": [\n`;
  prompt += `        { "text": "${iPron}", "pos": "pronoun", "definition": "I", "lemma": "я", "gram_case": 1, "gram_gender": "m", "gram_number": "sg"${notePron2} },\n`;
  prompt += `        { "text": "${give}", "pos": "verb", "definition": "give", "lemma": "${giveLemma}", "tense": "pres", "aspect": "impf"${noteVerb2} },\n`;
  prompt += `        { "text": "${brother}", "pos": "noun", "definition": "brother", "lemma": "${brotherLemma}", "gram_case": 3, "gram_gender": "m", "gram_number": "sg"${noteNoun2Dat} },\n`;
  prompt += `        { "text": "${cup}", "pos": "noun", "definition": "cup", "lemma": "${cupLemma}", "gram_case": 4, "gram_gender": "f", "gram_number": "sg"${noteNoun2Acc} },\n`;
  prompt += `        { "text": "${tea}", "pos": "noun", "definition": "tea", "lemma": "${teaLemma}", "gram_case": 2, "gram_gender": "m", "gram_number": "sg"${noteNoun2Gen} },\n`;
  prompt += `        { "text": "${withPrep}", "pos": "preposition", "definition": "with", "lemma": "с"${notePrep2} },\n`;
  prompt += `        { "text": "${milk}", "pos": "noun", "definition": "milk", "lemma": "${milkLemma}", "gram_case": 5, "gram_gender": "n", "gram_number": "sg"${noteNoun2Inst} },\n`;
  prompt += `        { "text": ".", "pos": "punctuation", "definition": "."${notePunct} }\n`;
  prompt += `      ]\n`;
  prompt += `    }\n`;
  prompt += `  ]\n`;
  prompt += `}\n\n`;

  prompt += 'Sentences to analyze:\n';
  for (const [index, sentence] of sentences) {
    prompt += `- index ${index}: ${sentence}\n`;
  }
  prompt += 'Output:';

  return prompt;
}
