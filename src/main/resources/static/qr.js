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
        for (let j = 0; j < e.getLength(); j++) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
        }
      }
      return new QRPolynomial(num, 0);
    },
    mod: function (e) {
      if (this.getLength() - e.getLength() < 0) return this;
      const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
      const num = new Array(this.getLength());
      for (let i = 0; i < this.getLength(); i++) num[i] = this.get(i);
      for (let i = 0; i < e.getLength(); i++) num[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
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

  function getRsBlocks(typeNumber, errorCorrectionLevel) {
    const rsBlock = RS_BLOCK_TABLE[(typeNumber - 1) * 2 + (errorCorrectionLevel === 0 ? 0 : 1)];
    const list = [];
    for (let i = 0; i < rsBlock[0]; i++) {
      list.push({ totalCount: rsBlock[1], dataCount: rsBlock[2] });
    }
    return list;
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
      this.makeImpl(false, 0);
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
              const mask = (row + col - c) % 2 === 0;
              if (mask) dark = !dark;
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
      let type = 3;
      if (text.length > 34) type = 4;
      if (text.length > 55) type = 5;
      if (text.length > 80) type = 6;
      if (text.length > 105) type = 7;
      const qr = new QRCodeModel(type, 0); // Level L
      qr.addData(text);
      qr.make();
      const count = qr.getModuleCount();
      let path = "";
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.isDark(r, c)) {
            path += `M${c + 2},${r + 2}h1v1h-1z `;
          }
        }
      }
      const total = count + 4;
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
