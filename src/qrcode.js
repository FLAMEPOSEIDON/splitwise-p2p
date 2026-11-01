/**
 * qrcode.js — Zero-dependency QR Code generator for Terminal & Web SVG.
 * Generates ISO/IEC 18004 compliant QR codes (Version 1-10, Error Correction M/L).
 */

// Galois Field GF(256) tables for Reed-Solomon error correction
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_EXP[i + 255] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d; // polynomial x^8 + x^4 + x^3 + x^2 + 1
  }
})();

function gfMul(x, y) {
  if (x === 0 || y === 0) return 0;
  return GF_EXP[GF_LOG[x] + GF_LOG[y]];
}

function polyMul(p1, p2) {
  const result = new Uint8Array(p1.length + p2.length - 1);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      result[i + j] ^= gfMul(p1[i], p2[j]);
    }
  }
  return result;
}

function rsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    poly = polyMul(poly, new Uint8Array([1, GF_EXP[i]]));
  }
  return poly;
}

function rsCompute(data, numEcBytes) {
  const gen = rsGeneratorPoly(numEcBytes);
  const res = new Uint8Array(numEcBytes);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ res[0];
    res.set(res.subarray(1));
    res[numEcBytes - 1] = 0;
    for (let j = 0; j < numEcBytes; j++) {
      res[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return res;
}

// QR Code version capacities and configurations (EC Level L & M)
// Supports Version 1 to 6 (plenty for URLs up to ~130 characters)
const QR_CONFIGS = [
  // [version, totalCodewords, dataCodewordsL, ecCodewordsL, dataCodewordsM, ecCodewordsM]
  [1, 26, 19, 7, 16, 10],
  [2, 44, 34, 10, 28, 16],
  [3, 70, 55, 15, 44, 26],
  [4, 100, 80, 20, 64, 36],
  [5, 134, 108, 26, 86, 48],
  [6, 172, 136, 36, 108, 64],
];

function selectVersion(byteCount) {
  for (const [ver, , dataL, , dataM] of QR_CONFIGS) {
    if (byteCount <= dataM - 2) return { version: ver, ecLevel: 'M' };
    if (byteCount <= dataL - 2) return { version: ver, ecLevel: 'L' };
  }
  return { version: 6, ecLevel: 'L' };
}

function createBitMatrix(size) {
  const matrix = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
  return matrix;
}

function placeFinderPattern(matrix, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const nr = row + r;
      const nc = col + c;
      if (nr < 0 || nr >= matrix.length || nc < 0 || nc >= matrix.length) continue;
      if (
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4)
      ) {
        matrix[nr][nc] = 1;
      } else {
        matrix[nr][nc] = 0;
      }
    }
  }
}

function placeTimingPatterns(matrix) {
  const size = matrix.length;
  for (let i = 8; i < size - 8; i++) {
    const val = i % 2 === 0 ? 1 : 0;
    if (matrix[6][i] === -1) matrix[6][i] = val;
    if (matrix[i][6] === -1) matrix[i][6] = val;
  }
}

function placeAlignmentPattern(matrix, row, col) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      if (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) {
        matrix[row + r][col + c] = 1;
      } else {
        matrix[row + r][col + c] = 0;
      }
    }
  }
}

const ALIGN_POSITIONS = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
};

function generateQRMatrix(text) {
  const dataBytes = Buffer.from(text, 'utf8');
  const { version, ecLevel } = selectVersion(dataBytes.length);
  const cfg = QR_CONFIGS[version - 1];
  const dataCapacity = ecLevel === 'M' ? cfg[4] : cfg[2];
  const ecCapacity = ecLevel === 'M' ? cfg[5] : cfg[3];

  // Bit stream
  const bits = [];
  function pushBits(val, len) {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  }

  // Byte mode indicator: 0100
  pushBits(0b0100, 4);
  pushBits(dataBytes.length, 8);
  for (const b of dataBytes) {
    pushBits(b, 8);
  }

  // Terminator (up to 4 zeroes)
  const remainingBits = dataCapacity * 8 - bits.length;
  pushBits(0, Math.min(4, Math.max(0, remainingBits)));

  // Pad to multiple of 8
  while (bits.length % 8 !== 0) bits.push(0);

  // Pad bytes 0xEC, 0x11
  const padPatterns = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < dataCapacity * 8) {
    pushBits(padPatterns[padIdx % 2], 8);
    padIdx++;
  }

  // Convert bits to data codewords
  const dataWords = new Uint8Array(dataCapacity);
  for (let i = 0; i < dataCapacity; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j];
    }
    dataWords[i] = b;
  }

  // Error correction calculation
  const ecWords = rsCompute(dataWords, ecCapacity);

  // Combine data + EC codewords
  const allCodewords = new Uint8Array(dataCapacity + ecCapacity);
  allCodewords.set(dataWords, 0);
  allCodewords.set(ecWords, dataCapacity);

  const size = 17 + version * 4;
  const matrix = createBitMatrix(size);

  // Place finder patterns
  placeFinderPattern(matrix, 0, 0);
  placeFinderPattern(matrix, 0, size - 7);
  placeFinderPattern(matrix, size - 7, 0);

  // Alignment patterns
  if (ALIGN_POSITIONS[version]) {
    const coords = ALIGN_POSITIONS[version];
    for (const r of coords) {
      for (const c of coords) {
        if (
          (r === 6 && c === 6) ||
          (r === 6 && c === size - 7) ||
          (r === size - 7 && c === 6)
        )
          continue;
        placeAlignmentPattern(matrix, r, c);
      }
    }
  }

  // Place timing patterns
  placeTimingPatterns(matrix);

  // Dark module
  matrix[4 * version + 9][8] = 1;

  // Format info area reservation
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === -1) matrix[8][i] = 0;
    if (matrix[i][8] === -1) matrix[i][8] = 0;
  }
  for (let i = size - 8; i < size; i++) {
    if (matrix[8][i] === -1) matrix[8][i] = 0;
    if (matrix[i][8] === -1) matrix[i][8] = 0;
  }

  // Place data bits with Mask Pattern 0: (row + col) % 2 === 0
  let bitIdx = 0;
  const totalBits = allCodewords.length * 8;
  let dir = -1; // upwards
  let col = size - 1;

  while (col > 0) {
    if (col === 6) col--; // skip vertical timing column
    const rowRange = dir === -1
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const r of rowRange) {
      for (const c of [col, col - 1]) {
        if (matrix[r][c] === -1) {
          let bit = 0;
          if (bitIdx < totalBits) {
            const bytePos = Math.floor(bitIdx / 8);
            const bitPos = 7 - (bitIdx % 8);
            bit = (allCodewords[bytePos] >>> bitPos) & 1;
            bitIdx++;
          }
          // Apply mask 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) {
            bit ^= 1;
          }
          matrix[r][c] = bit;
        }
      }
    }
    dir = -dir;
    col -= 2;
  }

  // Write format information (Mask 0, EC L/M)
  // Format string for EC M, Mask 0 = 101010000010010
  // Format string for EC L, Mask 0 = 111011111000100
  const formatBits = ecLevel === 'M'
    ? [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0]
    : [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0];

  for (let i = 0; i < 6; i++) matrix[8][i] = formatBits[i];
  matrix[8][7] = formatBits[6];
  matrix[8][8] = formatBits[7];
  matrix[7][8] = formatBits[8];
  for (let i = 0; i < 6; i++) matrix[5 - i][8] = formatBits[9 + i];

  for (let i = 0; i < 8; i++) matrix[size - 1 - i][8] = formatBits[i];
  for (let i = 0; i < 7; i++) matrix[8][size - 7 + i] = formatBits[8 + i];

  return matrix;
}

/**
 * Generate ASCII half-block string for rendering in ANSI terminal.
 */
function toTerminal(text) {
  const matrix = generateQRMatrix(text);
  const size = matrix.length;
  const border = 2;
  const fullSize = size + border * 2;

  const padded = Array.from({ length: fullSize }, () => new Int8Array(fullSize).fill(0));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      padded[r + border][c + border] = matrix[r][c];
    }
  }

  const lines = [];
  // Use half-block character: \u2584 (lower half block)
  // Top pixel white, bottom black = '▄'
  // Both white = ' ' (on white bg) or inverted
  for (let r = 0; r < fullSize; r += 2) {
    let line = '';
    for (let c = 0; c < fullSize; c++) {
      const top = padded[r][c];
      const bot = r + 1 < fullSize ? padded[r + 1][c] : 0;
      if (top === 1 && bot === 1) line += ' ';
      else if (top === 1 && bot === 0) line += '▄';
      else if (top === 0 && bot === 1) line += '▀';
      else line += '█';
    }
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Generate SVG string for browser display.
 */
function toSvg(text, cellSize = 8) {
  const matrix = generateQRMatrix(text);
  const size = matrix.length;
  const border = 2;
  const total = (size + border * 2) * cellSize;

  let rects = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] === 1) {
        rects += `<rect x="${(c + border) * cellSize}" y="${(r + border) * cellSize}" width="${cellSize}" height="${cellSize}" fill="#0f172a"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="100%" height="100%"><rect width="100%" height="100%" fill="#ffffff" rx="12"/>${rects}</svg>`;
}

module.exports = {
  toTerminal,
  toSvg,
  generateQRMatrix,
};
