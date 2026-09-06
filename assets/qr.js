/**
 * QR Code encoder - byte mode, error correction level M, versions 1 to 10.
 *
 * A direct port of the PHP encoder in the server edition, kept deliberately
 * line-for-line so the two can be diffed against each other. Vendored rather
 * than loaded from a CDN, because venue wifi at a door is not something to
 * depend on.
 */
var QR = (function () {
  'use strict';

  /** Level M: [ecPerBlock, group1Blocks, group1Data, group2Blocks, group2Data] */
  var EC_M = {
    1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0],
    4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0], 6: [16, 4, 27, 0, 0],
    7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37],
    10: [26, 4, 43, 1, 44]
  };

  /** Centre coordinates of the alignment patterns, per version. */
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  var EXP = null, LOG = null;

  /** Log/antilog tables for GF(256) with primitive polynomial 0x11D. */
  function buildTables() {
    if (EXP) return;
    EXP = new Array(512).fill(0);
    LOG = new Array(256).fill(0);
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  }

  /** Reed-Solomon generator polynomial, highest term first. */
  function rsGenerator(degree) {
    buildTables();
    var g = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(g.length + 1).fill(0);
      for (var j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= g[j] ? EXP[(LOG[g[j]] + i) % 255] : 0;
      }
      g = next;
    }
    return g;
  }

  /** The error-correction codewords for one block of data codewords. */
  function rsEncode(data, ecLen) {
    buildTables();
    var gen = rsGenerator(ecLen);
    var res = data.concat(new Array(ecLen).fill(0));

    for (var i = 0; i < data.length; i++) {
      var lead = res[i];
      if (lead === 0) continue;
      var shift = LOG[lead];
      for (var j = 0; j < gen.length; j++) {
        res[i + j] ^= gen[j] ? EXP[(LOG[gen[j]] + shift) % 255] : 0;
      }
    }
    return res.slice(data.length, data.length + ecLen);
  }

  /** BCH(15,5) format information for EC level M and the given mask. */
  function formatBits(mask) {
    var data = (0x00 << 3) | mask;          // level M is 0b00
    var rem = data << 10;
    for (var i = 4; i >= 0; i--) {
      if (rem & (1 << (i + 10))) rem ^= 0x537 << i;
    }
    return ((data << 10) | rem) ^ 0x5412;
  }

  /** BCH(18,6) version information, used from version 7 upwards. */
  function versionBits(version) {
    var rem = version << 12;
    for (var i = 5; i >= 0; i--) {
      if (rem & (1 << (i + 12))) rem ^= 0x1F25 << i;
    }
    return (version << 12) | rem;
  }

  /** Smallest version whose level-M byte capacity holds the given length. */
  function pickVersion(length) {
    for (var v = 1; v <= 10; v++) {
      var s = EC_M[v];
      var dataCodewords = s[1] * s[2] + s[3] * s[4];
      var countBits = v < 10 ? 8 : 16;
      var capacity = Math.floor((dataCodewords * 8 - 4 - countBits) / 8);
      if (length <= capacity) return v;
    }
    throw new Error('QR payload too long: ' + length + ' bytes (max 213)');
  }

  function pad(bits, width) {
    return bits.length >= width ? bits : new Array(width - bits.length + 1).join('0') + bits;
  }

  /** Data and EC codewords, interleaved into final transmission order. */
  function codewords(bytes, version) {
    var spec = EC_M[version];
    var ecLen = spec[0], g1Blocks = spec[1], g1Data = spec[2], g2Blocks = spec[3], g2Data = spec[4];
    var totalData = g1Blocks * g1Data + g2Blocks * g2Data;
    var countBits = version < 10 ? 8 : 16;

    // Mode indicator (byte = 0100), character count, then the payload itself.
    var bits = '0100' + pad(bytes.length.toString(2), countBits);
    for (var i = 0; i < bytes.length; i++) bits += pad(bytes[i].toString(2), 8);

    // Terminator, then pad out to a byte boundary.
    var terminator = Math.max(0, Math.min(4, totalData * 8 - bits.length));
    bits += new Array(terminator + 1).join('0');
    if (bits.length % 8) bits += new Array(8 - (bits.length % 8) + 1).join('0');

    var data = [];
    for (var b = 0; b < bits.length; b += 8) data.push(parseInt(bits.substr(b, 8), 2));

    // Alternating pad codewords fill the remaining capacity.
    var padBytes = [0xEC, 0x11];
    for (var p = 0; data.length < totalData; p++) data.push(padBytes[p % 2]);

    // Split into blocks, then compute error correction for each.
    var blocks = [], ecBlocks = [], offset = 0;
    var groups = [[g1Blocks, g1Data], [g2Blocks, g2Data]];
    for (var gi = 0; gi < groups.length; gi++) {
      for (var n = 0; n < groups[gi][0]; n++) {
        var block = data.slice(offset, offset + groups[gi][1]);
        offset += groups[gi][1];
        blocks.push(block);
        ecBlocks.push(rsEncode(block, ecLen));
      }
    }

    // Interleave: first codeword of every block, then the second, and so on.
    var out = [];
    var maxData = Math.max(g1Data, g2Data);
    for (var d = 0; d < maxData; d++) {
      for (var k = 0; k < blocks.length; k++) {
        if (d < blocks[k].length) out.push(blocks[k][d]);
      }
    }
    for (var e = 0; e < ecLen; e++) {
      for (var m = 0; m < ecBlocks.length; m++) out.push(ecBlocks[m][e]);
    }
    return out;
  }

  /** True when the module at the given position is flipped by this mask. */
  function maskAt(mask, row, col) {
    switch (mask) {
      case 0: return (row + col) % 2 === 0;
      case 1: return row % 2 === 0;
      case 2: return col % 3 === 0;
      case 3: return (row + col) % 3 === 0;
      case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
      case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
      case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
      default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    }
  }

  /** The four penalty rules from the spec, used to choose the best mask. */
  function penalty(m, size) {
    var score = 0, a, b, run, prev, v;

    // Rule 1: runs of five or more same-coloured modules in a row or column.
    for (var pass = 0; pass < 2; pass++) {
      for (a = 0; a < size; a++) {
        run = 0; prev = -1;
        for (b = 0; b < size; b++) {
          v = pass === 0 ? m[a][b] : m[b][a];
          if (v === prev) { run++; }
          else {
            if (run >= 5) score += 3 + (run - 5);
            run = 1; prev = v;
          }
        }
        if (run >= 5) score += 3 + (run - 5);
      }
    }

    // Rule 2: every 2x2 block of a single colour.
    for (var r = 0; r < size - 1; r++) {
      for (var c = 0; c < size - 1; c++) {
        v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }

    // Rule 3: finder-like 1:1:3:1:1 patterns with four light modules beside
    // them. An 11-module sliding window, so overlapping occurrences each count.
    for (a = 0; a < size; a++) {
      var wRow = 0, wCol = 0;
      for (b = 0; b < size; b++) {
        wRow = ((wRow << 1) & 0x7FF) | m[a][b];
        wCol = ((wCol << 1) & 0x7FF) | m[b][a];
        if (b < 10) continue;
        if (wRow === 0x5D0 || wRow === 0x05D) score += 40;
        if (wCol === 0x5D0 || wCol === 0x05D) score += 40;
      }
    }

    // Rule 4: deviation from an even balance of dark and light, in steps of 5%.
    var dark = 0;
    for (var i = 0; i < size; i++) {
      for (var j = 0; j < size; j++) dark += m[i][j];
    }
    var percent = (dark * 100) / (size * size);
    score += 10 * Math.floor(Math.abs(percent - 50) / 5);

    return score;
  }

  /** Writes the 15 format bits into both of their required positions. */
  function placeFormat(m, size, fmt) {
    for (var i = 0; i < 15; i++) {
      var bit = (fmt >> i) & 1;

      // First copy, wrapped around the top-left finder.
      if (i < 6) m[i][8] = bit;
      else if (i === 6) m[7][8] = bit;
      else if (i === 7) m[8][8] = bit;
      else if (i === 8) m[8][7] = bit;
      else m[8][14 - i] = bit;

      // Second copy, split between the other two finders.
      if (i < 8) m[8][size - 1 - i] = bit;
      else m[size - 15 + i][8] = bit;
    }
  }

  /** UTF-8 bytes for a string. */
  function toBytes(text) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
    var out = [], encoded = unescape(encodeURIComponent(text));
    for (var i = 0; i < encoded.length; i++) out.push(encoded.charCodeAt(i));
    return out;
  }

  /**
   * Encodes the text and returns the module matrix as rows of 0/1 integers.
   * forceMask pins the mask instead of scoring all eight; it exists so output
   * can be diffed against the PHP encoder, and is unused in normal operation.
   */
  function matrix(text, forceMask) {
    var bytes = toBytes(text);
    var version = pickVersion(bytes.length);
    var size = 17 + 4 * version;
    var r, c, i;

    var m = [], fixed = [];
    for (r = 0; r < size; r++) {
      m.push(new Array(size).fill(0));
      fixed.push(new Array(size).fill(false));
    }

    function set(row, col, value) {
      if (row < 0 || col < 0 || row >= size || col >= size) return;
      m[row][col] = value;
      fixed[row][col] = true;
    }

    // Finder patterns plus their separators, in three corners.
    var corners = [[0, 0], [0, size - 7], [size - 7, 0]];
    for (var k = 0; k < corners.length; k++) {
      var fr = corners[k][0], fc = corners[k][1];
      for (r = -1; r <= 7; r++) {
        for (c = -1; c <= 7; c++) {
          var inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
          var onRing = r === 0 || r === 6 || c === 0 || c === 6;
          var inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          set(fr + r, fc + c, (inside && (onRing || inCore)) ? 1 : 0);
        }
      }
    }

    // Timing patterns along row 6 and column 6.
    for (i = 8; i < size - 8; i++) {
      set(6, i, i % 2 === 0 ? 1 : 0);
      set(i, 6, i % 2 === 0 ? 1 : 0);
    }

    // Alignment patterns, skipping the three that would sit on a finder.
    var centres = ALIGN[version];
    for (var ai = 0; ai < centres.length; ai++) {
      for (var aj = 0; aj < centres.length; aj++) {
        var ar = centres[ai], ac = centres[aj];
        var onFinder = (ar <= 8 && ac <= 8)
          || (ar <= 8 && ac >= size - 9)
          || (ar >= size - 9 && ac <= 8);
        if (onFinder) continue;
        for (r = -2; r <= 2; r++) {
          for (c = -2; c <= 2; c++) {
            set(ar + r, ac + c, Math.max(Math.abs(r), Math.abs(c)) === 1 ? 0 : 1);
          }
        }
      }
    }

    // The always-dark module, and the reserved format-information strips.
    set(size - 8, 8, 1);
    for (i = 0; i < 9; i++) {
      if (!fixed[8][i]) set(8, i, 0);
      if (!fixed[i][8]) set(i, 8, 0);
    }
    for (i = 0; i < 8; i++) {
      if (!fixed[8][size - 1 - i]) set(8, size - 1 - i, 0);
      if (!fixed[size - 1 - i][8]) set(size - 1 - i, 8, 0);
    }

    // Version information blocks, from version 7 upwards.
    if (version >= 7) {
      var vbits = versionBits(version);
      for (i = 0; i < 18; i++) {
        var vbit = (vbits >> i) & 1;
        set(size - 11 + (i % 3), Math.floor(i / 3), vbit);
        set(Math.floor(i / 3), size - 11 + (i % 3), vbit);
      }
    }

    // Lay the codeword bits into the free modules, zigzagging up and down
    // through pairs of columns from the bottom-right corner.
    var bits = '';
    var cws = codewords(bytes, version);
    for (i = 0; i < cws.length; i++) bits += pad(cws[i].toString(2), 8);

    var index = 0, upward = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;                       // step over the timing column
      for (i = 0; i < size; i++) {
        var row = upward ? size - 1 - i : i;
        for (var d = 0; d < 2; d++) {
          var cc = col - d;
          if (fixed[row][cc]) continue;
          m[row][cc] = index < bits.length ? +bits[index] : 0;
          index++;
        }
      }
      upward = !upward;
    }

    // Try all eight masks and keep the one the spec scores lowest.
    var best = null, bestScore = Infinity;
    var masks = (forceMask === undefined || forceMask === null) ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask];

    for (var mi = 0; mi < masks.length; mi++) {
      var mask = masks[mi];
      var candidate = m.map(function (row) { return row.slice(); });
      for (r = 0; r < size; r++) {
        for (c = 0; c < size; c++) {
          if (!fixed[r][c] && maskAt(mask, r, c)) candidate[r][c] ^= 1;
        }
      }
      placeFormat(candidate, size, formatBits(mask));

      var score = penalty(candidate, size);
      if (score < bestScore) { bestScore = score; best = candidate; }
    }
    return best;
  }

  /** Draws a matrix onto a canvas element and returns it. */
  function toCanvas(text, options) {
    var opts = options || {};
    var scale = opts.scale || 8;
    var margin = opts.margin === undefined ? 4 : opts.margin;
    var mtx = matrix(text);
    var size = mtx.length;
    var px = (size + margin * 2) * scale;

    var canvas = opts.canvas || document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;

    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000000';

    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (mtx[r][c]) {
          ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
        }
      }
    }
    return canvas;
  }

  /** A PNG data: URI, suitable for an <img src> or a download link. */
  function toDataUrl(text, options) {
    return toCanvas(text, options).toDataURL('image/png');
  }

  return { matrix: matrix, toCanvas: toCanvas, toDataUrl: toDataUrl };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = QR;
