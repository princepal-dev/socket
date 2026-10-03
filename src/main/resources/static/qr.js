/**
 * Lightweight Standard QR Code SVG Generator for SocketDrop
 * Zero dependencies, pure vanilla JavaScript
 */
const QRCode = (function () {
  function QR8bitByte(data) {
    this.mode = 4;
    this.data = data;
  }
  QR8bitByte.prototype = {
    getLength: function () {
      return this.data.length;
    },
    write: function (buffer) {
      for (let i = 0; i < this.data.length; i++) buffer.put(this.data.charCodeAt(i), 8);
    },
  };

  const QRMath = {
    glog: function (n) {
      if (n < 1) throw new Error("glog(" + n + ")");
      return QRMath.LOG_TABLE[n];
    },
    gexp: function (n) {
      while (n < 0) n += 255;
      while (n >= 255) n -= 255;
      return QRMath.EXP_TABLE[n];
    },
    EXP_TABLE: new Array(256),
    LOG_TABLE: new Array(256),
  };
  for (let i = 0; i < 8; i++) QRMath.EXP_TABLE[i] = 1 << i;
  for (let i = 8; i < 256; i++) {
    QRMath.EXP_TABLE[i] =
      QRMath.EXP_TABLE[i - 4] ^
      QRMath.EXP_TABLE[i - 5] ^
      QRMath.EXP_TABLE[i - 6] ^
      QRMath.EXP_TABLE[i - 8];
  }
  for (let i = 0; i < 255; i++) QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;

  function QRPolynomial(num, shift) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
    for (let i = num.length - offset; i < this.num.length; i++) this.num[i] = 0;
  }
  QRPolynomial.prototype = {
    get: function (i) {
      return this.num[i];
    },
    getLength: function () {
      return this.num.length;
    },
    multiply: function (e) {
      const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
      for (let i = 0; i < this.getLength(); i++) {
        const a = this.get(i);
        // glog(0) is undefined, and zero coefficients do occur. Skip them.
        if (a === 0) continue;
        const aLog = QRMath.glog(a);
        for (let j = 0; j < e.getLength(); j++) {
          const b = e.get(j);
          if (b === 0) continue;
          num[i + j] ^= QRMath.gexp(aLog + QRMath.glog(b));
        }
      }
      return new QRPolynomial(num, 0);
    },
    mod: function (e) {
      if (this.getLength() - e.getLength() < 0) return this;
      const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
      const num = new Array(this.getLength());
      for (let i = 0; i < this.getLength(); i++) num[i] = this.get(i);
      for (let i = 0; i < e.getLength(); i++) {
        const ei = e.get(i);
        if (ei === 0) continue; // glog(0) is undefined
        num[i] ^= QRMath.gexp(QRMath.glog(ei) + ratio);
      }
      return new QRPolynomial(num, 0).mod(e);
    },
  };

  function QRBitBuffer() {
    this.buffer = [];
    this.length = 0;
  }
  QRBitBuffer.prototype = {
    get: function (index) {
      return ((this.buffer[Math.floor(index / 8)] >>> (7 - (index % 8))) & 1) === 1;
    },
    put: function (num, length) {
      for (let i = 0; i < length; i++) this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    },
    putBit: function (bit) {
      const bufIndex = Math.floor(this.length / 8);
      if (this.buffer.length <= bufIndex) this.buffer.push(0);
      if (bit) this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
      this.length++;
    },
  };

  const PATTERN_POSITION_TABLE = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
  ];

  const RS_BLOCK_TABLE = [
    // 1-L, 1-M
    [1, 26, 19],
    [1, 26, 16],
    // 2-L, 2-M
    [1, 44, 34],
    [1, 44, 28],
    // 3-L, 3-M
    [1, 70, 55],
    [1, 70, 44],
    // 4-L, 4-M
    [1, 100, 80],
    [2, 50, 32],
    // 5-L, 5-M
    [1, 134, 108],
    [2, 67, 43],
    // 6-L, 6-M
    [2, 86, 68],
    [4, 43, 27],
    // 7-L, 7-M
    [2, 98, 78],
    [4, 49, 31],
  ];

  // BCH(18, 6) version codes for symbols version 7 to 10 (ISO/IEC 18004:2006 Section 8.10)
  const QR_VERSION_INFO = {
    7: 0x07c94,
    8: 0x085bc,
    9: 0x09a99,
    10: 0x0a4d3,
  };

  // Error-correction levels use the qrcode.js convention. The RS block table below only
  // carries L and M entries, so this encoder emits L. Previously the level was passed as 0,
  // which the table lookup read as "L" while the format information advertised "M" — a decoder
  // then applied M-level correction to L-level data and read pure garbage.
  const ERROR_CORRECT_LEVEL = { L: 1, M: 0, Q: 3, H: 2 };
  const EC_L = ERROR_CORRECT_LEVEL.L;
  const EC_L_TABLE_OFFSET = 0;
  const EC_M_TABLE_OFFSET = 1;

  function getRsBlocks(typeNumber, errorCorrectionLevel) {
    const offset =
      errorCorrectionLevel === EC_L ? EC_L_TABLE_OFFSET : EC_M_TABLE_OFFSET;
    const rsBlock = RS_BLOCK_TABLE[(typeNumber - 1) * 2 + offset];
    const list = [];
    for (let i = 0; i < rsBlock[0]; i++) {
      list.push({ totalCount: rsBlock[1], dataCount: rsBlock[2] });
    }
    return list;
  }

  /**
   * Standard mask penalty scoring (ISO/IEC 18004 section 8.8.2); lower is better.
   *   Rule 1 - penalty for each run of 5+ same-colour modules.
   *   Rule 2 - penalty for each 2x2 block of one colour.
   *   Rule 3 - penalty for each 1:1:3:1:1 finder-like pattern with 4 light modules beside it.
   *   Rule 4 - penalty for dark/light imbalance away from 50%.
   */
  const FINDER_LIKE = [true, false, true, true, true, false, true, false, false, false, false];

  function getLostPoint(qrCode) {
    const size = qrCode.getModuleCount();
    const m = qrCode.modules;
    let lost = 0;

    // Rule 1 + Rule 3 across rows, then down columns.
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < size; a++) {
        const at = pass === 0 ? (i) => m[a][i] : (i) => m[i][a];
        let run = 1;
        for (let i = 1; i < size; i++) {
          if (at(i) === at(i - 1)) {
            run += 1;
          } else {
            if (run >= 5) lost += 3 + (run - 5);
            run = 1;
          }
        }
        if (run >= 5) lost += 3 + (run - 5);

        for (let i = 0; i + FINDER_LIKE.length <= size; i++) {
          let hit = true;
          for (let k = 0; k < FINDER_LIKE.length; k++) {
            if (at(i + k) !== FINDER_LIKE[k]) { hit = false; break; }
          }
          if (hit) lost += 40;
        }
      }
    }

    // Rule 2.
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) lost += 3;
      }
    }

    // Rule 4.
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark += 1;
    const percent = (dark * 100) / (size * size);
    lost += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return lost;
  }

  function getBestMaskPattern(qrCode) {
    let minLostPoint = Infinity;
    let pattern = 0;
    for (let i = 0; i < 8; i += 1) {
      qrCode.makeImpl(true, i);
      const lostPoint = getLostPoint(qrCode);
      if (lostPoint < minLostPoint) {
        minLostPoint = lostPoint;
        pattern = i;
      }
    }
    return pattern;
  }

  /** The eight data-mask formulas from ISO/IEC 18004 table 10. */
  function maskFn(pattern, row, col) {
    switch (pattern) {
      case 0: return (row + col) % 2 === 0;
      case 1: return row % 2 === 0;
      case 2: return col % 3 === 0;
      case 3: return (row + col) % 3 === 0;
      case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
      case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
      case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
      case 7: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function QRCodeModel(typeNumber, errorCorrectionLevel) {
    this.typeNumber = typeNumber;
    this.errorCorrectionLevel = errorCorrectionLevel;
    this.modules = null;
    this.moduleCount = 0;
    this.dataCache = null;
    this.dataList = [];
  }

  QRCodeModel.prototype = {
    addData: function (data) {
      this.dataList.push(new QR8bitByte(data));
    },
    isDark: function (row, col) {
      return this.modules[row][col] === true;
    },
    getModuleCount: function () {
      return this.moduleCount;
    },
    make: function () {
      this.makeImpl(false, getBestMaskPattern(this));
    },
    makeImpl: function (test, maskPattern) {
      this.moduleCount = this.typeNumber * 4 + 17;
      this.modules = new Array(this.moduleCount);
      for (let row = 0; row < this.moduleCount; row++) {
        this.modules[row] = new Array(this.moduleCount).fill(null);
      }
      this.setupPositionProbePattern(0, 0);
      this.setupPositionProbePattern(this.moduleCount - 7, 0);
      this.setupPositionProbePattern(0, this.moduleCount - 7);
      this.setupPositionAdjustPattern();
      this.setupTimingPattern();
      this.setupTypeInfo(test, maskPattern);
      this.setupVersionInfo();
      if (this.dataCache == null) {
        this.dataCache = QRCodeModel.createData(
          this.typeNumber,
          this.errorCorrectionLevel,
          this.dataList
        );
      }
      this.mapData(this.dataCache, maskPattern);
    },
    setupPositionProbePattern: function (row, col) {
      for (let r = -1; r <= 7; r++) {
        if (row + r <= -1 || this.moduleCount <= row + r) continue;
        for (let c = -1; c <= 7; c++) {
          if (col + c <= -1 || this.moduleCount <= col + c) continue;
          if (
            (0 <= r && r <= 6 && (c == 0 || c == 6)) ||
            (0 <= c && c <= 6 && (r == 0 || r == 6)) ||
            (2 <= r && r <= 4 && 2 <= c && c <= 4)
          ) {
            this.modules[row + r][col + c] = true;
          } else {
            this.modules[row + r][col + c] = false;
          }
        }
      }
    },
    setupTimingPattern: function () {
      for (let r = 8; r < this.moduleCount - 8; r++) {
        if (this.modules[r][6] != null) continue;
        this.modules[r][6] = r % 2 === 0;
      }
      for (let c = 8; c < this.moduleCount - 8; c++) {
        if (this.modules[6][c] != null) continue;
        this.modules[6][c] = c % 2 === 0;
      }
    },
    setupPositionAdjustPattern: function () {
      const pos = PATTERN_POSITION_TABLE[this.typeNumber - 1] || [];
      for (let i = 0; i < pos.length; i++) {
        for (let j = 0; j < pos.length; j++) {
          const row = pos[i],
            col = pos[j];
          if (this.modules[row][col] != null) continue;
          for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
              if (Math.abs(r) == 2 || Math.abs(c) == 2 || (r == 0 && c == 0)) {
                this.modules[row + r][col + c] = true;
              } else {
                this.modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    },
    setupTypeInfo: function (test, maskPattern) {
      const data = (this.errorCorrectionLevel << 3) | maskPattern;
      let bits = data << 10;
      while (QRCodeModel.getBCHTypeInfo(bits) >= 0) {
        bits ^= 0x537 << QRCodeModel.getBCHTypeInfo(bits);
      }
      const typeInfo = ((data << 10) | bits) ^ 0x5412;
      for (let i = 0; i < 15; i++) {
        const mod = ((typeInfo >>> i) & 1) === 1;
        if (i < 6) this.modules[i][8] = mod;
        else if (i < 8) this.modules[i + 1][8] = mod;
        else this.modules[this.moduleCount - 15 + i][8] = mod;

        if (i < 8) this.modules[8][this.moduleCount - i - 1] = mod;
        else if (i < 9) this.modules[8][15 - i - 1 + 1] = mod;
        else this.modules[8][15 - i - 1] = mod;
      }
      this.modules[this.moduleCount - 8][8] = true;
    },
    setupVersionInfo: function () {
      if (this.typeNumber < 7) return;
      const bits = QR_VERSION_INFO[this.typeNumber];
      if (!bits) return;
      for (let i = 0; i < 18; i++) {
        const mod = ((bits >>> i) & 1) === 1;
        this.modules[Math.floor(i / 3)][this.moduleCount - 11 + (i % 3)] = mod;
        this.modules[this.moduleCount - 11 + (i % 3)][Math.floor(i / 3)] = mod;
      }
    },
    mapData: function (data, maskPattern) {
      let inc = -1,
        row = this.moduleCount - 1,
        bitIndex = 7,
        byteIndex = 0;
      for (let col = this.moduleCount - 1; col > 0; col -= 2) {
        if (col == 6) col--;
        while (true) {
          for (let c = 0; c < 2; c++) {
            if (this.modules[row][col - c] == null) {
              let dark = false;
              if (byteIndex < data.length) {
                dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
              }
              // Honour the selected mask. This previously hardcoded mask 0 while
              // the format information advertised whichever mask was chosen, so a
              // decoder un-masked the wrong cells and read noise.
              if (maskFn(maskPattern, row, col - c)) dark = !dark;
              this.modules[row][col - c] = dark;
              bitIndex--;
              if (bitIndex == -1) {
                byteIndex++;
                bitIndex = 7;
              }
            }
          }
          row += inc;
          if (row < 0 || this.moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    },
  };

  QRCodeModel.getBCHTypeInfo = function (data) {
    let d = data >>> 10,
      i = 0;
    while (d > 0) {
      d >>>= 1;
      i++;
    }
    return i - 1;
  };

  QRCodeModel.createData = function (typeNumber, errorCorrectionLevel, dataList) {
    const rsBlocks = getRsBlocks(typeNumber, errorCorrectionLevel);
    const buffer = new QRBitBuffer();
    for (let i = 0; i < dataList.length; i++) {
      const data = dataList[i];
      buffer.put(data.mode, 4);
      buffer.put(data.getLength(), typeNumber < 10 ? 8 : 16);
      data.write(buffer);
    }
    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
    if (buffer.length + 4 <= totalDataCount * 8) buffer.put(0, 4);
    while (buffer.length % 8 != 0) buffer.putBit(false);
    while (buffer.length < totalDataCount * 8) {
      buffer.put(0xec, 8);
      if (buffer.length >= totalDataCount * 8) break;
      buffer.put(0x11, 8);
    }
    return QRCodeModel.createBytes(buffer, rsBlocks);
  };

  QRCodeModel.createBytes = function (buffer, rsBlocks) {
    let offset = 0,
      maxDcCount = 0,
      maxEcCount = 0;
    const dcdata = new Array(rsBlocks.length),
      ecdata = new Array(rsBlocks.length);
    for (let r = 0; r < rsBlocks.length; r++) {
      const dcCount = rsBlocks[r].dataCount,
        ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);
      dcdata[r] = new Array(dcCount);
      for (let i = 0; i < dcdata[r].length; i++) dcdata[r][i] = 0xff & buffer.buffer[i + offset];
      offset += dcCount;

      let rsPoly = new QRPolynomial([1], 0);
      for (let i = 0; i < ecCount; i++) rsPoly = rsPoly.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
      const rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1);
      for (let i = 0; i < ecdata[r].length; i++) {
        const modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
      }
    }
    let totalCodeCount = 0;
    for (let i = 0; i < rsBlocks.length; i++) totalCodeCount += rsBlocks[i].totalCount;
    const data = new Array(totalCodeCount);
    let index = 0;
    for (let i = 0; i < maxDcCount; i++) {
      for (let r = 0; r < rsBlocks.length; r++) {
        if (i < dcdata[r].length) data[index++] = dcdata[r][i];
      }
    }
    for (let i = 0; i < maxEcCount; i++) {
      for (let r = 0; r < rsBlocks.length; r++) {
        if (i < ecdata[r].length) data[index++] = ecdata[r][i];
      }
    }
    return data;
  };

  return {
    generateSvg: function (text, size = 180) {
      if (!text) return "";
      // Byte-mode capacity at error-correction level L. Pick the smallest symbol that
      // fits: fewer modules means larger, easier-to-scan squares at a given pixel size.
      const len = text.length;
      let type = 1;
      if (len > 17) type = 2;
      if (len > 32) type = 3;
      if (len > 53) type = 4;
      if (len > 78) type = 5;
      if (len > 106) type = 6;
      if (len > 134) type = 7;
      const qr = new QRCodeModel(type, EC_L);
      qr.addData(text);
      qr.make();
      const count = qr.getModuleCount();
      // Spec quiet zone = 4 modules each side. Was 2 -> scanners failed.
      const QUIET = 4;
      let path = "";
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.isDark(r, c)) {
            path += `M${c + QUIET},${r + QUIET}h1v1h-1z `;
          }
        }
      }
      const total = count + QUIET * 2;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges">
        <rect width="${total}" height="${total}" fill="#ffffff"/>
        <path d="${path}" fill="#0f172a"/>
      </svg>`;
    },
  };
})();

if (typeof window !== "undefined") {
  window.QRCode = QRCode;
}
