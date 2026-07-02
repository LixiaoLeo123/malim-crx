/**
 * Browser-compatible MDX (MDict) parser.
 *
 * Reads an OpenRussian.mdx ArrayBuffer, parses headers and record blocks,
 * and provides lookup() for keyword → definition HTML.
 *
 * Uses the Web Compression Streams API (DecompressionStream) for zlib inflation,
 * available in Chrome 80+. No external dependencies.
 *
 * Based on the same algorithm as mdict-js (mdict-base.js + mdict.js)
 */

const UTF16_DECODER = new TextDecoder('utf-16le');
const UTF8_DECODER = new TextDecoder('utf-8');

const LOG = (...args) => console.log('[Malim:mdx]', ...args);
const ERR = (...args) => console.error('[Malim:mdx]', ...args);

let _instance = null;

/**
 * Initialize the dictionary service.
 * @param {ArrayBuffer|Uint8Array} mdxBuffer - the OpenRussian.mdx file as buffer
 * @returns {Promise<MdictParser>}
 */
export async function initDictionary(mdxBuffer) {
  _instance = new MdictParser(mdxBuffer);
  await _instance._decompressBlocks();
  return _instance;
}

export function getDictionary() {
  return _instance;
}

function readU32(buf, offset) {
  // MDX v2 uses BIG-ENDIAN (network byte order)
  return (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
}

function readU32LE(buf, offset) {
  // Block-level metadata (compression type, adler32) uses LITTLE-ENDIAN
  return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24);
}

function readU64(buf, offset) {
  // BIG-ENDIAN 64-bit
  const hi = readU32(buf, offset);
  const lo = readU32(buf, offset + 4);
  return hi * 0x100000000 + lo;
}

function readU16(buf, offset) {
  // BIG-ENDIAN 16-bit
  return (buf[offset] << 8) | buf[offset + 1];
}

function slice(buf, start, length) {
  if (buf instanceof ArrayBuffer) {
    return new Uint8Array(buf, start, length);
  }
  return buf.slice(start, start + length);
}

/**
 * MDX decryption helpers.
 * Ported from mdict-js/src/common.js (fast_decrypt, mdxDecrypt, ripemd128)
 */

function fastDecrypt(data) {
  // key is the RIPEMD-128 of bytes[4:8] ++ [0x95, 0x36, 0x00, 0x00]
  const seed = new Uint8Array(8);
  seed.set(data.slice(4, 8), 0);
  seed[4] = 0x95; seed[5] = 0x36; seed[6] = 0x00; seed[7] = 0x00;
  const key = ripemd128(seed);
  // Keep first 8 bytes intact.  Decrypt bytes 8+ using XOR with
  // indexes starting from 0 (matching mdict-js which slices first).
  const b = new Uint8Array(data);
  let previous = 0x36;
  for (let i = 8; i < b.length; ++i) {
    const idx = i - 8; // relative index for XOR, matching mdict-js
    let t = ((b[i] >> 4) | (b[i] << 4)) & 0xff;
    t = t ^ previous ^ (idx & 0xff) ^ key[idx % key.length];
    previous = b[i];
    b[i] = t;
  }
  return b;
}

function ripemd128(msg) {
  // msg is Uint8Array
  const S = [
    [11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8],
    [7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12],
    [11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5],
    [11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12],
    [8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6],
    [9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11],
    [9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5],
    [15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8],
  ];
  const X = [
    [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
    [7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8],
    [3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12],
    [1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2],
    [5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12],
    [6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2],
    [15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13],
    [8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14],
  ];
  const K = [
    0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc,
    0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x00000000,
  ];
  function F(r, x, y, z) {
    if (r === 0) return x ^ y ^ z;
    if (r === 1) return (x & y) | (~x & z);
    if (r === 2) return (x | ~y) ^ z;
    return (x & z) | (y & ~z);
  }
  function rotl(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }

  let bytes = msg.length;
  const padding = new Uint8Array((bytes % 64 < 56 ? 56 : 120) - (bytes % 64));
  padding[0] = 0x80;
  const padded = new Uint8Array(msg.length + padding.length + 8);
  padded.set(msg, 0);
  padded.set(padding, msg.length);
  const bitLen = bytes * 8;
  const dv = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  dv.setUint32(padded.length - 8, bitLen, true);
  dv.setUint32(padded.length - 4, 0, true);

  const words = new Uint32Array(padded.buffer);
  let h0 = 0x67452301, h1 = 0xefcdab89 | 0, h2 = 0x98badcfe | 0, h3 = 0x10325476 | 0;

  for (let i = 0; i < words.length; i += 16) {
    let aa = h0, bb = h1, cc = h2, dd = h3;
    let aaa = h0, bbb = h1, ccc = h2, ddd = h3;

    for (let t = 0; t < 64; t++) {
      const r = (t / 16) | 0;
      aa = rotl(aa + F(r, bb, cc, dd) + words[i + X[r][t % 16]] + K[r], S[r][t % 16]);
      const tmp = dd; dd = cc; cc = bb; bb = aa; aa = tmp;
    }
    for (let t = 64; t < 128; t++) {
      const r = (t / 16) | 0;
      const rr = ((63 - (t % 64)) / 16) | 0;
      aaa = rotl(aaa + F(rr, bbb, ccc, ddd) + words[i + X[r][t % 16]] + K[r], S[r][t % 16]);
      const tmp = ddd; ddd = ccc; ccc = bbb; bbb = aaa; aaa = tmp;
    }

    const tddd = h1 + cc + ddd;
    h1 = h2 + dd + aaa;
    h2 = h3 + aa + bbb;
    h3 = h0 + bb + ccc;
    h0 = tddd;
  }
  const result = new Uint8Array(16);
  new DataView(result.buffer).setUint32(0, h0, true);
  new DataView(result.buffer).setUint32(4, h1, true);
  new DataView(result.buffer).setUint32(8, h2, true);
  new DataView(result.buffer).setUint32(12, h3, true);
  return result;
}

/**
 * Decompress a zlib-compressed buffer using Compression Streams API.
 * @param {Uint8Array} data - raw compressed bytes
 * @returns {Promise<Uint8Array>}
 */
async function decompressZlib(data) {
  // MDX v2 block format: caller strips the 8-byte block header.
  // Remaining data is either a raw deflate stream (no wrapper)
  // or a full zlib stream starting with 0x78.

  if (data.length > 0 && (data[0] === 0x78)) {
    // Full zlib stream (2-byte header + deflate + 4-byte adler32)
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(data);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLen = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    return result;
  } else {
    // Raw deflate stream (no zlib wrapper) — this happens when the
    // block author tool produces a raw stream without zlib framing.
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(data);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLen = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    return result;
  }
}

class MdictParser {
  constructor(buffer) {
    this.buffer = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;

    // OpenRussian.mdx: first 4 bytes = header size (big-endian uint32)
    // followed immediately by UTF-16LE XML header. No "MDX\0" magic string.
    const headerSize = readU32(this.buffer, 0);
    if (headerSize < 50 || headerSize > 20000) {
      throw new Error(`Invalid MDX header size: ${headerSize} (expected 50-20000)`);
    }

    // Read header XML (bytes 4..4+headerSize, UTF-16LE, null-terminated)
    const headerBuf = slice(this.buffer, 4, headerSize);
    const headerText = UTF16_DECODER.decode(headerBuf).replace(/\x00+$/, '').trim();
    this.header = this._parseHeaderXml(headerText);

    // Encryption flag: 0=none, 1=record blocks, 2=key info block
    const encStr = this.header.Encrypted || 'No';
    if (encStr === 'No' || encStr === '') {
      this._encrypt = 0;
    } else if (encStr === 'Yes') {
      this._encrypt = 1;
    } else {
      this._encrypt = parseInt(encStr, 10) || 0;
    }

    // Determine encoding
    const enc = (this.header.Encoding || '').toLowerCase();
    this._encoding = enc === 'utf-16' || enc === 'utf16' ? 'UTF-16' : 'UTF-8';
    this._decoder = this._encoding === 'UTF-16' ? UTF16_DECODER : UTF8_DECODER;

    // Recalculate version from engine version
    this._version = parseFloat(this.header.GeneratedByEngineVersion || '1.0');
    if (this._version >= 2.0) {
      this._numWidth = 8;
      this._numFmt = readU64;
    } else {
      this._numWidth = 4;
      this._numFmt = readU32;
    }

    // 4 bytes + headerSize + 4 bytes adler32
    this._headerEndOffset = 4 + headerSize + 4;

    // Step 2: Read key block header
    const khBytesNum = this._version >= 2.0 ? 8 * 5 : 4 * 4;
    const khBuf = slice(this.buffer, this._headerEndOffset, khBytesNum);
    let kho = 0;

    this.keyBlocksNum = this._numFmt(khBuf, kho); kho += this._numWidth;
    this.entriesNum = this._numFmt(khBuf, kho); kho += this._numWidth;

    if (this._version >= 2.0) {
      this.keyBlockInfoDecompSize = this._numFmt(khBuf, kho); kho += this._numWidth;
    }
    this.keyBlockInfoCompSize = this._numFmt(khBuf, kho); kho += this._numWidth;
    this.keyBlocksTotalSize = this._numFmt(khBuf, kho);

    const adlerSize = this._version >= 2.0 ? 4 : 0;
    this._keyHeaderEndOffset = this._headerEndOffset + khBytesNum + adlerSize;

    // Step 3: Parse key block info (the index)
    this.keyBlockInfoList = [];
    this._parsedKeyBlockInfo = false;

    // Key block start offset (for decoding individual blocks)
    this._keyBlockStartOffset = 0;

    // Step 4+5: Record header and info
    this.recordBlockInfoList = [];
    this._recordBlockStartOffset = 0;
    this._recordInfoEndOffset = 0;

    // Lazy parsing state
    this._parsedRecord = false;
  }

  /**
   * Decompress all blocks and fully parse the dictionary.
   * Called after construction since decompression is async.
   */
  async _decompressBlocks() {
    LOG('_decompressBlocks: start');
    this._keyBlockInfoStartOffset = this._keyHeaderEndOffset;
    LOG('  keyBlockInfoCompSize:', this.keyBlockInfoCompSize, 'encrypt:', this._encrypt);
    let infoComp = slice(this.buffer, this._keyBlockInfoStartOffset, this.keyBlockInfoCompSize);

    if (this._encrypt === 2) {
      LOG('  -> decrypting key info block');
      infoComp = fastDecrypt(infoComp);
    }

    // Block-level compression type is LITTLE-ENDIAN in MDX v2
    const compType = readU32LE(infoComp, 0);
    LOG('  key info block compType:', compType, '(expected 2)');

    let infoDecomp;
    if (compType === 2) {
      infoDecomp = await decompressZlib(infoComp.slice(8));
      LOG('  decompressed key info:', infoDecomp.length, 'bytes');
    } else {
      infoDecomp = infoComp;
      LOG('  key info uncompressed');
    }

    // Parse key block info entries
    let o = 0;
    let entriesAccum = 0;
    let compAccum = 0;
    let decompAccum = 0;

    LOG('  keyBlocksNum:', this.keyBlocksNum, 'first key:', (infoDecomp ? this._decoder.decode(infoDecomp.slice(6, 20)).replace(/\x00/g,'') : 'N/A'));

    for (let i = 0; i < this.keyBlocksNum; i++) {
      const blockEntries = this._numFmt(infoDecomp, o); o += this._numWidth;

      const firstKeySize = readU16(infoDecomp, o); o += 2;
      const isUtf16 = this._encoding === 'UTF-16';
      const termSize = 1;
      const stepGap = isUtf16 ? (firstKeySize + termSize) * 2 : firstKeySize + termSize;
      const fkEnd = Math.min(o + stepGap - (isUtf16 ? 2 : 0), infoDecomp.length);
      const firstKey = this._decoder.decode(infoDecomp.slice(o, fkEnd)).replace(/\x00+$/, '');
      o += stepGap;

      const lastKeySize = readU16(infoDecomp, o); o += 2;
      const stepGap2 = isUtf16 ? (lastKeySize + termSize) * 2 : lastKeySize + termSize;
      const lkEnd = Math.min(o + stepGap2 - (isUtf16 ? 2 : 0), infoDecomp.length);
      const lastKey = this._decoder.decode(infoDecomp.slice(o, lkEnd)).replace(/\x00+$/, '');
      o += stepGap2;

      const kbCompSize = this._numFmt(infoDecomp, o); o += this._numWidth;
      const kbDecompSize = this._numFmt(infoDecomp, o); o += this._numWidth;

      this.keyBlockInfoList.push({
        firstKey,
        lastKey,
        keyBlockCompSize: kbCompSize,
        keyBlockCompAccumulator: compAccum,
        keyBlockDecompSize: kbDecompSize,
        keyBlockDecompAccumulator: decompAccum,
        keyBlockEntriesNum: blockEntries,
        keyBlockEntriesAccumulator: entriesAccum,
        keyBlockIndex: i,
      });

      entriesAccum += blockEntries;
      compAccum += kbCompSize;
      decompAccum += kbDecompSize;
    }

    this._keyBlockInfoEndOffset = this._keyBlockInfoStartOffset + this.keyBlockInfoCompSize;
    this._keyBlockStartOffset = this._keyBlockInfoEndOffset;

    // Parse record header
    const rhOffset = this._keyBlockInfoEndOffset + this.keyBlocksTotalSize;
    const rhLen = this._version >= 2.0 ? 4 * 8 : 4 * 4;
    const rhBuf = slice(this.buffer, rhOffset, rhLen);
    let rhO = 0;

    this.recordBlocksNum = this._numFmt(rhBuf, rhO); rhO += this._numWidth;
    /* entriesNum = */ this._numFmt(rhBuf, rhO); rhO += this._numWidth;
    this.recordBlockInfoCompSize = this._numFmt(rhBuf, rhO); rhO += this._numWidth;
    this.recordBlockCompSize = this._numFmt(rhBuf, rhO);

    const recordInfoStart = rhOffset + rhLen;
    const riBuf = slice(this.buffer, recordInfoStart, this.recordBlockInfoCompSize);
    let riO = 0;
    let rCompAccu = 0;
    let rDecompAccu = 0;

    for (let i = 0; i < this.recordBlocksNum; i++) {
      const compSize = this._numFmt(riBuf, riO); riO += this._numWidth;
      const decompSize = this._numFmt(riBuf, riO); riO += this._numWidth;

      this.recordBlockInfoList.push({
        compSize,
        compAccumulator: rCompAccu,
        decompSize,
        decompAccumulator: rDecompAccu,
      });

      rCompAccu += compSize;
      rDecompAccu += decompSize;
    }

    this._recordInfoEndOffset = recordInfoStart + this.recordBlockInfoCompSize;
    this._recordBlockStartOffset = this._recordInfoEndOffset;
  }

  _parseHeaderXml(text) {
    const obj = {};
    const dictMatch = text.match(/<Dictionary\s+([^>]+)>/i) || text.match(/<Library_Data\s+([^>]+)>/i);
    if (dictMatch) {
      const attrRe = /(\w+)\s*=\s*"([^"]*)"/g;
      let m;
      while ((m = attrRe.exec(dictMatch[1])) !== null) {
        obj[m[1]] = m[2];
      }
    }
    return obj;
  }

  /**
   * Find which key block a word belongs to via binary search.
   */
  _reduceWordKeyBlock(word) {
    let left = 0;
    let right = this.keyBlockInfoList.length - 1;

    while (left <= right) {
      const mid = left + ((right - left) >> 1);
      const info = this.keyBlockInfoList[mid];

      if (word >= info.firstKey && word <= info.lastKey) {
        return mid;
      } else if (word > info.lastKey) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    return -1;
  }

  /**
   * Decode a single key block by key block index.
   */
  async _decodeKeyBlockByKBID(kbid) {
    const info = this.keyBlockInfoList[kbid];
    const startOffset = info.keyBlockCompAccumulator + this._keyBlockStartOffset;
    let compBuf = slice(this.buffer, startOffset, info.keyBlockCompSize);

    // Decrypt key blocks only if encrypt bit 1 is set (flag 1 or 3)
    if (this._encrypt & 1) {
      compBuf = fastDecrypt(compBuf);
    }

    const compType = readU32LE(compBuf, 0);
    let keyBlock;
    if (compType === 0) {
      keyBlock = compBuf.slice(8);
    } else if (compType === 2) {
      keyBlock = await decompressZlib(compBuf.slice(8));
    } else if (compType === 1) {
      console.warn('MDX: LZO compression not supported');
      return [];
    } else {
      throw new Error(`Unknown key block compression type: ${compType}`);
    }

    return this._splitKeyBlock(keyBlock);
  }

  _splitKeyBlock(keyBlock) {
    const list = [];
    const isUtf16 = this._encoding === 'UTF-16';
    const width = isUtf16 ? 2 : 1;

    let pos = 0;
    while (pos < keyBlock.length) {
      const recordStartOffset = this._numFmt(keyBlock, pos);
      pos += this._numWidth;

      // Find null terminator
      let end = pos;
      while (end < keyBlock.length) {
        if (width === 1) {
          if (keyBlock[end] === 0) break;
          end += 1;
        } else {
          if (keyBlock[end] === 0 && keyBlock[end + 1] === 0) break;
          end += 2;
        }
      }

      const keyText = this._decoder.decode(keyBlock.slice(pos, end));
      pos = end + width;
      list.push({ recordStartOffset, keyText });
    }

    return list;
  }

  _reduceRecordBlock(recordStart) {
    let left = 0;
    let right = this.recordBlockInfoList.length - 1;
    let mid;
    while (left <= right) {
      mid = left + ((right - left) >> 1);
      if (recordStart >= this.recordBlockInfoList[mid].decompAccumulator) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    return left - 1;
  }

  async _decodeRecordBlockByRBID(rbid, keyText, start, nextStart) {
    const info = this.recordBlockInfoList[rbid];
    const startOffset = info.compAccumulator + this._recordBlockStartOffset;
    let compBuf = slice(this.buffer, startOffset, info.compSize);

    // Decrypt record blocks only if encrypt bit 0 is set (flag 1 or 3)
    if (this._encrypt & 1) {
      compBuf = fastDecrypt(compBuf);
    }

    const compType = readU32LE(compBuf, 0);
    let recordBlock;
    if (compType === 0) {
      recordBlock = compBuf.slice(8);
    } else if (compType === 1) {
      console.warn('MDX: LZO compression in record block');
      return { keyText, definition: '' };
    } else if (compType === 2) {
      recordBlock = await decompressZlib(compBuf.slice(8));
    } else {
      throw new Error(`Unknown record block compression type: ${compType}`);
    }

    const relStart = start - info.decompAccumulator;
    const relEnd = nextStart - info.decompAccumulator;
    const data = recordBlock.slice(relStart, relEnd);
    return {
      keyText,
      definition: this._decoder.decode(data).replace(/\x00+$/, '').trim()
    };
  }

  /**
   * Look up a word in the dictionary.
   * @param {string} word
   * @returns {Promise<{keyText: string, definition: string|null}>}
   */
  async lookup(word) {
    const stripRe = /[()͡., \/\\@_\-́]/g;
    const lookupKey = word.replace(stripRe, '').toLowerCase();
    LOG('lookup:', word, '->', lookupKey, 'keyBlockInfoList.length:', this.keyBlockInfoList.length);

    let kbid = this._reduceWordKeyBlock(lookupKey);
    LOG('  _reduceWordKeyBlock(lookupKey):', kbid);
    if (kbid < 0) {
      kbid = this._reduceWordKeyBlock(word);
      LOG('  _reduceWordKeyBlock(orig):', kbid);
      if (kbid < 0) {
        LOG('  => NOT FOUND in any key block');
        return { keyText: word, definition: null };
      }
    }

    let result = await this._lookupInBlock(kbid, word, lookupKey);

    // Resolve @@@LINK= redirects (max 5 hops, skip already-resolved)
    const seen = new Set();
    seen.add(lookupKey);
    for (let hop = 0; hop < 5; hop++) {
      if (result.definition && result.definition.startsWith('@@@LINK=')) {
        const target = result.definition.slice(8).trim();
        const targetKey = target.replace(/[()͡., \/\\@_\-́]/g, '').toLowerCase();
        LOG('  redirect hop', hop, '->', target);
        if (seen.has(targetKey)) {
          LOG('  -> loop detected, breaking');
          break;
        }
        seen.add(targetKey);
        const raw = await this._fetchRawEntry(target);
        if (raw && raw.definition && !raw.definition.startsWith('@@@LINK=')) {
          result = raw;
          break;
        }
        result = raw || result;
      } else {
        break;
      }
    }

    return result;
  }

  /**
   * Fetch a raw dictionary entry WITHOUT resolving @@@LINK= redirects.
   */
  async _fetchRawEntry(word) {
    const stripRe = /[()͡., \/\\@_\-́]/g;
    const lookupKey = word.replace(stripRe, '').toLowerCase();
    let kbid = this._reduceWordKeyBlock(lookupKey);
    if (kbid < 0) {
      kbid = this._reduceWordKeyBlock(word);
      if (kbid < 0) return null;
    }
    return await this._lookupInBlock(kbid, word, lookupKey);
  }

  async _lookupInBlock(kbid, originalWord, lookupKey) {
    LOG('  _lookupInBlock kbid:', kbid, 'originalWord:', originalWord, 'lookupKey:', lookupKey);
    const list = await this._decodeKeyBlockByKBID(kbid);
    LOG('  decoded key block entries:', list?.length || 0);
    if (!list || list.length === 0) {
      LOG('  => empty key block');
      return { keyText: originalWord, definition: null };
    }

    if (list.length > 0) {
      LOG('  first 3 keys:', list.slice(0, 3).map(e => e.keyText).join(', '));
    }

    // Binary search by stripped key
    const stripRe = /[()., \/\\@_-́]/g;
    let left = 0;
    let right = list.length - 1;
    let found = -1;

    while (left <= right) {
      const mid = left + ((right - left) >> 1);
      const stripped = list[mid].keyText.replace(stripRe, '').toLowerCase();
      LOG('    binsearch mid:', mid, 'key:', list[mid].keyText, 'stripped:', stripped);
      if (stripped > lookupKey) {
        right = mid - 1;
      } else if (stripped < lookupKey) {
        left = mid + 1;
      } else {
        found = mid;
        LOG('    => FOUND at', mid, 'key:', list[mid].keyText);
        break;
      }
    }

    // Fallback to original word match
    if (found < 0) {
      LOG('  not found by stripped key, trying original word');
      left = 0;
      right = list.length - 1;
      while (left <= right) {
        const mid = left + ((right - left) >> 1);
        if (list[mid].keyText > originalWord) {
          right = mid - 1;
        } else if (list[mid].keyText < originalWord) {
          left = mid + 1;
        } else {
          found = mid;
          LOG('    => FOUND by original word at', mid);
          break;
        }
      }
    }

    if (found < 0) {
      LOG('  => NOT FOUND in key block');
      return { keyText: originalWord, definition: null };
    }

    const entry = list[found];
    const rid = this._reduceRecordBlock(entry.recordStartOffset);
    LOG('  recordStartOffset:', entry.recordStartOffset, 'reduceRecordBlock ->', rid);
    LOG('  recordBlockInfoList[rid]:', JSON.stringify(this.recordBlockInfoList[rid]));
    const nextStart = found + 1 < list.length
      ? list[found + 1].recordStartOffset
      : this._recordBlockStartOffset +
        this.recordBlockInfoList[this.recordBlockInfoList.length - 1].decompAccumulator +
        this.recordBlockInfoList[this.recordBlockInfoList.length - 1].decompSize;
    LOG('  nextStart:', nextStart);

    const result = await this._decodeRecordBlockByRBID(rid, entry.keyText, entry.recordStartOffset, nextStart);

    // Resolve @@@LINK= redirects (max 5 hops to avoid loops)
    let resolved = result;
    for (let hop = 0; hop < 5; hop++) {
      if (resolved.definition && resolved.definition.startsWith('@@@LINK=')) {
        const redirectTarget = resolved.definition.slice(8).trim();
        LOG('  -> redirect to:', redirectTarget);
        const linkResult = await this.lookup(redirectTarget);
        if (linkResult && linkResult.definition && !linkResult.definition.startsWith('@@@LINK=')) {
          resolved = linkResult;
          break;
        }
        resolved = linkResult || resolved;
      } else {
        break;
      }
    }

    return resolved;
  }
}