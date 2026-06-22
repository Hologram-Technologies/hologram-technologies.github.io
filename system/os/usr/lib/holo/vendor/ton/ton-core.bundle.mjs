var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/base64-js/index.js
var require_base64_js = __commonJS({
  "node_modules/base64-js/index.js"(exports) {
    "use strict";
    exports.byteLength = byteLength;
    exports.toByteArray = toByteArray;
    exports.fromByteArray = fromByteArray;
    var lookup = [];
    var revLookup = [];
    var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
    var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (i = 0, len = code.length; i < len; ++i) {
      lookup[i] = code[i];
      revLookup[code.charCodeAt(i)] = i;
    }
    var i;
    var len;
    revLookup["-".charCodeAt(0)] = 62;
    revLookup["_".charCodeAt(0)] = 63;
    function getLens(b64) {
      var len2 = b64.length;
      if (len2 % 4 > 0) {
        throw new Error("Invalid string. Length must be a multiple of 4");
      }
      var validLen = b64.indexOf("=");
      if (validLen === -1) validLen = len2;
      var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
      return [validLen, placeHoldersLen];
    }
    function byteLength(b64) {
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function _byteLength(b64, validLen, placeHoldersLen) {
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function toByteArray(b64) {
      var tmp;
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
      var curByte = 0;
      var len2 = placeHoldersLen > 0 ? validLen - 4 : validLen;
      var i2;
      for (i2 = 0; i2 < len2; i2 += 4) {
        tmp = revLookup[b64.charCodeAt(i2)] << 18 | revLookup[b64.charCodeAt(i2 + 1)] << 12 | revLookup[b64.charCodeAt(i2 + 2)] << 6 | revLookup[b64.charCodeAt(i2 + 3)];
        arr[curByte++] = tmp >> 16 & 255;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 2) {
        tmp = revLookup[b64.charCodeAt(i2)] << 2 | revLookup[b64.charCodeAt(i2 + 1)] >> 4;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 1) {
        tmp = revLookup[b64.charCodeAt(i2)] << 10 | revLookup[b64.charCodeAt(i2 + 1)] << 4 | revLookup[b64.charCodeAt(i2 + 2)] >> 2;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      return arr;
    }
    function tripletToBase64(num) {
      return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
    }
    function encodeChunk(uint8, start, end) {
      var tmp;
      var output = [];
      for (var i2 = start; i2 < end; i2 += 3) {
        tmp = (uint8[i2] << 16 & 16711680) + (uint8[i2 + 1] << 8 & 65280) + (uint8[i2 + 2] & 255);
        output.push(tripletToBase64(tmp));
      }
      return output.join("");
    }
    function fromByteArray(uint8) {
      var tmp;
      var len2 = uint8.length;
      var extraBytes = len2 % 3;
      var parts = [];
      var maxChunkLength = 16383;
      for (var i2 = 0, len22 = len2 - extraBytes; i2 < len22; i2 += maxChunkLength) {
        parts.push(encodeChunk(uint8, i2, i2 + maxChunkLength > len22 ? len22 : i2 + maxChunkLength));
      }
      if (extraBytes === 1) {
        tmp = uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "=="
        );
      } else if (extraBytes === 2) {
        tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "="
        );
      }
      return parts.join("");
    }
  }
});

// node_modules/ieee754/index.js
var require_ieee754 = __commonJS({
  "node_modules/ieee754/index.js"(exports) {
    exports.read = function(buffer, offset, isLE, mLen, nBytes) {
      var e, m;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var nBits = -7;
      var i = isLE ? nBytes - 1 : 0;
      var d = isLE ? -1 : 1;
      var s = buffer[offset + i];
      i += d;
      e = s & (1 << -nBits) - 1;
      s >>= -nBits;
      nBits += eLen;
      for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {
      }
      m = e & (1 << -nBits) - 1;
      e >>= -nBits;
      nBits += mLen;
      for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {
      }
      if (e === 0) {
        e = 1 - eBias;
      } else if (e === eMax) {
        return m ? NaN : (s ? -1 : 1) * Infinity;
      } else {
        m = m + Math.pow(2, mLen);
        e = e - eBias;
      }
      return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
    };
    exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
      var e, m, c;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
      var i = isLE ? 0 : nBytes - 1;
      var d = isLE ? 1 : -1;
      var s = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
      value = Math.abs(value);
      if (isNaN(value) || value === Infinity) {
        m = isNaN(value) ? 1 : 0;
        e = eMax;
      } else {
        e = Math.floor(Math.log(value) / Math.LN2);
        if (value * (c = Math.pow(2, -e)) < 1) {
          e--;
          c *= 2;
        }
        if (e + eBias >= 1) {
          value += rt / c;
        } else {
          value += rt * Math.pow(2, 1 - eBias);
        }
        if (value * c >= 2) {
          e++;
          c /= 2;
        }
        if (e + eBias >= eMax) {
          m = 0;
          e = eMax;
        } else if (e + eBias >= 1) {
          m = (value * c - 1) * Math.pow(2, mLen);
          e = e + eBias;
        } else {
          m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
          e = 0;
        }
      }
      for (; mLen >= 8; buffer[offset + i] = m & 255, i += d, m /= 256, mLen -= 8) {
      }
      e = e << mLen | m;
      eLen += mLen;
      for (; eLen > 0; buffer[offset + i] = e & 255, i += d, e /= 256, eLen -= 8) {
      }
      buffer[offset + i - d] |= s * 128;
    };
  }
});

// node_modules/buffer/index.js
var require_buffer = __commonJS({
  "node_modules/buffer/index.js"(exports) {
    "use strict";
    var base64 = require_base64_js();
    var ieee754 = require_ieee754();
    var customInspectSymbol = typeof Symbol === "function" && typeof Symbol["for"] === "function" ? Symbol["for"]("nodejs.util.inspect.custom") : null;
    exports.Buffer = Buffer3;
    exports.SlowBuffer = SlowBuffer;
    exports.INSPECT_MAX_BYTES = 50;
    var K_MAX_LENGTH = 2147483647;
    exports.kMaxLength = K_MAX_LENGTH;
    Buffer3.TYPED_ARRAY_SUPPORT = typedArraySupport();
    if (!Buffer3.TYPED_ARRAY_SUPPORT && typeof console !== "undefined" && typeof console.error === "function") {
      console.error(
        "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."
      );
    }
    function typedArraySupport() {
      try {
        const arr = new Uint8Array(1);
        const proto = { foo: function() {
          return 42;
        } };
        Object.setPrototypeOf(proto, Uint8Array.prototype);
        Object.setPrototypeOf(arr, proto);
        return arr.foo() === 42;
      } catch (e) {
        return false;
      }
    }
    Object.defineProperty(Buffer3.prototype, "parent", {
      enumerable: true,
      get: function() {
        if (!Buffer3.isBuffer(this)) return void 0;
        return this.buffer;
      }
    });
    Object.defineProperty(Buffer3.prototype, "offset", {
      enumerable: true,
      get: function() {
        if (!Buffer3.isBuffer(this)) return void 0;
        return this.byteOffset;
      }
    });
    function createBuffer(length) {
      if (length > K_MAX_LENGTH) {
        throw new RangeError('The value "' + length + '" is invalid for option "size"');
      }
      const buf = new Uint8Array(length);
      Object.setPrototypeOf(buf, Buffer3.prototype);
      return buf;
    }
    function Buffer3(arg, encodingOrOffset, length) {
      if (typeof arg === "number") {
        if (typeof encodingOrOffset === "string") {
          throw new TypeError(
            'The "string" argument must be of type string. Received type number'
          );
        }
        return allocUnsafe(arg);
      }
      return from(arg, encodingOrOffset, length);
    }
    Buffer3.poolSize = 8192;
    function from(value, encodingOrOffset, length) {
      if (typeof value === "string") {
        return fromString(value, encodingOrOffset);
      }
      if (ArrayBuffer.isView(value)) {
        return fromArrayView(value);
      }
      if (value == null) {
        throw new TypeError(
          "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
        );
      }
      if (isInstance(value, ArrayBuffer) || value && isInstance(value.buffer, ArrayBuffer)) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof SharedArrayBuffer !== "undefined" && (isInstance(value, SharedArrayBuffer) || value && isInstance(value.buffer, SharedArrayBuffer))) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof value === "number") {
        throw new TypeError(
          'The "value" argument must not be of type number. Received type number'
        );
      }
      const valueOf = value.valueOf && value.valueOf();
      if (valueOf != null && valueOf !== value) {
        return Buffer3.from(valueOf, encodingOrOffset, length);
      }
      const b = fromObject(value);
      if (b) return b;
      if (typeof Symbol !== "undefined" && Symbol.toPrimitive != null && typeof value[Symbol.toPrimitive] === "function") {
        return Buffer3.from(value[Symbol.toPrimitive]("string"), encodingOrOffset, length);
      }
      throw new TypeError(
        "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
      );
    }
    Buffer3.from = function(value, encodingOrOffset, length) {
      return from(value, encodingOrOffset, length);
    };
    Object.setPrototypeOf(Buffer3.prototype, Uint8Array.prototype);
    Object.setPrototypeOf(Buffer3, Uint8Array);
    function assertSize(size) {
      if (typeof size !== "number") {
        throw new TypeError('"size" argument must be of type number');
      } else if (size < 0) {
        throw new RangeError('The value "' + size + '" is invalid for option "size"');
      }
    }
    function alloc(size, fill, encoding) {
      assertSize(size);
      if (size <= 0) {
        return createBuffer(size);
      }
      if (fill !== void 0) {
        return typeof encoding === "string" ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill);
      }
      return createBuffer(size);
    }
    Buffer3.alloc = function(size, fill, encoding) {
      return alloc(size, fill, encoding);
    };
    function allocUnsafe(size) {
      assertSize(size);
      return createBuffer(size < 0 ? 0 : checked(size) | 0);
    }
    Buffer3.allocUnsafe = function(size) {
      return allocUnsafe(size);
    };
    Buffer3.allocUnsafeSlow = function(size) {
      return allocUnsafe(size);
    };
    function fromString(string, encoding) {
      if (typeof encoding !== "string" || encoding === "") {
        encoding = "utf8";
      }
      if (!Buffer3.isEncoding(encoding)) {
        throw new TypeError("Unknown encoding: " + encoding);
      }
      const length = byteLength(string, encoding) | 0;
      let buf = createBuffer(length);
      const actual = buf.write(string, encoding);
      if (actual !== length) {
        buf = buf.slice(0, actual);
      }
      return buf;
    }
    function fromArrayLike(array) {
      const length = array.length < 0 ? 0 : checked(array.length) | 0;
      const buf = createBuffer(length);
      for (let i = 0; i < length; i += 1) {
        buf[i] = array[i] & 255;
      }
      return buf;
    }
    function fromArrayView(arrayView) {
      if (isInstance(arrayView, Uint8Array)) {
        const copy = new Uint8Array(arrayView);
        return fromArrayBuffer(copy.buffer, copy.byteOffset, copy.byteLength);
      }
      return fromArrayLike(arrayView);
    }
    function fromArrayBuffer(array, byteOffset, length) {
      if (byteOffset < 0 || array.byteLength < byteOffset) {
        throw new RangeError('"offset" is outside of buffer bounds');
      }
      if (array.byteLength < byteOffset + (length || 0)) {
        throw new RangeError('"length" is outside of buffer bounds');
      }
      let buf;
      if (byteOffset === void 0 && length === void 0) {
        buf = new Uint8Array(array);
      } else if (length === void 0) {
        buf = new Uint8Array(array, byteOffset);
      } else {
        buf = new Uint8Array(array, byteOffset, length);
      }
      Object.setPrototypeOf(buf, Buffer3.prototype);
      return buf;
    }
    function fromObject(obj) {
      if (Buffer3.isBuffer(obj)) {
        const len = checked(obj.length) | 0;
        const buf = createBuffer(len);
        if (buf.length === 0) {
          return buf;
        }
        obj.copy(buf, 0, 0, len);
        return buf;
      }
      if (obj.length !== void 0) {
        if (typeof obj.length !== "number" || numberIsNaN(obj.length)) {
          return createBuffer(0);
        }
        return fromArrayLike(obj);
      }
      if (obj.type === "Buffer" && Array.isArray(obj.data)) {
        return fromArrayLike(obj.data);
      }
    }
    function checked(length) {
      if (length >= K_MAX_LENGTH) {
        throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + K_MAX_LENGTH.toString(16) + " bytes");
      }
      return length | 0;
    }
    function SlowBuffer(length) {
      if (+length != length) {
        length = 0;
      }
      return Buffer3.alloc(+length);
    }
    Buffer3.isBuffer = function isBuffer(b) {
      return b != null && b._isBuffer === true && b !== Buffer3.prototype;
    };
    Buffer3.compare = function compare(a, b) {
      if (isInstance(a, Uint8Array)) a = Buffer3.from(a, a.offset, a.byteLength);
      if (isInstance(b, Uint8Array)) b = Buffer3.from(b, b.offset, b.byteLength);
      if (!Buffer3.isBuffer(a) || !Buffer3.isBuffer(b)) {
        throw new TypeError(
          'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
        );
      }
      if (a === b) return 0;
      let x = a.length;
      let y = b.length;
      for (let i = 0, len = Math.min(x, y); i < len; ++i) {
        if (a[i] !== b[i]) {
          x = a[i];
          y = b[i];
          break;
        }
      }
      if (x < y) return -1;
      if (y < x) return 1;
      return 0;
    };
    Buffer3.isEncoding = function isEncoding(encoding) {
      switch (String(encoding).toLowerCase()) {
        case "hex":
        case "utf8":
        case "utf-8":
        case "ascii":
        case "latin1":
        case "binary":
        case "base64":
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return true;
        default:
          return false;
      }
    };
    Buffer3.concat = function concat(list, length) {
      if (!Array.isArray(list)) {
        throw new TypeError('"list" argument must be an Array of Buffers');
      }
      if (list.length === 0) {
        return Buffer3.alloc(0);
      }
      let i;
      if (length === void 0) {
        length = 0;
        for (i = 0; i < list.length; ++i) {
          length += list[i].length;
        }
      }
      const buffer = Buffer3.allocUnsafe(length);
      let pos = 0;
      for (i = 0; i < list.length; ++i) {
        let buf = list[i];
        if (isInstance(buf, Uint8Array)) {
          if (pos + buf.length > buffer.length) {
            if (!Buffer3.isBuffer(buf)) buf = Buffer3.from(buf);
            buf.copy(buffer, pos);
          } else {
            Uint8Array.prototype.set.call(
              buffer,
              buf,
              pos
            );
          }
        } else if (!Buffer3.isBuffer(buf)) {
          throw new TypeError('"list" argument must be an Array of Buffers');
        } else {
          buf.copy(buffer, pos);
        }
        pos += buf.length;
      }
      return buffer;
    };
    function byteLength(string, encoding) {
      if (Buffer3.isBuffer(string)) {
        return string.length;
      }
      if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
        return string.byteLength;
      }
      if (typeof string !== "string") {
        throw new TypeError(
          'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof string
        );
      }
      const len = string.length;
      const mustMatch = arguments.length > 2 && arguments[2] === true;
      if (!mustMatch && len === 0) return 0;
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "ascii":
          case "latin1":
          case "binary":
            return len;
          case "utf8":
          case "utf-8":
            return utf8ToBytes(string).length;
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return len * 2;
          case "hex":
            return len >>> 1;
          case "base64":
            return base64ToBytes(string).length;
          default:
            if (loweredCase) {
              return mustMatch ? -1 : utf8ToBytes(string).length;
            }
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer3.byteLength = byteLength;
    function slowToString(encoding, start, end) {
      let loweredCase = false;
      if (start === void 0 || start < 0) {
        start = 0;
      }
      if (start > this.length) {
        return "";
      }
      if (end === void 0 || end > this.length) {
        end = this.length;
      }
      if (end <= 0) {
        return "";
      }
      end >>>= 0;
      start >>>= 0;
      if (end <= start) {
        return "";
      }
      if (!encoding) encoding = "utf8";
      while (true) {
        switch (encoding) {
          case "hex":
            return hexSlice(this, start, end);
          case "utf8":
          case "utf-8":
            return utf8Slice(this, start, end);
          case "ascii":
            return asciiSlice(this, start, end);
          case "latin1":
          case "binary":
            return latin1Slice(this, start, end);
          case "base64":
            return base64Slice(this, start, end);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return utf16leSlice(this, start, end);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = (encoding + "").toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer3.prototype._isBuffer = true;
    function swap(b, n, m) {
      const i = b[n];
      b[n] = b[m];
      b[m] = i;
    }
    Buffer3.prototype.swap16 = function swap16() {
      const len = this.length;
      if (len % 2 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 16-bits");
      }
      for (let i = 0; i < len; i += 2) {
        swap(this, i, i + 1);
      }
      return this;
    };
    Buffer3.prototype.swap32 = function swap32() {
      const len = this.length;
      if (len % 4 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 32-bits");
      }
      for (let i = 0; i < len; i += 4) {
        swap(this, i, i + 3);
        swap(this, i + 1, i + 2);
      }
      return this;
    };
    Buffer3.prototype.swap64 = function swap64() {
      const len = this.length;
      if (len % 8 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 64-bits");
      }
      for (let i = 0; i < len; i += 8) {
        swap(this, i, i + 7);
        swap(this, i + 1, i + 6);
        swap(this, i + 2, i + 5);
        swap(this, i + 3, i + 4);
      }
      return this;
    };
    Buffer3.prototype.toString = function toString() {
      const length = this.length;
      if (length === 0) return "";
      if (arguments.length === 0) return utf8Slice(this, 0, length);
      return slowToString.apply(this, arguments);
    };
    Buffer3.prototype.toLocaleString = Buffer3.prototype.toString;
    Buffer3.prototype.equals = function equals(b) {
      if (!Buffer3.isBuffer(b)) throw new TypeError("Argument must be a Buffer");
      if (this === b) return true;
      return Buffer3.compare(this, b) === 0;
    };
    Buffer3.prototype.inspect = function inspect() {
      let str = "";
      const max = exports.INSPECT_MAX_BYTES;
      str = this.toString("hex", 0, max).replace(/(.{2})/g, "$1 ").trim();
      if (this.length > max) str += " ... ";
      return "<Buffer " + str + ">";
    };
    if (customInspectSymbol) {
      Buffer3.prototype[customInspectSymbol] = Buffer3.prototype.inspect;
    }
    Buffer3.prototype.compare = function compare(target, start, end, thisStart, thisEnd) {
      if (isInstance(target, Uint8Array)) {
        target = Buffer3.from(target, target.offset, target.byteLength);
      }
      if (!Buffer3.isBuffer(target)) {
        throw new TypeError(
          'The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof target
        );
      }
      if (start === void 0) {
        start = 0;
      }
      if (end === void 0) {
        end = target ? target.length : 0;
      }
      if (thisStart === void 0) {
        thisStart = 0;
      }
      if (thisEnd === void 0) {
        thisEnd = this.length;
      }
      if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
        throw new RangeError("out of range index");
      }
      if (thisStart >= thisEnd && start >= end) {
        return 0;
      }
      if (thisStart >= thisEnd) {
        return -1;
      }
      if (start >= end) {
        return 1;
      }
      start >>>= 0;
      end >>>= 0;
      thisStart >>>= 0;
      thisEnd >>>= 0;
      if (this === target) return 0;
      let x = thisEnd - thisStart;
      let y = end - start;
      const len = Math.min(x, y);
      const thisCopy = this.slice(thisStart, thisEnd);
      const targetCopy = target.slice(start, end);
      for (let i = 0; i < len; ++i) {
        if (thisCopy[i] !== targetCopy[i]) {
          x = thisCopy[i];
          y = targetCopy[i];
          break;
        }
      }
      if (x < y) return -1;
      if (y < x) return 1;
      return 0;
    };
    function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
      if (buffer.length === 0) return -1;
      if (typeof byteOffset === "string") {
        encoding = byteOffset;
        byteOffset = 0;
      } else if (byteOffset > 2147483647) {
        byteOffset = 2147483647;
      } else if (byteOffset < -2147483648) {
        byteOffset = -2147483648;
      }
      byteOffset = +byteOffset;
      if (numberIsNaN(byteOffset)) {
        byteOffset = dir ? 0 : buffer.length - 1;
      }
      if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
      if (byteOffset >= buffer.length) {
        if (dir) return -1;
        else byteOffset = buffer.length - 1;
      } else if (byteOffset < 0) {
        if (dir) byteOffset = 0;
        else return -1;
      }
      if (typeof val === "string") {
        val = Buffer3.from(val, encoding);
      }
      if (Buffer3.isBuffer(val)) {
        if (val.length === 0) {
          return -1;
        }
        return arrayIndexOf(buffer, val, byteOffset, encoding, dir);
      } else if (typeof val === "number") {
        val = val & 255;
        if (typeof Uint8Array.prototype.indexOf === "function") {
          if (dir) {
            return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset);
          } else {
            return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset);
          }
        }
        return arrayIndexOf(buffer, [val], byteOffset, encoding, dir);
      }
      throw new TypeError("val must be string, number or Buffer");
    }
    function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
      let indexSize = 1;
      let arrLength = arr.length;
      let valLength = val.length;
      if (encoding !== void 0) {
        encoding = String(encoding).toLowerCase();
        if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
          if (arr.length < 2 || val.length < 2) {
            return -1;
          }
          indexSize = 2;
          arrLength /= 2;
          valLength /= 2;
          byteOffset /= 2;
        }
      }
      function read(buf, i2) {
        if (indexSize === 1) {
          return buf[i2];
        } else {
          return buf.readUInt16BE(i2 * indexSize);
        }
      }
      let i;
      if (dir) {
        let foundIndex = -1;
        for (i = byteOffset; i < arrLength; i++) {
          if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
            if (foundIndex === -1) foundIndex = i;
            if (i - foundIndex + 1 === valLength) return foundIndex * indexSize;
          } else {
            if (foundIndex !== -1) i -= i - foundIndex;
            foundIndex = -1;
          }
        }
      } else {
        if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
        for (i = byteOffset; i >= 0; i--) {
          let found = true;
          for (let j = 0; j < valLength; j++) {
            if (read(arr, i + j) !== read(val, j)) {
              found = false;
              break;
            }
          }
          if (found) return i;
        }
      }
      return -1;
    }
    Buffer3.prototype.includes = function includes(val, byteOffset, encoding) {
      return this.indexOf(val, byteOffset, encoding) !== -1;
    };
    Buffer3.prototype.indexOf = function indexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, true);
    };
    Buffer3.prototype.lastIndexOf = function lastIndexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, false);
    };
    function hexWrite(buf, string, offset, length) {
      offset = Number(offset) || 0;
      const remaining = buf.length - offset;
      if (!length) {
        length = remaining;
      } else {
        length = Number(length);
        if (length > remaining) {
          length = remaining;
        }
      }
      const strLen = string.length;
      if (length > strLen / 2) {
        length = strLen / 2;
      }
      let i;
      for (i = 0; i < length; ++i) {
        const parsed = parseInt(string.substr(i * 2, 2), 16);
        if (numberIsNaN(parsed)) return i;
        buf[offset + i] = parsed;
      }
      return i;
    }
    function utf8Write(buf, string, offset, length) {
      return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
    }
    function asciiWrite(buf, string, offset, length) {
      return blitBuffer(asciiToBytes(string), buf, offset, length);
    }
    function base64Write(buf, string, offset, length) {
      return blitBuffer(base64ToBytes(string), buf, offset, length);
    }
    function ucs2Write(buf, string, offset, length) {
      return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
    }
    Buffer3.prototype.write = function write(string, offset, length, encoding) {
      if (offset === void 0) {
        encoding = "utf8";
        length = this.length;
        offset = 0;
      } else if (length === void 0 && typeof offset === "string") {
        encoding = offset;
        length = this.length;
        offset = 0;
      } else if (isFinite(offset)) {
        offset = offset >>> 0;
        if (isFinite(length)) {
          length = length >>> 0;
          if (encoding === void 0) encoding = "utf8";
        } else {
          encoding = length;
          length = void 0;
        }
      } else {
        throw new Error(
          "Buffer.write(string, encoding, offset[, length]) is no longer supported"
        );
      }
      const remaining = this.length - offset;
      if (length === void 0 || length > remaining) length = remaining;
      if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
        throw new RangeError("Attempt to write outside buffer bounds");
      }
      if (!encoding) encoding = "utf8";
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "hex":
            return hexWrite(this, string, offset, length);
          case "utf8":
          case "utf-8":
            return utf8Write(this, string, offset, length);
          case "ascii":
          case "latin1":
          case "binary":
            return asciiWrite(this, string, offset, length);
          case "base64":
            return base64Write(this, string, offset, length);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return ucs2Write(this, string, offset, length);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    };
    Buffer3.prototype.toJSON = function toJSON() {
      return {
        type: "Buffer",
        data: Array.prototype.slice.call(this._arr || this, 0)
      };
    };
    function base64Slice(buf, start, end) {
      if (start === 0 && end === buf.length) {
        return base64.fromByteArray(buf);
      } else {
        return base64.fromByteArray(buf.slice(start, end));
      }
    }
    function utf8Slice(buf, start, end) {
      end = Math.min(buf.length, end);
      const res = [];
      let i = start;
      while (i < end) {
        const firstByte = buf[i];
        let codePoint = null;
        let bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
        if (i + bytesPerSequence <= end) {
          let secondByte, thirdByte, fourthByte, tempCodePoint;
          switch (bytesPerSequence) {
            case 1:
              if (firstByte < 128) {
                codePoint = firstByte;
              }
              break;
            case 2:
              secondByte = buf[i + 1];
              if ((secondByte & 192) === 128) {
                tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                if (tempCodePoint > 127) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 3:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 4:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              fourthByte = buf[i + 3];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                  codePoint = tempCodePoint;
                }
              }
          }
        }
        if (codePoint === null) {
          codePoint = 65533;
          bytesPerSequence = 1;
        } else if (codePoint > 65535) {
          codePoint -= 65536;
          res.push(codePoint >>> 10 & 1023 | 55296);
          codePoint = 56320 | codePoint & 1023;
        }
        res.push(codePoint);
        i += bytesPerSequence;
      }
      return decodeCodePointsArray(res);
    }
    var MAX_ARGUMENTS_LENGTH = 4096;
    function decodeCodePointsArray(codePoints) {
      const len = codePoints.length;
      if (len <= MAX_ARGUMENTS_LENGTH) {
        return String.fromCharCode.apply(String, codePoints);
      }
      let res = "";
      let i = 0;
      while (i < len) {
        res += String.fromCharCode.apply(
          String,
          codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
        );
      }
      return res;
    }
    function asciiSlice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i] & 127);
      }
      return ret;
    }
    function latin1Slice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i]);
      }
      return ret;
    }
    function hexSlice(buf, start, end) {
      const len = buf.length;
      if (!start || start < 0) start = 0;
      if (!end || end < 0 || end > len) end = len;
      let out = "";
      for (let i = start; i < end; ++i) {
        out += hexSliceLookupTable[buf[i]];
      }
      return out;
    }
    function utf16leSlice(buf, start, end) {
      const bytes = buf.slice(start, end);
      let res = "";
      for (let i = 0; i < bytes.length - 1; i += 2) {
        res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
      }
      return res;
    }
    Buffer3.prototype.slice = function slice(start, end) {
      const len = this.length;
      start = ~~start;
      end = end === void 0 ? len : ~~end;
      if (start < 0) {
        start += len;
        if (start < 0) start = 0;
      } else if (start > len) {
        start = len;
      }
      if (end < 0) {
        end += len;
        if (end < 0) end = 0;
      } else if (end > len) {
        end = len;
      }
      if (end < start) end = start;
      const newBuf = this.subarray(start, end);
      Object.setPrototypeOf(newBuf, Buffer3.prototype);
      return newBuf;
    };
    function checkOffset(offset, ext, length) {
      if (offset % 1 !== 0 || offset < 0) throw new RangeError("offset is not uint");
      if (offset + ext > length) throw new RangeError("Trying to access beyond buffer length");
    }
    Buffer3.prototype.readUintLE = Buffer3.prototype.readUIntLE = function readUIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i = 0;
      while (++i < byteLength2 && (mul *= 256)) {
        val += this[offset + i] * mul;
      }
      return val;
    };
    Buffer3.prototype.readUintBE = Buffer3.prototype.readUIntBE = function readUIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        checkOffset(offset, byteLength2, this.length);
      }
      let val = this[offset + --byteLength2];
      let mul = 1;
      while (byteLength2 > 0 && (mul *= 256)) {
        val += this[offset + --byteLength2] * mul;
      }
      return val;
    };
    Buffer3.prototype.readUint8 = Buffer3.prototype.readUInt8 = function readUInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      return this[offset];
    };
    Buffer3.prototype.readUint16LE = Buffer3.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] | this[offset + 1] << 8;
    };
    Buffer3.prototype.readUint16BE = Buffer3.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] << 8 | this[offset + 1];
    };
    Buffer3.prototype.readUint32LE = Buffer3.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
    };
    Buffer3.prototype.readUint32BE = Buffer3.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
    };
    Buffer3.prototype.readBigUInt64LE = defineBigIntMethod(function readBigUInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const lo = first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24;
      const hi = this[++offset] + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + last * 2 ** 24;
      return BigInt(lo) + (BigInt(hi) << BigInt(32));
    });
    Buffer3.prototype.readBigUInt64BE = defineBigIntMethod(function readBigUInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const hi = first * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      const lo = this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last;
      return (BigInt(hi) << BigInt(32)) + BigInt(lo);
    });
    Buffer3.prototype.readIntLE = function readIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i = 0;
      while (++i < byteLength2 && (mul *= 256)) {
        val += this[offset + i] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    };
    Buffer3.prototype.readIntBE = function readIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let i = byteLength2;
      let mul = 1;
      let val = this[offset + --i];
      while (i > 0 && (mul *= 256)) {
        val += this[offset + --i] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    };
    Buffer3.prototype.readInt8 = function readInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      if (!(this[offset] & 128)) return this[offset];
      return (255 - this[offset] + 1) * -1;
    };
    Buffer3.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset] | this[offset + 1] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer3.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset + 1] | this[offset] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer3.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
    };
    Buffer3.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
    };
    Buffer3.prototype.readBigInt64LE = defineBigIntMethod(function readBigInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = this[offset + 4] + this[offset + 5] * 2 ** 8 + this[offset + 6] * 2 ** 16 + (last << 24);
      return (BigInt(val) << BigInt(32)) + BigInt(first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24);
    });
    Buffer3.prototype.readBigInt64BE = defineBigIntMethod(function readBigInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = (first << 24) + // Overflow
      this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      return (BigInt(val) << BigInt(32)) + BigInt(this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last);
    });
    Buffer3.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, true, 23, 4);
    };
    Buffer3.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, false, 23, 4);
    };
    Buffer3.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, true, 52, 8);
    };
    Buffer3.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, false, 52, 8);
    };
    function checkInt(buf, value, offset, ext, max, min) {
      if (!Buffer3.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
      if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
    }
    Buffer3.prototype.writeUintLE = Buffer3.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let mul = 1;
      let i = 0;
      this[offset] = value & 255;
      while (++i < byteLength2 && (mul *= 256)) {
        this[offset + i] = value / mul & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeUintBE = Buffer3.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let i = byteLength2 - 1;
      let mul = 1;
      this[offset + i] = value & 255;
      while (--i >= 0 && (mul *= 256)) {
        this[offset + i] = value / mul & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeUint8 = Buffer3.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 255, 0);
      this[offset] = value & 255;
      return offset + 1;
    };
    Buffer3.prototype.writeUint16LE = Buffer3.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    };
    Buffer3.prototype.writeUint16BE = Buffer3.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    };
    Buffer3.prototype.writeUint32LE = Buffer3.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset + 3] = value >>> 24;
      this[offset + 2] = value >>> 16;
      this[offset + 1] = value >>> 8;
      this[offset] = value & 255;
      return offset + 4;
    };
    Buffer3.prototype.writeUint32BE = Buffer3.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    };
    function wrtBigUInt64LE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      return offset;
    }
    function wrtBigUInt64BE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset + 7] = lo;
      lo = lo >> 8;
      buf[offset + 6] = lo;
      lo = lo >> 8;
      buf[offset + 5] = lo;
      lo = lo >> 8;
      buf[offset + 4] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset + 3] = hi;
      hi = hi >> 8;
      buf[offset + 2] = hi;
      hi = hi >> 8;
      buf[offset + 1] = hi;
      hi = hi >> 8;
      buf[offset] = hi;
      return offset + 8;
    }
    Buffer3.prototype.writeBigUInt64LE = defineBigIntMethod(function writeBigUInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer3.prototype.writeBigUInt64BE = defineBigIntMethod(function writeBigUInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer3.prototype.writeIntLE = function writeIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i = 0;
      let mul = 1;
      let sub = 0;
      this[offset] = value & 255;
      while (++i < byteLength2 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeIntBE = function writeIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i = byteLength2 - 1;
      let mul = 1;
      let sub = 0;
      this[offset + i] = value & 255;
      while (--i >= 0 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 127, -128);
      if (value < 0) value = 255 + value + 1;
      this[offset] = value & 255;
      return offset + 1;
    };
    Buffer3.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    };
    Buffer3.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    };
    Buffer3.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      this[offset + 2] = value >>> 16;
      this[offset + 3] = value >>> 24;
      return offset + 4;
    };
    Buffer3.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      if (value < 0) value = 4294967295 + value + 1;
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    };
    Buffer3.prototype.writeBigInt64LE = defineBigIntMethod(function writeBigInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    Buffer3.prototype.writeBigInt64BE = defineBigIntMethod(function writeBigInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    function checkIEEE754(buf, value, offset, ext, max, min) {
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
      if (offset < 0) throw new RangeError("Index out of range");
    }
    function writeFloat(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 4, 34028234663852886e22, -34028234663852886e22);
      }
      ieee754.write(buf, value, offset, littleEndian, 23, 4);
      return offset + 4;
    }
    Buffer3.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
      return writeFloat(this, value, offset, true, noAssert);
    };
    Buffer3.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
      return writeFloat(this, value, offset, false, noAssert);
    };
    function writeDouble(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 8, 17976931348623157e292, -17976931348623157e292);
      }
      ieee754.write(buf, value, offset, littleEndian, 52, 8);
      return offset + 8;
    }
    Buffer3.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
      return writeDouble(this, value, offset, true, noAssert);
    };
    Buffer3.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
      return writeDouble(this, value, offset, false, noAssert);
    };
    Buffer3.prototype.copy = function copy(target, targetStart, start, end) {
      if (!Buffer3.isBuffer(target)) throw new TypeError("argument should be a Buffer");
      if (!start) start = 0;
      if (!end && end !== 0) end = this.length;
      if (targetStart >= target.length) targetStart = target.length;
      if (!targetStart) targetStart = 0;
      if (end > 0 && end < start) end = start;
      if (end === start) return 0;
      if (target.length === 0 || this.length === 0) return 0;
      if (targetStart < 0) {
        throw new RangeError("targetStart out of bounds");
      }
      if (start < 0 || start >= this.length) throw new RangeError("Index out of range");
      if (end < 0) throw new RangeError("sourceEnd out of bounds");
      if (end > this.length) end = this.length;
      if (target.length - targetStart < end - start) {
        end = target.length - targetStart + start;
      }
      const len = end - start;
      if (this === target && typeof Uint8Array.prototype.copyWithin === "function") {
        this.copyWithin(targetStart, start, end);
      } else {
        Uint8Array.prototype.set.call(
          target,
          this.subarray(start, end),
          targetStart
        );
      }
      return len;
    };
    Buffer3.prototype.fill = function fill(val, start, end, encoding) {
      if (typeof val === "string") {
        if (typeof start === "string") {
          encoding = start;
          start = 0;
          end = this.length;
        } else if (typeof end === "string") {
          encoding = end;
          end = this.length;
        }
        if (encoding !== void 0 && typeof encoding !== "string") {
          throw new TypeError("encoding must be a string");
        }
        if (typeof encoding === "string" && !Buffer3.isEncoding(encoding)) {
          throw new TypeError("Unknown encoding: " + encoding);
        }
        if (val.length === 1) {
          const code = val.charCodeAt(0);
          if (encoding === "utf8" && code < 128 || encoding === "latin1") {
            val = code;
          }
        }
      } else if (typeof val === "number") {
        val = val & 255;
      } else if (typeof val === "boolean") {
        val = Number(val);
      }
      if (start < 0 || this.length < start || this.length < end) {
        throw new RangeError("Out of range index");
      }
      if (end <= start) {
        return this;
      }
      start = start >>> 0;
      end = end === void 0 ? this.length : end >>> 0;
      if (!val) val = 0;
      let i;
      if (typeof val === "number") {
        for (i = start; i < end; ++i) {
          this[i] = val;
        }
      } else {
        const bytes = Buffer3.isBuffer(val) ? val : Buffer3.from(val, encoding);
        const len = bytes.length;
        if (len === 0) {
          throw new TypeError('The value "' + val + '" is invalid for argument "value"');
        }
        for (i = 0; i < end - start; ++i) {
          this[i + start] = bytes[i % len];
        }
      }
      return this;
    };
    var errors = {};
    function E(sym, getMessage, Base) {
      errors[sym] = class NodeError extends Base {
        constructor() {
          super();
          Object.defineProperty(this, "message", {
            value: getMessage.apply(this, arguments),
            writable: true,
            configurable: true
          });
          this.name = `${this.name} [${sym}]`;
          this.stack;
          delete this.name;
        }
        get code() {
          return sym;
        }
        set code(value) {
          Object.defineProperty(this, "code", {
            configurable: true,
            enumerable: true,
            value,
            writable: true
          });
        }
        toString() {
          return `${this.name} [${sym}]: ${this.message}`;
        }
      };
    }
    E(
      "ERR_BUFFER_OUT_OF_BOUNDS",
      function(name) {
        if (name) {
          return `${name} is outside of buffer bounds`;
        }
        return "Attempt to access memory outside buffer bounds";
      },
      RangeError
    );
    E(
      "ERR_INVALID_ARG_TYPE",
      function(name, actual) {
        return `The "${name}" argument must be of type number. Received type ${typeof actual}`;
      },
      TypeError
    );
    E(
      "ERR_OUT_OF_RANGE",
      function(str, range, input) {
        let msg = `The value of "${str}" is out of range.`;
        let received = input;
        if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
          received = addNumericalSeparator(String(input));
        } else if (typeof input === "bigint") {
          received = String(input);
          if (input > BigInt(2) ** BigInt(32) || input < -(BigInt(2) ** BigInt(32))) {
            received = addNumericalSeparator(received);
          }
          received += "n";
        }
        msg += ` It must be ${range}. Received ${received}`;
        return msg;
      },
      RangeError
    );
    function addNumericalSeparator(val) {
      let res = "";
      let i = val.length;
      const start = val[0] === "-" ? 1 : 0;
      for (; i >= start + 4; i -= 3) {
        res = `_${val.slice(i - 3, i)}${res}`;
      }
      return `${val.slice(0, i)}${res}`;
    }
    function checkBounds(buf, offset, byteLength2) {
      validateNumber(offset, "offset");
      if (buf[offset] === void 0 || buf[offset + byteLength2] === void 0) {
        boundsError(offset, buf.length - (byteLength2 + 1));
      }
    }
    function checkIntBI(value, min, max, buf, offset, byteLength2) {
      if (value > max || value < min) {
        const n = typeof min === "bigint" ? "n" : "";
        let range;
        if (byteLength2 > 3) {
          if (min === 0 || min === BigInt(0)) {
            range = `>= 0${n} and < 2${n} ** ${(byteLength2 + 1) * 8}${n}`;
          } else {
            range = `>= -(2${n} ** ${(byteLength2 + 1) * 8 - 1}${n}) and < 2 ** ${(byteLength2 + 1) * 8 - 1}${n}`;
          }
        } else {
          range = `>= ${min}${n} and <= ${max}${n}`;
        }
        throw new errors.ERR_OUT_OF_RANGE("value", range, value);
      }
      checkBounds(buf, offset, byteLength2);
    }
    function validateNumber(value, name) {
      if (typeof value !== "number") {
        throw new errors.ERR_INVALID_ARG_TYPE(name, "number", value);
      }
    }
    function boundsError(value, length, type) {
      if (Math.floor(value) !== value) {
        validateNumber(value, type);
        throw new errors.ERR_OUT_OF_RANGE(type || "offset", "an integer", value);
      }
      if (length < 0) {
        throw new errors.ERR_BUFFER_OUT_OF_BOUNDS();
      }
      throw new errors.ERR_OUT_OF_RANGE(
        type || "offset",
        `>= ${type ? 1 : 0} and <= ${length}`,
        value
      );
    }
    var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g;
    function base64clean(str) {
      str = str.split("=")[0];
      str = str.trim().replace(INVALID_BASE64_RE, "");
      if (str.length < 2) return "";
      while (str.length % 4 !== 0) {
        str = str + "=";
      }
      return str;
    }
    function utf8ToBytes(string, units) {
      units = units || Infinity;
      let codePoint;
      const length = string.length;
      let leadSurrogate = null;
      const bytes = [];
      for (let i = 0; i < length; ++i) {
        codePoint = string.charCodeAt(i);
        if (codePoint > 55295 && codePoint < 57344) {
          if (!leadSurrogate) {
            if (codePoint > 56319) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            } else if (i + 1 === length) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            }
            leadSurrogate = codePoint;
            continue;
          }
          if (codePoint < 56320) {
            if ((units -= 3) > -1) bytes.push(239, 191, 189);
            leadSurrogate = codePoint;
            continue;
          }
          codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
        } else if (leadSurrogate) {
          if ((units -= 3) > -1) bytes.push(239, 191, 189);
        }
        leadSurrogate = null;
        if (codePoint < 128) {
          if ((units -= 1) < 0) break;
          bytes.push(codePoint);
        } else if (codePoint < 2048) {
          if ((units -= 2) < 0) break;
          bytes.push(
            codePoint >> 6 | 192,
            codePoint & 63 | 128
          );
        } else if (codePoint < 65536) {
          if ((units -= 3) < 0) break;
          bytes.push(
            codePoint >> 12 | 224,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else if (codePoint < 1114112) {
          if ((units -= 4) < 0) break;
          bytes.push(
            codePoint >> 18 | 240,
            codePoint >> 12 & 63 | 128,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else {
          throw new Error("Invalid code point");
        }
      }
      return bytes;
    }
    function asciiToBytes(str) {
      const byteArray = [];
      for (let i = 0; i < str.length; ++i) {
        byteArray.push(str.charCodeAt(i) & 255);
      }
      return byteArray;
    }
    function utf16leToBytes(str, units) {
      let c, hi, lo;
      const byteArray = [];
      for (let i = 0; i < str.length; ++i) {
        if ((units -= 2) < 0) break;
        c = str.charCodeAt(i);
        hi = c >> 8;
        lo = c % 256;
        byteArray.push(lo);
        byteArray.push(hi);
      }
      return byteArray;
    }
    function base64ToBytes(str) {
      return base64.toByteArray(base64clean(str));
    }
    function blitBuffer(src, dst, offset, length) {
      let i;
      for (i = 0; i < length; ++i) {
        if (i + offset >= dst.length || i >= src.length) break;
        dst[i + offset] = src[i];
      }
      return i;
    }
    function isInstance(obj, type) {
      return obj instanceof type || obj != null && obj.constructor != null && obj.constructor.name != null && obj.constructor.name === type.name;
    }
    function numberIsNaN(obj) {
      return obj !== obj;
    }
    var hexSliceLookupTable = (function() {
      const alphabet = "0123456789abcdef";
      const table = new Array(256);
      for (let i = 0; i < 16; ++i) {
        const i16 = i * 16;
        for (let j = 0; j < 16; ++j) {
          table[i16 + j] = alphabet[i] + alphabet[j];
        }
      }
      return table;
    })();
    function defineBigIntMethod(fn) {
      return typeof BigInt === "undefined" ? BufferBigIntNotDefined : fn;
    }
    function BufferBigIntNotDefined() {
      throw new Error("BigInt not supported");
    }
  }
});

// node_modules/symbol.inspect/index.js
var require_symbol = __commonJS({
  "node_modules/symbol.inspect/index.js"(exports, module) {
    "use strict";
    var SymbolInspect = /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom");
    module.exports = SymbolInspect;
  }
});

// node_modules/@ton/core/dist/utils/crc16.js
var require_crc16 = __commonJS({
  "node_modules/@ton/core/dist/utils/crc16.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.crc16 = void 0;
    function crc16(data) {
      const poly = 4129;
      let reg = 0;
      const message = Buffer.alloc(data.length + 2);
      message.set(data);
      for (let byte of message) {
        let mask = 128;
        while (mask > 0) {
          reg <<= 1;
          if (byte & mask) {
            reg += 1;
          }
          mask >>= 1;
          if (reg > 65535) {
            reg &= 65535;
            reg ^= poly;
          }
        }
      }
      return Buffer.from([Math.floor(reg / 256), reg % 256]);
    }
    exports.crc16 = crc16;
  }
});

// node_modules/@ton/core/dist/address/Address.js
var require_Address = __commonJS({
  "node_modules/@ton/core/dist/address/Address.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    var _a;
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.address = exports.Address = void 0;
    var symbol_inspect_1 = __importDefault(require_symbol());
    var crc16_1 = require_crc16();
    var bounceable_tag = 17;
    var non_bounceable_tag = 81;
    var test_flag = 128;
    function parseFriendlyAddress(src) {
      if (typeof src === "string" && !Address2.isFriendly(src)) {
        throw new Error("Unknown address type");
      }
      const data = Buffer.isBuffer(src) ? src : Buffer.from(src, "base64");
      if (data.length !== 36) {
        throw new Error("Unknown address type: byte length is not equal to 36");
      }
      const addr = data.subarray(0, 34);
      const crc = data.subarray(34, 36);
      const calcedCrc = (0, crc16_1.crc16)(addr);
      if (!(calcedCrc[0] === crc[0] && calcedCrc[1] === crc[1])) {
        throw new Error("Invalid checksum: " + src);
      }
      let tag = addr[0];
      let isTestOnly = false;
      let isBounceable = false;
      if (tag & test_flag) {
        isTestOnly = true;
        tag = tag ^ test_flag;
      }
      if (tag !== bounceable_tag && tag !== non_bounceable_tag)
        throw "Unknown address tag";
      isBounceable = tag === bounceable_tag;
      let workchain = null;
      if (addr[1] === 255) {
        workchain = -1;
      } else {
        workchain = addr[1];
      }
      const hashPart = addr.subarray(2, 34);
      return { isTestOnly, isBounceable, workchain, hashPart };
    }
    var Address2 = class _Address {
      static isAddress(src) {
        return src instanceof _Address;
      }
      static isFriendly(source) {
        if (source.length !== 48) {
          return false;
        }
        if (!/[A-Za-z0-9+/_-]+/.test(source)) {
          return false;
        }
        return true;
      }
      static isRaw(source) {
        if (source.indexOf(":") === -1) {
          return false;
        }
        let [wc, hash] = source.split(":");
        if (!Number.isInteger(parseFloat(wc))) {
          return false;
        }
        if (!/[a-f0-9]+/.test(hash.toLowerCase())) {
          return false;
        }
        if (hash.length !== 64) {
          return false;
        }
        return true;
      }
      static normalize(source) {
        if (typeof source === "string") {
          return _Address.parse(source).toString();
        } else {
          return source.toString();
        }
      }
      static parse(source) {
        if (_Address.isFriendly(source)) {
          return this.parseFriendly(source).address;
        } else if (_Address.isRaw(source)) {
          return this.parseRaw(source);
        } else {
          throw new Error("Unknown address type: " + source);
        }
      }
      static parseRaw(source) {
        let workChain = parseInt(source.split(":")[0]);
        let hash = Buffer.from(source.split(":")[1], "hex");
        return new _Address(workChain, hash);
      }
      static parseFriendly(source) {
        if (Buffer.isBuffer(source)) {
          let r = parseFriendlyAddress(source);
          return {
            isBounceable: r.isBounceable,
            isTestOnly: r.isTestOnly,
            address: new _Address(r.workchain, r.hashPart)
          };
        } else {
          let addr = source.replace(/\-/g, "+").replace(/_/g, "/");
          let r = parseFriendlyAddress(addr);
          return {
            isBounceable: r.isBounceable,
            isTestOnly: r.isTestOnly,
            address: new _Address(r.workchain, r.hashPart)
          };
        }
      }
      constructor(workChain, hash) {
        this.toRawString = () => {
          return this.workChain + ":" + this.hash.toString("hex");
        };
        this.toRaw = () => {
          const addressWithChecksum = Buffer.alloc(36);
          addressWithChecksum.set(this.hash);
          addressWithChecksum.set([this.workChain, this.workChain, this.workChain, this.workChain], 32);
          return addressWithChecksum;
        };
        this.toStringBuffer = (args) => {
          let testOnly = args && args.testOnly !== void 0 ? args.testOnly : false;
          let bounceable = args && args.bounceable !== void 0 ? args.bounceable : true;
          let tag = bounceable ? bounceable_tag : non_bounceable_tag;
          if (testOnly) {
            tag |= test_flag;
          }
          const addr = Buffer.alloc(34);
          addr[0] = tag;
          addr[1] = this.workChain;
          addr.set(this.hash, 2);
          const addressWithChecksum = Buffer.alloc(36);
          addressWithChecksum.set(addr);
          addressWithChecksum.set((0, crc16_1.crc16)(addr), 34);
          return addressWithChecksum;
        };
        this.toString = (args) => {
          let urlSafe = args && args.urlSafe !== void 0 ? args.urlSafe : true;
          let buffer = this.toStringBuffer(args);
          if (urlSafe) {
            return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
          } else {
            return buffer.toString("base64");
          }
        };
        this[_a] = () => this.toString();
        if (hash.length !== 32) {
          throw new Error("Invalid address hash length: " + hash.length);
        }
        this.workChain = workChain;
        this.hash = hash;
        Object.freeze(this);
      }
      equals(src) {
        if (src.workChain !== this.workChain) {
          return false;
        }
        return src.hash.equals(this.hash);
      }
    };
    exports.Address = Address2;
    _a = symbol_inspect_1.default;
    function address(src) {
      return Address2.parse(src);
    }
    exports.address = address;
  }
});

// node_modules/@ton/core/dist/address/ExternalAddress.js
var require_ExternalAddress = __commonJS({
  "node_modules/@ton/core/dist/address/ExternalAddress.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    var _a;
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ExternalAddress = void 0;
    var symbol_inspect_1 = __importDefault(require_symbol());
    var ExternalAddress = class _ExternalAddress {
      static isAddress(src) {
        return src instanceof _ExternalAddress;
      }
      constructor(value, bits) {
        this[_a] = () => this.toString();
        this.value = value;
        this.bits = bits;
      }
      toString() {
        return `External<${this.bits}:${this.value}>`;
      }
    };
    exports.ExternalAddress = ExternalAddress;
    _a = symbol_inspect_1.default;
  }
});

// node_modules/@ton/core/dist/utils/base32.js
var require_base32 = __commonJS({
  "node_modules/@ton/core/dist/utils/base32.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.base32Decode = exports.base32Encode = void 0;
    var alphabet = "abcdefghijklmnopqrstuvwxyz234567";
    function base32Encode(buffer) {
      const length = buffer.byteLength;
      let bits = 0;
      let value = 0;
      let output = "";
      for (let i = 0; i < length; i++) {
        value = value << 8 | buffer[i];
        bits += 8;
        while (bits >= 5) {
          output += alphabet[value >>> bits - 5 & 31];
          bits -= 5;
        }
      }
      if (bits > 0) {
        output += alphabet[value << 5 - bits & 31];
      }
      return output;
    }
    exports.base32Encode = base32Encode;
    function readChar(alphabet2, char) {
      const idx = alphabet2.indexOf(char);
      if (idx === -1) {
        throw new Error("Invalid character found: " + char);
      }
      return idx;
    }
    function base32Decode(input) {
      let cleanedInput;
      cleanedInput = input.toLowerCase();
      const { length } = cleanedInput;
      let bits = 0;
      let value = 0;
      let index = 0;
      const output = Buffer.alloc(length * 5 / 8 | 0);
      for (let i = 0; i < length; i++) {
        value = value << 5 | readChar(alphabet, cleanedInput[i]);
        bits += 5;
        if (bits >= 8) {
          output[index++] = value >>> bits - 8 & 255;
          bits -= 8;
        }
      }
      return output;
    }
    exports.base32Decode = base32Decode;
  }
});

// node_modules/@ton/core/dist/address/ADNLAddress.js
var require_ADNLAddress = __commonJS({
  "node_modules/@ton/core/dist/address/ADNLAddress.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    var _a;
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ADNLAddress = void 0;
    var symbol_inspect_1 = __importDefault(require_symbol());
    var base32_1 = require_base32();
    var crc16_1 = require_crc16();
    var ADNLAddress = class _ADNLAddress {
      static parseFriendly(src) {
        if (src.length !== 55) {
          throw Error("Invalid address");
        }
        src = "f" + src;
        let decoded = (0, base32_1.base32Decode)(src);
        if (decoded[0] !== 45) {
          throw Error("Invalid address");
        }
        let gotHash = decoded.slice(33);
        let hash = (0, crc16_1.crc16)(decoded.slice(0, 33));
        if (!hash.equals(gotHash)) {
          throw Error("Invalid address");
        }
        return new _ADNLAddress(decoded.slice(1, 33));
      }
      static parseRaw(src) {
        const data = Buffer.from(src, "base64");
        return new _ADNLAddress(data);
      }
      constructor(address) {
        this.toRaw = () => {
          return this.address.toString("hex").toUpperCase();
        };
        this.toString = () => {
          let data = Buffer.concat([Buffer.from([45]), this.address]);
          let hash = (0, crc16_1.crc16)(data);
          data = Buffer.concat([data, hash]);
          return (0, base32_1.base32Encode)(data).slice(1);
        };
        this[_a] = () => this.toString();
        if (address.length !== 32) {
          throw Error("Invalid address");
        }
        this.address = address;
      }
      equals(b) {
        return this.address.equals(b.address);
      }
    };
    exports.ADNLAddress = ADNLAddress;
    _a = symbol_inspect_1.default;
  }
});

// node_modules/@ton/core/dist/boc/utils/paddedBits.js
var require_paddedBits = __commonJS({
  "node_modules/@ton/core/dist/boc/utils/paddedBits.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.paddedBufferToBits = exports.bitsToPaddedBuffer = void 0;
    var BitBuilder_1 = require_BitBuilder();
    var BitString_1 = require_BitString();
    function bitsToPaddedBuffer(bits) {
      let builder = new BitBuilder_1.BitBuilder(Math.ceil(bits.length / 8) * 8);
      builder.writeBits(bits);
      let padding = Math.ceil(bits.length / 8) * 8 - bits.length;
      for (let i = 0; i < padding; i++) {
        if (i === 0) {
          builder.writeBit(1);
        } else {
          builder.writeBit(0);
        }
      }
      return builder.buffer();
    }
    exports.bitsToPaddedBuffer = bitsToPaddedBuffer;
    function paddedBufferToBits(buff) {
      let bitLen = 0;
      for (let i = buff.length - 1; i >= 0; i--) {
        if (buff[i] !== 0) {
          const testByte = buff[i];
          let bitPos = testByte & -testByte;
          if ((bitPos & 1) == 0) {
            bitPos = Math.log2(bitPos) + 1;
          }
          if (i > 0) {
            bitLen = i << 3;
          }
          bitLen += 8 - bitPos;
          break;
        }
      }
      return new BitString_1.BitString(buff, 0, bitLen);
    }
    exports.paddedBufferToBits = paddedBufferToBits;
  }
});

// node_modules/@ton/core/dist/boc/BitString.js
var require_BitString = __commonJS({
  "node_modules/@ton/core/dist/boc/BitString.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    var _a;
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.BitString = void 0;
    var paddedBits_1 = require_paddedBits();
    var symbol_inspect_1 = __importDefault(require_symbol());
    var BitString2 = class _BitString {
      /**
       * Checks if supplied object is BitString
       * @param src is unknow object
       * @returns true if object is BitString and false otherwise
       **/
      static isBitString(src) {
        return src instanceof _BitString;
      }
      /**
       * Constructing BitString from a buffer
       * @param data data that contains the bitstring data. NOTE: We are expecting this buffer to be NOT modified
       * @param offset offset in bits from the start of the buffer
       * @param length length of the bitstring in bits
       */
      constructor(data, offset, length) {
        this[_a] = () => this.toString();
        if (length < 0) {
          throw new Error(`Length ${length} is out of bounds`);
        }
        this._length = length;
        this._data = data;
        this._offset = offset;
      }
      /**
       * Returns the length of the bitstring
       */
      get length() {
        return this._length;
      }
      /**
       * Returns the bit at the specified index
       * @param index index of the bit
       * @throws Error if index is out of bounds
       * @returns true if the bit is set, false otherwise
       */
      at(index) {
        if (index >= this._length) {
          throw new Error(`Index ${index} > ${this._length} is out of bounds`);
        }
        if (index < 0) {
          throw new Error(`Index ${index} < 0 is out of bounds`);
        }
        let byteIndex = this._offset + index >> 3;
        let bitIndex = 7 - (this._offset + index) % 8;
        return (this._data[byteIndex] & 1 << bitIndex) !== 0;
      }
      /**
       * Get a subscring of the bitstring
       * @param offset
       * @param length
       * @returns
       */
      substring(offset, length) {
        if (offset > this._length) {
          throw new Error(`Offset(${offset}) > ${this._length} is out of bounds`);
        }
        if (offset < 0) {
          throw new Error(`Offset(${offset}) < 0 is out of bounds`);
        }
        if (length === 0) {
          return _BitString.EMPTY;
        }
        if (offset + length > this._length) {
          throw new Error(`Offset ${offset} + Length ${length} > ${this._length} is out of bounds`);
        }
        return new _BitString(this._data, this._offset + offset, length);
      }
      /**
       * Try to get a buffer from the bitstring without allocations
       * @param offset offset in bits
       * @param length length in bits
       * @returns buffer if the bitstring is aligned to bytes, null otherwise
       */
      subbuffer(offset, length) {
        if (offset > this._length) {
          throw new Error(`Offset ${offset} is out of bounds`);
        }
        if (offset < 0) {
          throw new Error(`Offset ${offset} is out of bounds`);
        }
        if (offset + length > this._length) {
          throw new Error(`Offset + Lenght = ${offset + length} is out of bounds`);
        }
        if (length % 8 !== 0) {
          return null;
        }
        if ((this._offset + offset) % 8 !== 0) {
          return null;
        }
        let start = this._offset + offset >> 3;
        let end = start + (length >> 3);
        return this._data.subarray(start, end);
      }
      /**
       * Checks for equality
       * @param b other bitstring
       * @returns true if the bitstrings are equal, false otherwise
       */
      equals(b) {
        if (this._length !== b._length) {
          return false;
        }
        for (let i = 0; i < this._length; i++) {
          if (this.at(i) !== b.at(i)) {
            return false;
          }
        }
        return true;
      }
      /**
       * Format to canonical string
       * @returns formatted bits as a string
       */
      toString() {
        const padded = (0, paddedBits_1.bitsToPaddedBuffer)(this);
        if (this._length % 4 === 0) {
          const s = padded.subarray(0, Math.ceil(this._length / 8)).toString("hex").toUpperCase();
          if (this._length % 8 === 0) {
            return s;
          } else {
            return s.substring(0, s.length - 1);
          }
        } else {
          const hex = padded.toString("hex").toUpperCase();
          if (this._length % 8 <= 4) {
            return hex.substring(0, hex.length - 1) + "_";
          } else {
            return hex + "_";
          }
        }
      }
    };
    exports.BitString = BitString2;
    _a = symbol_inspect_1.default;
    BitString2.EMPTY = new BitString2(Buffer.alloc(0), 0, 0);
  }
});

// node_modules/@ton/core/dist/boc/BitBuilder.js
var require_BitBuilder = __commonJS({
  "node_modules/@ton/core/dist/boc/BitBuilder.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.BitBuilder = void 0;
    var Address_1 = require_Address();
    var ExternalAddress_1 = require_ExternalAddress();
    var BitString_1 = require_BitString();
    var BitBuilder = class {
      constructor(size = 1023) {
        this._buffer = Buffer.alloc(Math.ceil(size / 8));
        this._length = 0;
      }
      /**
       * Current number of bits written
       */
      get length() {
        return this._length;
      }
      /**
       * Write a single bit
       * @param value bit to write, true or positive number for 1, false or zero or negative for 0
       */
      writeBit(value) {
        let n = this._length;
        if (n > this._buffer.length * 8) {
          throw new Error("BitBuilder overflow");
        }
        if (typeof value === "boolean" && value === true || typeof value === "number" && value > 0) {
          this._buffer[n / 8 | 0] |= 1 << 7 - n % 8;
        }
        this._length++;
      }
      /**
       * Copy bits from BitString
       * @param src source bits
       */
      writeBits(src) {
        for (let i = 0; i < src.length; i++) {
          this.writeBit(src.at(i));
        }
      }
      /**
       * Write bits from buffer
       * @param src source buffer
       */
      writeBuffer(src) {
        if (this._length % 8 === 0) {
          if (this._length + src.length * 8 > this._buffer.length * 8) {
            throw new Error("BitBuilder overflow");
          }
          src.copy(this._buffer, this._length / 8);
          this._length += src.length * 8;
        } else {
          for (let i = 0; i < src.length; i++) {
            this.writeUint(src[i], 8);
          }
        }
      }
      /**
       * Write uint value
       * @param value value as bigint or number
       * @param bits number of bits to write
       */
      writeUint(value, bits) {
        if (bits < 0 || !Number.isSafeInteger(bits)) {
          throw Error(`invalid bit length. Got ${bits}`);
        }
        const v = BigInt(value);
        if (bits === 0) {
          if (v !== 0n) {
            throw Error(`value is not zero for ${bits} bits. Got ${value}`);
          } else {
            return;
          }
        }
        const vBits = 1n << BigInt(bits);
        if (v < 0 || v >= vBits) {
          throw Error(`bitLength is too small for a value ${value}. Got ${bits}`);
        }
        if (this._length + bits > this._buffer.length * 8) {
          throw new Error("BitBuilder overflow");
        }
        const tillByte = 8 - this._length % 8;
        if (tillByte > 0) {
          const bidx = Math.floor(this._length / 8);
          if (bits < tillByte) {
            const wb = Number(v);
            this._buffer[bidx] |= wb << tillByte - bits;
            this._length += bits;
          } else {
            const wb = Number(v >> BigInt(bits - tillByte));
            this._buffer[bidx] |= wb;
            this._length += tillByte;
          }
        }
        bits -= tillByte;
        while (bits > 0) {
          if (bits >= 8) {
            this._buffer[this._length / 8] = Number(v >> BigInt(bits - 8) & 0xffn);
            this._length += 8;
            bits -= 8;
          } else {
            this._buffer[this._length / 8] = Number(v << BigInt(8 - bits) & 0xffn);
            this._length += bits;
            bits = 0;
          }
        }
      }
      /**
       * Write int value
       * @param value value as bigint or number
       * @param bits number of bits to write
       */
      writeInt(value, bits) {
        let v = BigInt(value);
        if (bits < 0 || !Number.isSafeInteger(bits)) {
          throw Error(`invalid bit length. Got ${bits}`);
        }
        if (bits === 0) {
          if (value !== 0n) {
            throw Error(`value is not zero for ${bits} bits. Got ${value}`);
          } else {
            return;
          }
        }
        if (bits === 1) {
          if (value !== -1n && value !== 0n) {
            throw Error(`value is not zero or -1 for ${bits} bits. Got ${value}`);
          } else {
            this.writeBit(value === -1n);
            return;
          }
        }
        let vBits = 1n << BigInt(bits) - 1n;
        if (v < -vBits || v >= vBits) {
          throw Error(`value is out of range for ${bits} bits. Got ${value}`);
        }
        if (v < 0) {
          this.writeBit(true);
          v = vBits + v;
        } else {
          this.writeBit(false);
        }
        this.writeUint(v, bits - 1);
      }
      /**
       * Wrtie var uint value, used for serializing coins
       * @param value value to write as bigint or number
       * @param bits header bits to write size
       */
      writeVarUint(value, bits) {
        let v = BigInt(value);
        if (bits < 0 || !Number.isSafeInteger(bits)) {
          throw Error(`invalid bit length. Got ${bits}`);
        }
        if (v < 0) {
          throw Error(`value is negative. Got ${value}`);
        }
        if (v === 0n) {
          this.writeUint(0, bits);
          return;
        }
        const sizeBytes = Math.ceil(v.toString(2).length / 8);
        const sizeBits = sizeBytes * 8;
        this.writeUint(sizeBytes, bits);
        this.writeUint(v, sizeBits);
      }
      /**
       * Wrtie var int value, used for serializing coins
       * @param value value to write as bigint or number
       * @param bits header bits to write size
       */
      writeVarInt(value, bits) {
        let v = BigInt(value);
        if (bits < 0 || !Number.isSafeInteger(bits)) {
          throw Error(`invalid bit length. Got ${bits}`);
        }
        if (v === 0n) {
          this.writeUint(0, bits);
          return;
        }
        let v2 = v > 0 ? v : -v;
        const sizeBytes = Math.ceil((v2.toString(2).length + 1) / 8);
        const sizeBits = sizeBytes * 8;
        this.writeUint(sizeBytes, bits);
        this.writeInt(v, sizeBits);
      }
      /**
       * Write coins in var uint format
       * @param amount amount to write
       */
      writeCoins(amount) {
        this.writeVarUint(amount, 4);
      }
      /**
       * Write address
       * @param address write address or address external
       */
      writeAddress(address) {
        if (address === null || address === void 0) {
          this.writeUint(0, 2);
          return;
        }
        if (Address_1.Address.isAddress(address)) {
          this.writeUint(2, 2);
          this.writeUint(0, 1);
          this.writeInt(address.workChain, 8);
          this.writeBuffer(address.hash);
          return;
        }
        if (ExternalAddress_1.ExternalAddress.isAddress(address)) {
          this.writeUint(1, 2);
          this.writeUint(address.bits, 9);
          this.writeUint(address.value, address.bits);
          return;
        }
        throw Error(`Invalid address. Got ${address}`);
      }
      /**
       * Build BitString
       * @returns result bit string
       */
      build() {
        return new BitString_1.BitString(this._buffer, 0, this._length);
      }
      /**
       * Build into Buffer
       * @returns result buffer
       */
      buffer() {
        if (this._length % 8 !== 0) {
          throw new Error("BitBuilder buffer is not byte aligned");
        }
        return this._buffer.subarray(0, this._length / 8);
      }
    };
    exports.BitBuilder = BitBuilder;
  }
});

// node_modules/@ton/core/dist/boc/CellType.js
var require_CellType = __commonJS({
  "node_modules/@ton/core/dist/boc/CellType.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CellType = void 0;
    var CellType;
    (function(CellType2) {
      CellType2[CellType2["Ordinary"] = -1] = "Ordinary";
      CellType2[CellType2["PrunedBranch"] = 1] = "PrunedBranch";
      CellType2[CellType2["Library"] = 2] = "Library";
      CellType2[CellType2["MerkleProof"] = 3] = "MerkleProof";
      CellType2[CellType2["MerkleUpdate"] = 4] = "MerkleUpdate";
    })(CellType || (exports.CellType = CellType = {}));
  }
});

// node_modules/@ton/core/dist/dict/utils/readUnaryLength.js
var require_readUnaryLength = __commonJS({
  "node_modules/@ton/core/dist/dict/utils/readUnaryLength.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.readUnaryLength = void 0;
    function readUnaryLength(slice) {
      let res = 0;
      while (slice.loadBit()) {
        res++;
      }
      return res;
    }
    exports.readUnaryLength = readUnaryLength;
  }
});

// node_modules/@ton/core/dist/boc/BitReader.js
var require_BitReader = __commonJS({
  "node_modules/@ton/core/dist/boc/BitReader.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.BitReader = void 0;
    var Address_1 = require_Address();
    var ExternalAddress_1 = require_ExternalAddress();
    var BitReader = class _BitReader {
      constructor(bits, offset = 0) {
        this._checkpoints = [];
        this._bits = bits;
        this._offset = offset;
      }
      /**
       * Offset in source bit string
       */
      get offset() {
        return this._offset;
      }
      /**
       * Number of bits remaining
       */
      get remaining() {
        return this._bits.length - this._offset;
      }
      /**
       * Skip bits
       * @param bits number of bits to skip
       */
      skip(bits) {
        if (bits < 0 || this._offset + bits > this._bits.length) {
          throw new Error(`Index ${this._offset + bits} is out of bounds`);
        }
        this._offset += bits;
      }
      /**
       * Reset to the beginning or latest checkpoint
       */
      reset() {
        if (this._checkpoints.length > 0) {
          this._offset = this._checkpoints.pop();
        } else {
          this._offset = 0;
        }
      }
      /**
       * Save checkpoint
       */
      save() {
        this._checkpoints.push(this._offset);
      }
      /**
       * Load a single bit
       * @returns true if the bit is set, false otherwise
       */
      loadBit() {
        let r = this._bits.at(this._offset);
        this._offset++;
        return r;
      }
      /**
       * Preload bit
       * @returns true if the bit is set, false otherwise
       */
      preloadBit() {
        return this._bits.at(this._offset);
      }
      /**
       * Load bit string
       * @param bits number of bits to read
       * @returns new bitstring
       */
      loadBits(bits) {
        let r = this._bits.substring(this._offset, bits);
        this._offset += bits;
        return r;
      }
      /**
       * Preload bit string
       * @param bits number of bits to read
       * @returns new bitstring
       */
      preloadBits(bits) {
        return this._bits.substring(this._offset, bits);
      }
      /**
       * Load buffer
       * @param bytes number of bytes
       * @returns new buffer
       */
      loadBuffer(bytes) {
        let buf = this._preloadBuffer(bytes, this._offset);
        this._offset += bytes * 8;
        return buf;
      }
      /**
       * Preload buffer
       * @param bytes number of bytes
       * @returns new buffer
       */
      preloadBuffer(bytes) {
        return this._preloadBuffer(bytes, this._offset);
      }
      /**
       * Load uint value
       * @param bits uint bits
       * @returns read value as number
       */
      loadUint(bits) {
        return this._toSafeInteger(this.loadUintBig(bits), "loadUintBig");
      }
      /**
       * Load uint value as bigint
       * @param bits uint bits
       * @returns read value as bigint
       */
      loadUintBig(bits) {
        let loaded = this.preloadUintBig(bits);
        this._offset += bits;
        return loaded;
      }
      /**
       * Preload uint value
       * @param bits uint bits
       * @returns read value as number
       */
      preloadUint(bits) {
        return this._toSafeInteger(this._preloadUint(bits, this._offset), "preloadUintBig");
      }
      /**
       * Preload uint value as bigint
       * @param bits uint bits
       * @returns read value as bigint
       */
      preloadUintBig(bits) {
        return this._preloadUint(bits, this._offset);
      }
      /**
       * Load int value
       * @param bits int bits
       * @returns read value as bigint
       */
      loadInt(bits) {
        let res = this._preloadInt(bits, this._offset);
        this._offset += bits;
        return this._toSafeInteger(res, "loadUintBig");
      }
      /**
       * Load int value as bigint
       * @param bits int bits
       * @returns read value as bigint
       */
      loadIntBig(bits) {
        let res = this._preloadInt(bits, this._offset);
        this._offset += bits;
        return res;
      }
      /**
       * Preload int value
       * @param bits int bits
       * @returns read value as bigint
       */
      preloadInt(bits) {
        return this._toSafeInteger(this._preloadInt(bits, this._offset), "preloadIntBig");
      }
      /**
       * Preload int value
       * @param bits int bits
       * @returns read value as bigint
       */
      preloadIntBig(bits) {
        return this._preloadInt(bits, this._offset);
      }
      /**
       * Load varuint value
       * @param bits number of bits to read the size
       * @returns read value as bigint
       */
      loadVarUint(bits) {
        let size = Number(this.loadUint(bits));
        return this._toSafeInteger(this.loadUintBig(size * 8), "loadVarUintBig");
      }
      /**
       * Load varuint value
       * @param bits number of bits to read the size
       * @returns read value as bigint
       */
      loadVarUintBig(bits) {
        let size = Number(this.loadUint(bits));
        return this.loadUintBig(size * 8);
      }
      /**
       * Preload varuint value
       * @param bits number of bits to read the size
       * @returns read value as bigint
       */
      preloadVarUint(bits) {
        let size = Number(this._preloadUint(bits, this._offset));
        return this._toSafeInteger(this._preloadUint(size * 8, this._offset + bits), "preloadVarUintBig");
      }
      /**
       * Preload varuint value
       * @param bits number of bits to read the size
       * @returns read value as bigint
       */
      preloadVarUintBig(bits) {
        let size = Number(this._preloadUint(bits, this._offset));
        return this._preloadUint(size * 8, this._offset + bits);
      }
      /**
       * Load varint value
       * @param bits number of bits to read the size
       * @returns read value as bigint
       */
      loadVarInt(bits) {
        let size = Number(this.loadUint(bits));
        return this._toSafeInteger(this.loadIntBig(size * 8), "loadVarIntBig");
      }
      /**
       * Load varint value
       * @param bits number of bits to read the size
       * @returns read value as bigint
       */
      loadVarIntBig(bits) {
        let size = Number(this.loadUint(bits));
        return this.loadIntBig(size * 8);
      }
      /**
       * Preload varint value
       * @param bits number of bits to read the size
       * @returns read value as bigint
       */
      preloadVarInt(bits) {
        let size = Number(this._preloadUint(bits, this._offset));
        return this._toSafeInteger(this._preloadInt(size * 8, this._offset + bits), "preloadVarIntBig");
      }
      /**
       * Preload varint value
       * @param bits number of bits to read the size
       * @returns read value as bigint
       */
      preloadVarIntBig(bits) {
        let size = Number(this._preloadUint(bits, this._offset));
        return this._preloadInt(size * 8, this._offset + bits);
      }
      /**
       * Load coins value
       * @returns read value as bigint
       */
      loadCoins() {
        return this.loadVarUintBig(4);
      }
      /**
       * Preload coins value
       * @returns read value as bigint
       */
      preloadCoins() {
        return this.preloadVarUintBig(4);
      }
      /**
       * Load Address
       * @returns Address
       */
      loadAddress() {
        let type = Number(this._preloadUint(2, this._offset));
        if (type === 2) {
          return this._loadInternalAddress();
        } else {
          throw new Error("Invalid address: " + type);
        }
      }
      /**
       * Load internal address
       * @returns Address or null
       */
      loadMaybeAddress() {
        let type = Number(this._preloadUint(2, this._offset));
        if (type === 0) {
          this._offset += 2;
          return null;
        } else if (type === 2) {
          return this._loadInternalAddress();
        } else {
          throw new Error("Invalid address");
        }
      }
      /**
       * Load external address
       * @returns ExternalAddress
       */
      loadExternalAddress() {
        let type = Number(this._preloadUint(2, this._offset));
        if (type === 1) {
          return this._loadExternalAddress();
        } else {
          throw new Error("Invalid address");
        }
      }
      /**
       * Load external address
       * @returns ExternalAddress or null
       */
      loadMaybeExternalAddress() {
        let type = Number(this._preloadUint(2, this._offset));
        if (type === 0) {
          this._offset += 2;
          return null;
        } else if (type === 1) {
          return this._loadExternalAddress();
        } else {
          throw new Error("Invalid address");
        }
      }
      /**
       * Read address of any type
       * @returns Address or ExternalAddress or null
       */
      loadAddressAny() {
        let type = Number(this._preloadUint(2, this._offset));
        if (type === 0) {
          this._offset += 2;
          return null;
        } else if (type === 2) {
          return this._loadInternalAddress();
        } else if (type === 1) {
          return this._loadExternalAddress();
        } else if (type === 3) {
          throw Error("Unsupported");
        } else {
          throw Error("Unreachable");
        }
      }
      /**
       * Load bit string that was padded to make it byte alligned. Used in BOC serialization
       * @param bytes number of bytes to read
       */
      loadPaddedBits(bits) {
        if (bits % 8 !== 0) {
          throw new Error("Invalid number of bits");
        }
        let length = bits;
        while (true) {
          if (this._bits.at(this._offset + length - 1)) {
            length--;
            break;
          } else {
            length--;
          }
        }
        let r = this._bits.substring(this._offset, length);
        this._offset += bits;
        return r;
      }
      /**
       * Clone BitReader
       */
      clone() {
        return new _BitReader(this._bits, this._offset);
      }
      /**
       * Preload int from specific offset
       * @param bits bits to preload
       * @param offset offset to start from
       * @returns read value as bigint
       */
      _preloadInt(bits, offset) {
        if (bits == 0) {
          return 0n;
        }
        let sign = this._bits.at(offset);
        let res = 0n;
        for (let i = 0; i < bits - 1; i++) {
          if (this._bits.at(offset + 1 + i)) {
            res += 1n << BigInt(bits - i - 1 - 1);
          }
        }
        if (sign) {
          res = res - (1n << BigInt(bits - 1));
        }
        return res;
      }
      /**
       * Preload uint from specific offset
       * @param bits bits to preload
       * @param offset offset to start from
       * @returns read value as bigint
       */
      _preloadUint(bits, offset) {
        if (bits == 0) {
          return 0n;
        }
        let res = 0n;
        for (let i = 0; i < bits; i++) {
          if (this._bits.at(offset + i)) {
            res += 1n << BigInt(bits - i - 1);
          }
        }
        return res;
      }
      _preloadBuffer(bytes, offset) {
        let fastBuffer = this._bits.subbuffer(offset, bytes * 8);
        if (fastBuffer) {
          return fastBuffer;
        }
        let buf = Buffer.alloc(bytes);
        for (let i = 0; i < bytes; i++) {
          buf[i] = Number(this._preloadUint(8, offset + i * 8));
        }
        return buf;
      }
      _loadInternalAddress() {
        let type = Number(this._preloadUint(2, this._offset));
        if (type !== 2) {
          throw Error("Invalid address");
        }
        if (this._preloadUint(1, this._offset + 2) !== 0n) {
          throw Error("Invalid address");
        }
        let wc = Number(this._preloadInt(8, this._offset + 3));
        let hash = this._preloadBuffer(32, this._offset + 11);
        this._offset += 267;
        return new Address_1.Address(wc, hash);
      }
      _loadExternalAddress() {
        let type = Number(this._preloadUint(2, this._offset));
        if (type !== 1) {
          throw Error("Invalid address");
        }
        let bits = Number(this._preloadUint(9, this._offset + 2));
        let value = this._preloadUint(bits, this._offset + 11);
        this._offset += 11 + bits;
        return new ExternalAddress_1.ExternalAddress(value, bits);
      }
      _toSafeInteger(src, alt) {
        if (BigInt(Number.MAX_SAFE_INTEGER) < src || src < BigInt(Number.MIN_SAFE_INTEGER)) {
          throw new TypeError(`${src} is out of safe integer range. Use ${alt} instead`);
        }
        return Number(src);
      }
    };
    exports.BitReader = BitReader;
  }
});

// node_modules/@ton/core/dist/boc/cell/exoticMerkleProof.js
var require_exoticMerkleProof = __commonJS({
  "node_modules/@ton/core/dist/boc/cell/exoticMerkleProof.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.convertToMerkleProof = exports.exoticMerkleProof = void 0;
    var BitReader_1 = require_BitReader();
    var Builder_1 = require_Builder();
    function exoticMerkleProof(bits, refs) {
      const reader = new BitReader_1.BitReader(bits);
      const size = 8 + 256 + 16;
      if (bits.length !== size) {
        throw new Error(`Merkle Proof cell must have exactly (8 + 256 + 16) bits, got "${bits.length}"`);
      }
      if (refs.length !== 1) {
        throw new Error(`Merkle Proof cell must have exactly 1 ref, got "${refs.length}"`);
      }
      let type = reader.loadUint(8);
      if (type !== 3) {
        throw new Error(`Merkle Proof cell must have type 3, got "${type}"`);
      }
      const proofHash = reader.loadBuffer(32);
      const proofDepth = reader.loadUint(16);
      const refHash = refs[0].hash(0);
      const refDepth = refs[0].depth(0);
      if (proofDepth !== refDepth) {
        throw new Error(`Merkle Proof cell ref depth must be exactly "${proofDepth}", got "${refDepth}"`);
      }
      if (!proofHash.equals(refHash)) {
        throw new Error(`Merkle Proof cell ref hash must be exactly "${proofHash.toString("hex")}", got "${refHash.toString("hex")}"`);
      }
      return {
        proofDepth,
        proofHash
      };
    }
    exports.exoticMerkleProof = exoticMerkleProof;
    function convertToMerkleProof(c) {
      return (0, Builder_1.beginCell)().storeUint(3, 8).storeBuffer(c.hash(0)).storeUint(c.depth(0), 16).storeRef(c).endCell({ exotic: true });
    }
    exports.convertToMerkleProof = convertToMerkleProof;
  }
});

// node_modules/@ton/core/dist/dict/generateMerkleProof.js
var require_generateMerkleProof = __commonJS({
  "node_modules/@ton/core/dist/dict/generateMerkleProof.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.generateMerkleProof = exports.generateMerkleProofDirect = void 0;
    var Builder_1 = require_Builder();
    var readUnaryLength_1 = require_readUnaryLength();
    var exoticMerkleProof_1 = require_exoticMerkleProof();
    function convertToPrunedBranch(c) {
      return (0, Builder_1.beginCell)().storeUint(1, 8).storeUint(1, 8).storeBuffer(c.hash(0)).storeUint(c.depth(0), 16).endCell({ exotic: true });
    }
    function doGenerateMerkleProof(prefix, slice, n, keys) {
      const originalCell = slice.asCell();
      if (keys.length == 0) {
        return convertToPrunedBranch(originalCell);
      }
      let lb0 = slice.loadBit() ? 1 : 0;
      let prefixLength = 0;
      let pp = prefix;
      if (lb0 === 0) {
        prefixLength = (0, readUnaryLength_1.readUnaryLength)(slice);
        for (let i = 0; i < prefixLength; i++) {
          pp += slice.loadBit() ? "1" : "0";
        }
      } else {
        let lb1 = slice.loadBit() ? 1 : 0;
        if (lb1 === 0) {
          prefixLength = slice.loadUint(Math.ceil(Math.log2(n + 1)));
          for (let i = 0; i < prefixLength; i++) {
            pp += slice.loadBit() ? "1" : "0";
          }
        } else {
          let bit = slice.loadBit() ? "1" : "0";
          prefixLength = slice.loadUint(Math.ceil(Math.log2(n + 1)));
          for (let i = 0; i < prefixLength; i++) {
            pp += bit;
          }
        }
      }
      if (n - prefixLength === 0) {
        return originalCell;
      } else {
        let sl = originalCell.beginParse();
        let left = sl.loadRef();
        let right = sl.loadRef();
        if (!left.isExotic) {
          const leftKeys = keys.filter((key) => {
            return pp + "0" === key.slice(0, pp.length + 1);
          });
          left = doGenerateMerkleProof(pp + "0", left.beginParse(), n - prefixLength - 1, leftKeys);
        }
        if (!right.isExotic) {
          const rightKeys = keys.filter((key) => {
            return pp + "1" === key.slice(0, pp.length + 1);
          });
          right = doGenerateMerkleProof(pp + "1", right.beginParse(), n - prefixLength - 1, rightKeys);
        }
        return (0, Builder_1.beginCell)().storeSlice(sl).storeRef(left).storeRef(right).endCell();
      }
    }
    function generateMerkleProofDirect(dict, keys, keyObject) {
      keys.forEach((key) => {
        if (!dict.has(key)) {
          throw new Error(`Trying to generate merkle proof for a missing key "${key}"`);
        }
      });
      const s = (0, Builder_1.beginCell)().storeDictDirect(dict).asSlice();
      return doGenerateMerkleProof("", s, keyObject.bits, keys.map((key) => keyObject.serialize(key).toString(2).padStart(keyObject.bits, "0")));
    }
    exports.generateMerkleProofDirect = generateMerkleProofDirect;
    function generateMerkleProof(dict, keys, keyObject) {
      return (0, exoticMerkleProof_1.convertToMerkleProof)(generateMerkleProofDirect(dict, keys, keyObject));
    }
    exports.generateMerkleProof = generateMerkleProof;
  }
});

// node_modules/@ton/core/dist/dict/generateMerkleUpdate.js
var require_generateMerkleUpdate = __commonJS({
  "node_modules/@ton/core/dist/dict/generateMerkleUpdate.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.generateMerkleUpdate = void 0;
    var Builder_1 = require_Builder();
    var generateMerkleProof_1 = require_generateMerkleProof();
    function convertToMerkleUpdate(c1, c2) {
      return (0, Builder_1.beginCell)().storeUint(4, 8).storeBuffer(c1.hash(0)).storeBuffer(c2.hash(0)).storeUint(c1.depth(0), 16).storeUint(c2.depth(0), 16).storeRef(c1).storeRef(c2).endCell({ exotic: true });
    }
    function generateMerkleUpdate(dict, key, keyObject, newValue) {
      const oldProof = (0, generateMerkleProof_1.generateMerkleProof)(dict, [key], keyObject).refs[0];
      dict.set(key, newValue);
      const newProof = (0, generateMerkleProof_1.generateMerkleProof)(dict, [key], keyObject).refs[0];
      return convertToMerkleUpdate(oldProof, newProof);
    }
    exports.generateMerkleUpdate = generateMerkleUpdate;
  }
});

// node_modules/@ton/core/dist/dict/parseDict.js
var require_parseDict = __commonJS({
  "node_modules/@ton/core/dist/dict/parseDict.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.parseDict = void 0;
    function readUnaryLength(slice) {
      let res = 0;
      while (slice.loadBit()) {
        res++;
      }
      return res;
    }
    function doParse(prefix, slice, n, res, extractor) {
      let lb0 = slice.loadBit() ? 1 : 0;
      let prefixLength = 0;
      let pp = prefix;
      if (lb0 === 0) {
        prefixLength = readUnaryLength(slice);
        for (let i = 0; i < prefixLength; i++) {
          pp += slice.loadBit() ? "1" : "0";
        }
      } else {
        let lb1 = slice.loadBit() ? 1 : 0;
        if (lb1 === 0) {
          prefixLength = slice.loadUint(Math.ceil(Math.log2(n + 1)));
          for (let i = 0; i < prefixLength; i++) {
            pp += slice.loadBit() ? "1" : "0";
          }
        } else {
          let bit = slice.loadBit() ? "1" : "0";
          prefixLength = slice.loadUint(Math.ceil(Math.log2(n + 1)));
          for (let i = 0; i < prefixLength; i++) {
            pp += bit;
          }
        }
      }
      if (n - prefixLength === 0) {
        res.set(BigInt("0b" + pp), extractor(slice));
      } else {
        let left = slice.loadRef();
        let right = slice.loadRef();
        if (!left.isExotic) {
          doParse(pp + "0", left.beginParse(), n - prefixLength - 1, res, extractor);
        }
        if (!right.isExotic) {
          doParse(pp + "1", right.beginParse(), n - prefixLength - 1, res, extractor);
        }
      }
    }
    function parseDict(sc, keySize, extractor) {
      let res = /* @__PURE__ */ new Map();
      if (sc) {
        doParse("", sc, keySize, res, extractor);
      }
      return res;
    }
    exports.parseDict = parseDict;
  }
});

// node_modules/@ton/core/dist/dict/utils/findCommonPrefix.js
var require_findCommonPrefix = __commonJS({
  "node_modules/@ton/core/dist/dict/utils/findCommonPrefix.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.findCommonPrefix = void 0;
    function findCommonPrefix(src, startPos = 0) {
      if (src.length === 0) {
        return "";
      }
      let r = src[0].slice(startPos);
      for (let i = 1; i < src.length; i++) {
        const s = src[i];
        while (s.indexOf(r, startPos) !== startPos) {
          r = r.substring(0, r.length - 1);
          if (r === "") {
            return r;
          }
        }
      }
      return r;
    }
    exports.findCommonPrefix = findCommonPrefix;
  }
});

// node_modules/@ton/core/dist/dict/serializeDict.js
var require_serializeDict = __commonJS({
  "node_modules/@ton/core/dist/dict/serializeDict.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.serializeDict = exports.detectLabelType = exports.writeLabelSame = exports.writeLabelLong = exports.writeLabelShort = exports.buildTree = void 0;
    var Builder_1 = require_Builder();
    var findCommonPrefix_1 = require_findCommonPrefix();
    function pad(src, size) {
      while (src.length < size) {
        src = "0" + src;
      }
      return src;
    }
    function forkMap(src, prefixLen) {
      if (src.size === 0) {
        throw Error("Internal inconsistency");
      }
      let left = /* @__PURE__ */ new Map();
      let right = /* @__PURE__ */ new Map();
      for (let [k, d] of src.entries()) {
        if (k[prefixLen] === "0") {
          left.set(k, d);
        } else {
          right.set(k, d);
        }
      }
      if (left.size === 0) {
        throw Error("Internal inconsistency. Left emtpy.");
      }
      if (right.size === 0) {
        throw Error("Internal inconsistency. Right emtpy.");
      }
      return { left, right };
    }
    function buildNode(src, prefixLen) {
      if (src.size === 0) {
        throw Error("Internal inconsistency");
      }
      if (src.size === 1) {
        return { type: "leaf", value: Array.from(src.values())[0] };
      }
      let { left, right } = forkMap(src, prefixLen);
      return {
        type: "fork",
        left: buildEdge(left, prefixLen + 1),
        right: buildEdge(right, prefixLen + 1)
      };
    }
    function buildEdge(src, prefixLen = 0) {
      if (src.size === 0) {
        throw Error("Internal inconsistency");
      }
      const label = (0, findCommonPrefix_1.findCommonPrefix)(Array.from(src.keys()), prefixLen);
      return { label, node: buildNode(src, label.length + prefixLen) };
    }
    function buildTree(src, keyLength) {
      let converted = /* @__PURE__ */ new Map();
      for (let k of Array.from(src.keys())) {
        const padded = pad(k.toString(2), keyLength);
        converted.set(padded, src.get(k));
      }
      return buildEdge(converted);
    }
    exports.buildTree = buildTree;
    function writeLabelShort(src, to) {
      to.storeBit(0);
      for (let i = 0; i < src.length; i++) {
        to.storeBit(1);
      }
      to.storeBit(0);
      if (src.length > 0) {
        to.storeUint(BigInt("0b" + src), src.length);
      }
      return to;
    }
    exports.writeLabelShort = writeLabelShort;
    function labelShortLength(src) {
      return 1 + src.length + 1 + src.length;
    }
    function writeLabelLong(src, keyLength, to) {
      to.storeBit(1);
      to.storeBit(0);
      let length = Math.ceil(Math.log2(keyLength + 1));
      to.storeUint(src.length, length);
      if (src.length > 0) {
        to.storeUint(BigInt("0b" + src), src.length);
      }
      return to;
    }
    exports.writeLabelLong = writeLabelLong;
    function labelLongLength(src, keyLength) {
      return 1 + 1 + Math.ceil(Math.log2(keyLength + 1)) + src.length;
    }
    function writeLabelSame(value, length, keyLength, to) {
      to.storeBit(1);
      to.storeBit(1);
      to.storeBit(value);
      let lenLen = Math.ceil(Math.log2(keyLength + 1));
      to.storeUint(length, lenLen);
    }
    exports.writeLabelSame = writeLabelSame;
    function labelSameLength(keyLength) {
      return 1 + 1 + 1 + Math.ceil(Math.log2(keyLength + 1));
    }
    function isSame(src) {
      if (src.length === 0 || src.length === 1) {
        return true;
      }
      for (let i = 1; i < src.length; i++) {
        if (src[i] !== src[0]) {
          return false;
        }
      }
      return true;
    }
    function detectLabelType(src, keyLength) {
      let kind = "short";
      let kindLength = labelShortLength(src);
      let longLength = labelLongLength(src, keyLength);
      if (longLength < kindLength) {
        kindLength = longLength;
        kind = "long";
      }
      if (isSame(src)) {
        let sameLength = labelSameLength(keyLength);
        if (sameLength < kindLength) {
          kindLength = sameLength;
          kind = "same";
        }
      }
      return kind;
    }
    exports.detectLabelType = detectLabelType;
    function writeLabel(src, keyLength, to) {
      let type = detectLabelType(src, keyLength);
      if (type === "short") {
        writeLabelShort(src, to);
      } else if (type === "long") {
        writeLabelLong(src, keyLength, to);
      } else if (type === "same") {
        writeLabelSame(src[0] === "1", src.length, keyLength, to);
      }
    }
    function writeNode(src, keyLength, serializer, to) {
      if (src.type === "leaf") {
        serializer(src.value, to);
      }
      if (src.type === "fork") {
        const leftCell = (0, Builder_1.beginCell)();
        const rightCell = (0, Builder_1.beginCell)();
        writeEdge(src.left, keyLength - 1, serializer, leftCell);
        writeEdge(src.right, keyLength - 1, serializer, rightCell);
        to.storeRef(leftCell);
        to.storeRef(rightCell);
      }
    }
    function writeEdge(src, keyLength, serializer, to) {
      writeLabel(src.label, keyLength, to);
      writeNode(src.node, keyLength - src.label.length, serializer, to);
    }
    function serializeDict(src, keyLength, serializer, to) {
      const tree = buildTree(src, keyLength);
      writeEdge(tree, keyLength, serializer, to);
    }
    exports.serializeDict = serializeDict;
  }
});

// node_modules/@ton/core/dist/dict/utils/internalKeySerializer.js
var require_internalKeySerializer = __commonJS({
  "node_modules/@ton/core/dist/dict/utils/internalKeySerializer.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.deserializeInternalKey = exports.serializeInternalKey = void 0;
    var Address_1 = require_Address();
    var BitString_1 = require_BitString();
    var paddedBits_1 = require_paddedBits();
    function serializeInternalKey(value) {
      if (typeof value === "number") {
        if (!Number.isSafeInteger(value)) {
          throw Error("Invalid key type: not a safe integer: " + value);
        }
        return "n:" + value.toString(10);
      } else if (typeof value === "bigint") {
        return "b:" + value.toString(10);
      } else if (Address_1.Address.isAddress(value)) {
        return "a:" + value.toString();
      } else if (Buffer.isBuffer(value)) {
        return "f:" + value.toString("hex");
      } else if (BitString_1.BitString.isBitString(value)) {
        return "B:" + value.toString();
      } else {
        throw Error("Invalid key type");
      }
    }
    exports.serializeInternalKey = serializeInternalKey;
    function deserializeInternalKey(value) {
      let k = value.slice(0, 2);
      let v = value.slice(2);
      if (k === "n:") {
        return parseInt(v, 10);
      } else if (k === "b:") {
        return BigInt(v);
      } else if (k === "a:") {
        return Address_1.Address.parse(v);
      } else if (k === "f:") {
        return Buffer.from(v, "hex");
      } else if (k === "B:") {
        const lastDash = v.slice(-1) == "_";
        const isPadded = lastDash || v.length % 2 != 0;
        if (isPadded) {
          let charLen = lastDash ? v.length - 1 : v.length;
          const padded = v.substr(0, charLen) + "0";
          if (!lastDash && (charLen & 1) !== 0) {
            return new BitString_1.BitString(Buffer.from(padded, "hex"), 0, charLen << 2);
          } else {
            return (0, paddedBits_1.paddedBufferToBits)(Buffer.from(padded, "hex"));
          }
        } else {
          return new BitString_1.BitString(Buffer.from(v, "hex"), 0, v.length << 2);
        }
      }
      throw Error("Invalid key type: " + k);
    }
    exports.deserializeInternalKey = deserializeInternalKey;
  }
});

// node_modules/@ton/core/dist/dict/Dictionary.js
var require_Dictionary = __commonJS({
  "node_modules/@ton/core/dist/dict/Dictionary.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Dictionary = void 0;
    var Address_1 = require_Address();
    var Builder_1 = require_Builder();
    var Cell_1 = require_Cell();
    var BitString_1 = require_BitString();
    var generateMerkleProof_1 = require_generateMerkleProof();
    var generateMerkleUpdate_1 = require_generateMerkleUpdate();
    var parseDict_1 = require_parseDict();
    var serializeDict_1 = require_serializeDict();
    var internalKeySerializer_1 = require_internalKeySerializer();
    var Dictionary2 = class _Dictionary {
      /**
       * Create an empty map
       * @param key key type
       * @param value value type
       * @returns Dictionary<K, V>
       */
      static empty(key, value) {
        if (key && value) {
          return new _Dictionary(/* @__PURE__ */ new Map(), key, value);
        } else {
          return new _Dictionary(/* @__PURE__ */ new Map(), null, null);
        }
      }
      /**
       * Load dictionary from slice
       * @param key key description
       * @param value value description
       * @param src slice
       * @returns Dictionary<K, V>
       */
      static load(key, value, sc) {
        let slice;
        if (sc instanceof Cell_1.Cell) {
          if (sc.isExotic) {
            return _Dictionary.empty(key, value);
          }
          slice = sc.beginParse();
        } else {
          slice = sc;
        }
        let cell = slice.loadMaybeRef();
        if (cell && !cell.isExotic) {
          return _Dictionary.loadDirect(key, value, cell.beginParse());
        } else {
          return _Dictionary.empty(key, value);
        }
      }
      /**
       * Low level method for rare dictionaries from system contracts.
       * Loads dictionary from slice directly without going to the ref.
       *
       * @param key key description
       * @param value value description
       * @param sc slice
       * @returns Dictionary<K, V>
       */
      static loadDirect(key, value, sc) {
        if (!sc) {
          return _Dictionary.empty(key, value);
        }
        let slice;
        if (sc instanceof Cell_1.Cell) {
          slice = sc.beginParse();
        } else {
          slice = sc;
        }
        let values = (0, parseDict_1.parseDict)(slice, key.bits, value.parse);
        let prepare = /* @__PURE__ */ new Map();
        for (let [k, v] of values) {
          prepare.set((0, internalKeySerializer_1.serializeInternalKey)(key.parse(k)), v);
        }
        return new _Dictionary(prepare, key, value);
      }
      constructor(values, key, value) {
        this._key = key;
        this._value = value;
        this._map = values;
      }
      get size() {
        return this._map.size;
      }
      get(key) {
        return this._map.get((0, internalKeySerializer_1.serializeInternalKey)(key));
      }
      has(key) {
        return this._map.has((0, internalKeySerializer_1.serializeInternalKey)(key));
      }
      set(key, value) {
        this._map.set((0, internalKeySerializer_1.serializeInternalKey)(key), value);
        return this;
      }
      delete(key) {
        const k = (0, internalKeySerializer_1.serializeInternalKey)(key);
        return this._map.delete(k);
      }
      clear() {
        this._map.clear();
      }
      *[Symbol.iterator]() {
        for (const [k, v] of this._map) {
          const key = (0, internalKeySerializer_1.deserializeInternalKey)(k);
          yield [key, v];
        }
      }
      keys() {
        return Array.from(this._map.keys()).map((v) => (0, internalKeySerializer_1.deserializeInternalKey)(v));
      }
      values() {
        return Array.from(this._map.values());
      }
      store(builder, key, value) {
        if (this._map.size === 0) {
          builder.storeBit(0);
        } else {
          let resolvedKey = this._key;
          if (key !== null && key !== void 0) {
            resolvedKey = key;
          }
          let resolvedValue = this._value;
          if (value !== null && value !== void 0) {
            resolvedValue = value;
          }
          if (!resolvedKey) {
            throw Error("Key serializer is not defined");
          }
          if (!resolvedValue) {
            throw Error("Value serializer is not defined");
          }
          let prepared = /* @__PURE__ */ new Map();
          for (const [k, v] of this._map) {
            prepared.set(resolvedKey.serialize((0, internalKeySerializer_1.deserializeInternalKey)(k)), v);
          }
          builder.storeBit(1);
          let dd = (0, Builder_1.beginCell)();
          (0, serializeDict_1.serializeDict)(prepared, resolvedKey.bits, resolvedValue.serialize, dd);
          builder.storeRef(dd.endCell());
        }
      }
      storeDirect(builder, key, value) {
        if (this._map.size === 0) {
          throw Error("Cannot store empty dictionary directly");
        }
        let resolvedKey = this._key;
        if (key !== null && key !== void 0) {
          resolvedKey = key;
        }
        let resolvedValue = this._value;
        if (value !== null && value !== void 0) {
          resolvedValue = value;
        }
        if (!resolvedKey) {
          throw Error("Key serializer is not defined");
        }
        if (!resolvedValue) {
          throw Error("Value serializer is not defined");
        }
        let prepared = /* @__PURE__ */ new Map();
        for (const [k, v] of this._map) {
          prepared.set(resolvedKey.serialize((0, internalKeySerializer_1.deserializeInternalKey)(k)), v);
        }
        (0, serializeDict_1.serializeDict)(prepared, resolvedKey.bits, resolvedValue.serialize, builder);
      }
      /**
       * Generate merkle proof for multiple keys in the dictionary
       * @param keys an array of the keys
       * @returns generated merkle proof cell
       */
      generateMerkleProof(keys) {
        return (0, generateMerkleProof_1.generateMerkleProof)(this, keys, this._key);
      }
      /**
       * Low level method for generating pruned dictionary directly.
       * The result can be used as a part of a bigger merkle proof
       * @param keys an array of the keys
       * @returns cell that contains the pruned dictionary
       */
      generateMerkleProofDirect(keys) {
        return (0, generateMerkleProof_1.generateMerkleProofDirect)(this, keys, this._key);
      }
      generateMerkleUpdate(key, newValue) {
        return (0, generateMerkleUpdate_1.generateMerkleUpdate)(this, key, this._key, newValue);
      }
    };
    exports.Dictionary = Dictionary2;
    Dictionary2.Keys = {
      /**
       * Standard address key
       * @returns DictionaryKey<Address>
       */
      Address: () => {
        return createAddressKey();
      },
      /**
       * Create standard big integer key
       * @param bits number of bits
       * @returns DictionaryKey<bigint>
       */
      BigInt: (bits) => {
        return createBigIntKey(bits);
      },
      /**
       * Create integer key
       * @param bits bits of integer
       * @returns DictionaryKey<number>
       */
      Int: (bits) => {
        return createIntKey(bits);
      },
      /**
       * Create standard unsigned big integer key
       * @param bits number of bits
       * @returns DictionaryKey<bigint>
       */
      BigUint: (bits) => {
        return createBigUintKey(bits);
      },
      /**
       * Create standard unsigned integer key
       * @param bits number of bits
       * @returns DictionaryKey<number>
       */
      Uint: (bits) => {
        return createUintKey(bits);
      },
      /**
       * Create standard buffer key
       * @param bytes number of bytes of a buffer
       * @returns DictionaryKey<Buffer>
       */
      Buffer: (bytes) => {
        return createBufferKey(bytes);
      },
      /**
       * Create BitString key
       * @param bits key length
       * @returns DictionaryKey<BitString>
       * Point is that Buffer has to be 8 bit aligned,
       * while key is TVM dictionary doesn't have to be
       * aligned at all.
       */
      BitString: (bits) => {
        return createBitStringKey(bits);
      }
    };
    Dictionary2.Values = {
      /**
       * Create standard integer value
       * @returns DictionaryValue<bigint>
       */
      BigInt: (bits) => {
        return createBigIntValue(bits);
      },
      /**
       * Create standard integer value
       * @returns DictionaryValue<number>
       */
      Int: (bits) => {
        return createIntValue(bits);
      },
      /**
       * Create big var int
       * @param bits nubmer of header bits
       * @returns DictionaryValue<bigint>
       */
      BigVarInt: (bits) => {
        return createBigVarIntValue(bits);
      },
      /**
       * Create standard unsigned integer value
       * @param bits number of bits
       * @returns DictionaryValue<bigint>
       */
      BigUint: (bits) => {
        return createBigUintValue(bits);
      },
      /**
       * Create standard unsigned integer value
       * @param bits number of bits
       * @returns DictionaryValue<bigint>
       */
      Uint: (bits) => {
        return createUintValue(bits);
      },
      /**
       * Create big var int
       * @param bits nubmer of header bits
       * @returns DictionaryValue<bigint>
       */
      BigVarUint: (bits) => {
        return createBigVarUintValue(bits);
      },
      /**
       * Create standard boolean value
       * @returns DictionaryValue<boolean>
       */
      Bool: () => {
        return createBooleanValue();
      },
      /**
       * Create standard address value
       * @returns DictionaryValue<Address>
       */
      Address: () => {
        return createAddressValue();
      },
      /**
       * Create standard cell value
       * @returns DictionaryValue<Cell>
       */
      Cell: () => {
        return createCellValue();
      },
      /**
       * Create Builder value
       * @param bytes number of bytes of a buffer
       * @returns DictionaryValue<Builder>
       */
      Buffer: (bytes) => {
        return createBufferValue(bytes);
      },
      /**
       * Create BitString value
       * @param requested bit length
       * @returns DictionaryValue<BitString>
       * Point is that Buffer is not applicable
       * when length is not 8 bit alligned.
       */
      BitString: (bits) => {
        return createBitStringValue(bits);
      },
      /**
       * Create dictionary value
       * @param key
       * @param value
       */
      Dictionary: (key, value) => {
        return createDictionaryValue(key, value);
      }
    };
    function createAddressKey() {
      return {
        bits: 267,
        serialize: (src) => {
          if (!Address_1.Address.isAddress(src)) {
            throw Error("Key is not an address");
          }
          return (0, Builder_1.beginCell)().storeAddress(src).endCell().beginParse().preloadUintBig(267);
        },
        parse: (src) => {
          return (0, Builder_1.beginCell)().storeUint(src, 267).endCell().beginParse().loadAddress();
        }
      };
    }
    function createBigIntKey(bits) {
      return {
        bits,
        serialize: (src) => {
          if (typeof src !== "bigint") {
            throw Error("Key is not a bigint");
          }
          return (0, Builder_1.beginCell)().storeInt(src, bits).endCell().beginParse().loadUintBig(bits);
        },
        parse: (src) => {
          return (0, Builder_1.beginCell)().storeUint(src, bits).endCell().beginParse().loadIntBig(bits);
        }
      };
    }
    function createIntKey(bits) {
      return {
        bits,
        serialize: (src) => {
          if (typeof src !== "number") {
            throw Error("Key is not a number");
          }
          if (!Number.isSafeInteger(src)) {
            throw Error("Key is not a safe integer: " + src);
          }
          return (0, Builder_1.beginCell)().storeInt(src, bits).endCell().beginParse().loadUintBig(bits);
        },
        parse: (src) => {
          return (0, Builder_1.beginCell)().storeUint(src, bits).endCell().beginParse().loadInt(bits);
        }
      };
    }
    function createBigUintKey(bits) {
      return {
        bits,
        serialize: (src) => {
          if (typeof src !== "bigint") {
            throw Error("Key is not a bigint");
          }
          if (src < 0) {
            throw Error("Key is negative: " + src);
          }
          return (0, Builder_1.beginCell)().storeUint(src, bits).endCell().beginParse().loadUintBig(bits);
        },
        parse: (src) => {
          return (0, Builder_1.beginCell)().storeUint(src, bits).endCell().beginParse().loadUintBig(bits);
        }
      };
    }
    function createUintKey(bits) {
      return {
        bits,
        serialize: (src) => {
          if (typeof src !== "number") {
            throw Error("Key is not a number");
          }
          if (!Number.isSafeInteger(src)) {
            throw Error("Key is not a safe integer: " + src);
          }
          if (src < 0) {
            throw Error("Key is negative: " + src);
          }
          return (0, Builder_1.beginCell)().storeUint(src, bits).endCell().beginParse().loadUintBig(bits);
        },
        parse: (src) => {
          return Number((0, Builder_1.beginCell)().storeUint(src, bits).endCell().beginParse().loadUint(bits));
        }
      };
    }
    function createBufferKey(bytes) {
      return {
        bits: bytes * 8,
        serialize: (src) => {
          if (!Buffer.isBuffer(src)) {
            throw Error("Key is not a buffer");
          }
          return (0, Builder_1.beginCell)().storeBuffer(src).endCell().beginParse().loadUintBig(bytes * 8);
        },
        parse: (src) => {
          return (0, Builder_1.beginCell)().storeUint(src, bytes * 8).endCell().beginParse().loadBuffer(bytes);
        }
      };
    }
    function createBitStringKey(bits) {
      return {
        bits,
        serialize: (src) => {
          if (!BitString_1.BitString.isBitString(src))
            throw Error("Key is not a BitString");
          return (0, Builder_1.beginCell)().storeBits(src).endCell().beginParse().loadUintBig(bits);
        },
        parse: (src) => {
          return (0, Builder_1.beginCell)().storeUint(src, bits).endCell().beginParse().loadBits(bits);
        }
      };
    }
    function createIntValue(bits) {
      return {
        serialize: (src, buidler) => {
          buidler.storeInt(src, bits);
        },
        parse: (src) => {
          return src.loadInt(bits);
        }
      };
    }
    function createBigIntValue(bits) {
      return {
        serialize: (src, buidler) => {
          buidler.storeInt(src, bits);
        },
        parse: (src) => {
          return src.loadIntBig(bits);
        }
      };
    }
    function createBigVarIntValue(bits) {
      return {
        serialize: (src, buidler) => {
          buidler.storeVarInt(src, bits);
        },
        parse: (src) => {
          return src.loadVarIntBig(bits);
        }
      };
    }
    function createBigVarUintValue(bits) {
      return {
        serialize: (src, buidler) => {
          buidler.storeVarUint(src, bits);
        },
        parse: (src) => {
          return src.loadVarUintBig(bits);
        }
      };
    }
    function createUintValue(bits) {
      return {
        serialize: (src, buidler) => {
          buidler.storeUint(src, bits);
        },
        parse: (src) => {
          return src.loadUint(bits);
        }
      };
    }
    function createBigUintValue(bits) {
      return {
        serialize: (src, buidler) => {
          buidler.storeUint(src, bits);
        },
        parse: (src) => {
          return src.loadUintBig(bits);
        }
      };
    }
    function createBooleanValue() {
      return {
        serialize: (src, buidler) => {
          buidler.storeBit(src);
        },
        parse: (src) => {
          return src.loadBit();
        }
      };
    }
    function createAddressValue() {
      return {
        serialize: (src, buidler) => {
          buidler.storeAddress(src);
        },
        parse: (src) => {
          return src.loadAddress();
        }
      };
    }
    function createCellValue() {
      return {
        serialize: (src, buidler) => {
          buidler.storeRef(src);
        },
        parse: (src) => {
          return src.loadRef();
        }
      };
    }
    function createDictionaryValue(key, value) {
      return {
        serialize: (src, buidler) => {
          src.store(buidler);
        },
        parse: (src) => {
          return Dictionary2.load(key, value, src);
        }
      };
    }
    function createBufferValue(size) {
      return {
        serialize: (src, buidler) => {
          if (src.length !== size) {
            throw Error("Invalid buffer size");
          }
          buidler.storeBuffer(src);
        },
        parse: (src) => {
          return src.loadBuffer(size);
        }
      };
    }
    function createBitStringValue(bits) {
      return {
        serialize: (src, builder) => {
          if (src.length !== bits) {
            throw Error("Invalid BitString size");
          }
          builder.storeBits(src);
        },
        parse: (src) => {
          return src.loadBits(bits);
        }
      };
    }
  }
});

// node_modules/@ton/core/dist/boc/utils/strings.js
var require_strings = __commonJS({
  "node_modules/@ton/core/dist/boc/utils/strings.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.writeString = exports.stringToCell = exports.readString = void 0;
    var Builder_1 = require_Builder();
    function readBuffer(slice) {
      if (slice.remainingBits % 8 !== 0) {
        throw new Error(`Invalid string length: ${slice.remainingBits}`);
      }
      if (slice.remainingRefs !== 0 && slice.remainingRefs !== 1) {
        throw new Error(`invalid number of refs: ${slice.remainingRefs}`);
      }
      let res;
      if (slice.remainingBits === 0) {
        res = Buffer.alloc(0);
      } else {
        res = slice.loadBuffer(slice.remainingBits / 8);
      }
      if (slice.remainingRefs === 1) {
        res = Buffer.concat([res, readBuffer(slice.loadRef().beginParse())]);
      }
      return res;
    }
    function readString(slice) {
      return readBuffer(slice).toString();
    }
    exports.readString = readString;
    function writeBuffer(src, builder) {
      if (src.length > 0) {
        let bytes = Math.floor(builder.availableBits / 8);
        if (src.length > bytes) {
          let a = src.subarray(0, bytes);
          let t = src.subarray(bytes);
          builder = builder.storeBuffer(a);
          let bb = (0, Builder_1.beginCell)();
          writeBuffer(t, bb);
          builder = builder.storeRef(bb.endCell());
        } else {
          builder = builder.storeBuffer(src);
        }
      }
    }
    function stringToCell(src) {
      let builder = (0, Builder_1.beginCell)();
      writeBuffer(Buffer.from(src), builder);
      return builder.endCell();
    }
    exports.stringToCell = stringToCell;
    function writeString(src, builder) {
      writeBuffer(Buffer.from(src), builder);
    }
    exports.writeString = writeString;
  }
});

// node_modules/@ton/core/dist/boc/Slice.js
var require_Slice = __commonJS({
  "node_modules/@ton/core/dist/boc/Slice.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    var _a;
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Slice = void 0;
    var symbol_inspect_1 = __importDefault(require_symbol());
    var Dictionary_1 = require_Dictionary();
    var Builder_1 = require_Builder();
    var strings_1 = require_strings();
    var Slice2 = class _Slice {
      constructor(reader, refs) {
        this[_a] = () => this.toString();
        this._reader = reader.clone();
        this._refs = [...refs];
        this._refsOffset = 0;
      }
      /**
       * Get remaining bits
       */
      get remainingBits() {
        return this._reader.remaining;
      }
      /**
       * Get offset bits
       */
      get offsetBits() {
        return this._reader.offset;
      }
      /**
       * Get remaining refs
       */
      get remainingRefs() {
        return this._refs.length - this._refsOffset;
      }
      /**
       * Get offset refs
       */
      get offsetRefs() {
        return this._refsOffset;
      }
      /**
       * Skip bits
       * @param bits
       */
      skip(bits) {
        this._reader.skip(bits);
        return this;
      }
      /**
       * Load a single bit
       * @returns true or false depending on the bit value
       */
      loadBit() {
        return this._reader.loadBit();
      }
      /**
       * Preload a signle bit
       * @returns true or false depending on the bit value
       */
      preloadBit() {
        return this._reader.preloadBit();
      }
      /**
       * Load a boolean
       * @returns true or false depending on the bit value
       */
      loadBoolean() {
        return this.loadBit();
      }
      /**
       * Load maybe boolean
       * @returns true or false depending on the bit value or null
       */
      loadMaybeBoolean() {
        if (this.loadBit()) {
          return this.loadBoolean();
        } else {
          return null;
        }
      }
      /**
       * Load bits as a new BitString
       * @param bits number of bits to read
       * @returns new BitString
       */
      loadBits(bits) {
        return this._reader.loadBits(bits);
      }
      /**
       * Preload bits as a new BitString
       * @param bits number of bits to read
       * @returns new BitString
       */
      preloadBits(bits) {
        return this._reader.preloadBits(bits);
      }
      /**
       * Load uint
       * @param bits number of bits to read
       * @returns uint value
       */
      loadUint(bits) {
        return this._reader.loadUint(bits);
      }
      /**
       * Load uint
       * @param bits number of bits to read
       * @returns uint value
       */
      loadUintBig(bits) {
        return this._reader.loadUintBig(bits);
      }
      /**
       * Preload uint
       * @param bits number of bits to read
       * @returns uint value
       */
      preloadUint(bits) {
        return this._reader.preloadUint(bits);
      }
      /**
       * Preload uint
       * @param bits number of bits to read
       * @returns uint value
       */
      preloadUintBig(bits) {
        return this._reader.preloadUintBig(bits);
      }
      /**
       * Load maybe uint
       * @param bits number of bits to read
       * @returns uint value or null
       */
      loadMaybeUint(bits) {
        if (this.loadBit()) {
          return this.loadUint(bits);
        } else {
          return null;
        }
      }
      /**
       * Load maybe uint
       * @param bits number of bits to read
       * @returns uint value or null
       */
      loadMaybeUintBig(bits) {
        if (this.loadBit()) {
          return this.loadUintBig(bits);
        } else {
          return null;
        }
      }
      /**
       * Load int
       * @param bits number of bits to read
       * @returns int value
       */
      loadInt(bits) {
        return this._reader.loadInt(bits);
      }
      /**
       * Load int
       * @param bits number of bits to read
       * @returns int value
       */
      loadIntBig(bits) {
        return this._reader.loadIntBig(bits);
      }
      /**
       * Preload int
       * @param bits number of bits to read
       * @returns int value
       */
      preloadInt(bits) {
        return this._reader.preloadInt(bits);
      }
      /**
       * Preload int
       * @param bits number of bits to read
       * @returns int value
       */
      preloadIntBig(bits) {
        return this._reader.preloadIntBig(bits);
      }
      /**
       * Load maybe uint
       * @param bits number of bits to read
       * @returns uint value or null
       */
      loadMaybeInt(bits) {
        if (this.loadBit()) {
          return this.loadInt(bits);
        } else {
          return null;
        }
      }
      /**
       * Load maybe uint
       * @param bits number of bits to read
       * @returns uint value or null
       */
      loadMaybeIntBig(bits) {
        if (this.loadBit()) {
          return this.loadIntBig(bits);
        } else {
          return null;
        }
      }
      /**
       * Load varuint
       * @param bits number of bits to read in header
       * @returns varuint value
       */
      loadVarUint(bits) {
        return this._reader.loadVarUint(bits);
      }
      /**
       * Load varuint
       * @param bits number of bits to read in header
       * @returns varuint value
       */
      loadVarUintBig(bits) {
        return this._reader.loadVarUintBig(bits);
      }
      /**
       * Preload varuint
       * @param bits number of bits to read in header
       * @returns varuint value
       */
      preloadVarUint(bits) {
        return this._reader.preloadVarUint(bits);
      }
      /**
       * Preload varuint
       * @param bits number of bits to read in header
       * @returns varuint value
       */
      preloadVarUintBig(bits) {
        return this._reader.preloadVarUintBig(bits);
      }
      /**
       * Load varint
       * @param bits number of bits to read in header
       * @returns varint value
       */
      loadVarInt(bits) {
        return this._reader.loadVarInt(bits);
      }
      /**
       * Load varint
       * @param bits number of bits to read in header
       * @returns varint value
       */
      loadVarIntBig(bits) {
        return this._reader.loadVarIntBig(bits);
      }
      /**
       * Preload varint
       * @param bits number of bits to read in header
       * @returns varint value
       */
      preloadVarInt(bits) {
        return this._reader.preloadVarInt(bits);
      }
      /**
       * Preload varint
       * @param bits number of bits to read in header
       * @returns varint value
       */
      preloadVarIntBig(bits) {
        return this._reader.preloadVarIntBig(bits);
      }
      /**
       * Load coins
       * @returns coins value
       */
      loadCoins() {
        return this._reader.loadCoins();
      }
      /**
       * Preload coins
       * @returns coins value
       */
      preloadCoins() {
        return this._reader.preloadCoins();
      }
      /**
       * Load maybe coins
       * @returns coins value or null
       */
      loadMaybeCoins() {
        if (this._reader.loadBit()) {
          return this._reader.loadCoins();
        } else {
          return null;
        }
      }
      /**
       * Load internal Address
       * @returns Address
       */
      loadAddress() {
        return this._reader.loadAddress();
      }
      /**
       * Load optional internal Address
       * @returns Address or null
       */
      loadMaybeAddress() {
        return this._reader.loadMaybeAddress();
      }
      /**
       * Load external address
       * @returns ExternalAddress
       */
      loadExternalAddress() {
        return this._reader.loadExternalAddress();
      }
      /**
       * Load optional external address
       * @returns ExternalAddress or null
       */
      loadMaybeExternalAddress() {
        return this._reader.loadMaybeExternalAddress();
      }
      /**
       * Load address
       * @returns Address, ExternalAddress or null
       */
      loadAddressAny() {
        return this._reader.loadAddressAny();
      }
      /**
       * Load reference
       * @returns Cell
       */
      loadRef() {
        if (this._refsOffset >= this._refs.length) {
          throw new Error("No more references");
        }
        return this._refs[this._refsOffset++];
      }
      /**
       * Preload reference
       * @returns Cell
       */
      preloadRef() {
        if (this._refsOffset >= this._refs.length) {
          throw new Error("No more references");
        }
        return this._refs[this._refsOffset];
      }
      /**
       * Load optional reference
       * @returns Cell or null
       */
      loadMaybeRef() {
        if (this.loadBit()) {
          return this.loadRef();
        } else {
          return null;
        }
      }
      /**
       * Preload optional reference
       * @returns Cell or null
       */
      preloadMaybeRef() {
        if (this.preloadBit()) {
          return this.preloadRef();
        } else {
          return null;
        }
      }
      /**
       * Load byte buffer
       * @param bytes number of bytes to load
       * @returns Buffer
       */
      loadBuffer(bytes) {
        return this._reader.loadBuffer(bytes);
      }
      /**
       * Load byte buffer
       * @param bytes number of bytes to load
       * @returns Buffer
       */
      preloadBuffer(bytes) {
        return this._reader.preloadBuffer(bytes);
      }
      /**
       * Load string tail
       */
      loadStringTail() {
        return (0, strings_1.readString)(this);
      }
      /**
       * Load maybe string tail
       * @returns string or null
       */
      loadMaybeStringTail() {
        if (this.loadBit()) {
          return (0, strings_1.readString)(this);
        } else {
          return null;
        }
      }
      /**
       * Load string tail from ref
       * @returns string
       */
      loadStringRefTail() {
        return (0, strings_1.readString)(this.loadRef().beginParse());
      }
      /**
       * Load maybe string tail from ref
       * @returns string or null
       */
      loadMaybeStringRefTail() {
        const ref = this.loadMaybeRef();
        if (ref) {
          return (0, strings_1.readString)(ref.beginParse());
        } else {
          return null;
        }
      }
      /**
       * Loads dictionary
       * @param key key description
       * @param value value description
       * @returns Dictionary<K, V>
       */
      loadDict(key, value) {
        return Dictionary_1.Dictionary.load(key, value, this);
      }
      /**
       * Loads dictionary directly from current slice
       * @param key key description
       * @param value value description
       * @returns Dictionary<K, V>
       */
      loadDictDirect(key, value) {
        return Dictionary_1.Dictionary.loadDirect(key, value, this);
      }
      /**
       * Checks if slice is empty
       */
      endParse() {
        if (this.remainingBits > 0 || this.remainingRefs > 0) {
          throw new Error("Slice is not empty");
        }
      }
      /**
       * Convert slice to cell
       */
      asCell() {
        return (0, Builder_1.beginCell)().storeSlice(this).endCell();
      }
      /**
       *
       * @returns
       */
      asBuilder() {
        return (0, Builder_1.beginCell)().storeSlice(this);
      }
      /**
       * Clone slice
       * @returns cloned slice
       */
      clone(fromStart = false) {
        if (fromStart) {
          let reader = this._reader.clone();
          reader.reset();
          return new _Slice(reader, this._refs);
        } else {
          let res = new _Slice(this._reader, this._refs);
          res._refsOffset = this._refsOffset;
          return res;
        }
      }
      /**
       * Print slice as string by converting it to cell
       * @returns string
       */
      toString() {
        return this.asCell().toString();
      }
    };
    exports.Slice = Slice2;
    _a = symbol_inspect_1.default;
  }
});

// node_modules/@ton/core/dist/boc/cell/exoticLibrary.js
var require_exoticLibrary = __commonJS({
  "node_modules/@ton/core/dist/boc/cell/exoticLibrary.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.exoticLibrary = void 0;
    var BitReader_1 = require_BitReader();
    function exoticLibrary(bits, refs) {
      const reader = new BitReader_1.BitReader(bits);
      const size = 8 + 256;
      if (bits.length !== size) {
        throw new Error(`Library cell must have exactly (8 + 256) bits, got "${bits.length}"`);
      }
      let type = reader.loadUint(8);
      if (type !== 2) {
        throw new Error(`Library cell must have type 2, got "${type}"`);
      }
      return {};
    }
    exports.exoticLibrary = exoticLibrary;
  }
});

// node_modules/@ton/core/dist/boc/cell/exoticMerkleUpdate.js
var require_exoticMerkleUpdate = __commonJS({
  "node_modules/@ton/core/dist/boc/cell/exoticMerkleUpdate.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.exoticMerkleUpdate = void 0;
    var BitReader_1 = require_BitReader();
    function exoticMerkleUpdate(bits, refs) {
      const reader = new BitReader_1.BitReader(bits);
      const size = 8 + 2 * (256 + 16);
      if (bits.length !== size) {
        throw new Error(`Merkle Update cell must have exactly (8 + (2 * (256 + 16))) bits, got "${bits.length}"`);
      }
      if (refs.length !== 2) {
        throw new Error(`Merkle Update cell must have exactly 2 refs, got "${refs.length}"`);
      }
      let type = reader.loadUint(8);
      if (type !== 4) {
        throw new Error(`Merkle Update cell type must be exactly 4, got "${type}"`);
      }
      const proofHash1 = reader.loadBuffer(32);
      const proofHash2 = reader.loadBuffer(32);
      const proofDepth1 = reader.loadUint(16);
      const proofDepth2 = reader.loadUint(16);
      if (proofDepth1 !== refs[0].depth(0)) {
        throw new Error(`Merkle Update cell ref depth must be exactly "${proofDepth1}", got "${refs[0].depth(0)}"`);
      }
      if (!proofHash1.equals(refs[0].hash(0))) {
        throw new Error(`Merkle Update cell ref hash must be exactly "${proofHash1.toString("hex")}", got "${refs[0].hash(0).toString("hex")}"`);
      }
      if (proofDepth2 !== refs[1].depth(0)) {
        throw new Error(`Merkle Update cell ref depth must be exactly "${proofDepth2}", got "${refs[1].depth(0)}"`);
      }
      if (!proofHash2.equals(refs[1].hash(0))) {
        throw new Error(`Merkle Update cell ref hash must be exactly "${proofHash2.toString("hex")}", got "${refs[1].hash(0).toString("hex")}"`);
      }
      return {
        proofDepth1,
        proofDepth2,
        proofHash1,
        proofHash2
      };
    }
    exports.exoticMerkleUpdate = exoticMerkleUpdate;
  }
});

// node_modules/@ton/core/dist/boc/cell/LevelMask.js
var require_LevelMask = __commonJS({
  "node_modules/@ton/core/dist/boc/cell/LevelMask.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.LevelMask = void 0;
    var LevelMask = class _LevelMask {
      constructor(mask = 0) {
        this._mask = 0;
        this._mask = mask;
        this._hashIndex = countSetBits(this._mask);
        this._hashCount = this._hashIndex + 1;
      }
      get value() {
        return this._mask;
      }
      get level() {
        return 32 - Math.clz32(this._mask);
      }
      get hashIndex() {
        return this._hashIndex;
      }
      get hashCount() {
        return this._hashCount;
      }
      apply(level) {
        return new _LevelMask(this._mask & (1 << level) - 1);
      }
      isSignificant(level) {
        let res = level === 0 || (this._mask >> level - 1) % 2 !== 0;
        return res;
      }
    };
    exports.LevelMask = LevelMask;
    function countSetBits(n) {
      n = n - (n >> 1 & 1431655765);
      n = (n & 858993459) + (n >> 2 & 858993459);
      return (n + (n >> 4) & 252645135) * 16843009 >> 24;
    }
  }
});

// node_modules/@ton/core/dist/boc/cell/exoticPruned.js
var require_exoticPruned = __commonJS({
  "node_modules/@ton/core/dist/boc/cell/exoticPruned.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.exoticPruned = void 0;
    var BitReader_1 = require_BitReader();
    var LevelMask_1 = require_LevelMask();
    function exoticPruned(bits, refs) {
      let reader = new BitReader_1.BitReader(bits);
      let type = reader.loadUint(8);
      if (type !== 1) {
        throw new Error(`Pruned branch cell must have type 1, got "${type}"`);
      }
      if (refs.length !== 0) {
        throw new Error(`Pruned Branch cell can't has refs, got "${refs.length}"`);
      }
      let mask;
      if (bits.length === 280) {
        mask = new LevelMask_1.LevelMask(1);
      } else {
        mask = new LevelMask_1.LevelMask(reader.loadUint(8));
        if (mask.level < 1 || mask.level > 3) {
          throw new Error(`Pruned Branch cell level must be >= 1 and <= 3, got "${mask.level}/${mask.value}"`);
        }
        const size = 8 + 8 + mask.apply(mask.level - 1).hashCount * (256 + 16);
        if (bits.length !== size) {
          throw new Error(`Pruned branch cell must have exactly ${size} bits, got "${bits.length}"`);
        }
      }
      let pruned = [];
      let hashes = [];
      let depths = [];
      for (let i = 0; i < mask.level; i++) {
        hashes.push(reader.loadBuffer(32));
      }
      for (let i = 0; i < mask.level; i++) {
        depths.push(reader.loadUint(16));
      }
      for (let i = 0; i < mask.level; i++) {
        pruned.push({
          depth: depths[i],
          hash: hashes[i]
        });
      }
      return {
        mask: mask.value,
        pruned
      };
    }
    exports.exoticPruned = exoticPruned;
  }
});

// node_modules/@ton/core/dist/boc/cell/resolveExotic.js
var require_resolveExotic = __commonJS({
  "node_modules/@ton/core/dist/boc/cell/resolveExotic.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.resolveExotic = void 0;
    var BitReader_1 = require_BitReader();
    var CellType_1 = require_CellType();
    var exoticLibrary_1 = require_exoticLibrary();
    var exoticMerkleProof_1 = require_exoticMerkleProof();
    var exoticMerkleUpdate_1 = require_exoticMerkleUpdate();
    var exoticPruned_1 = require_exoticPruned();
    var LevelMask_1 = require_LevelMask();
    function resolvePruned(bits, refs) {
      let pruned = (0, exoticPruned_1.exoticPruned)(bits, refs);
      let depths = [];
      let hashes = [];
      let mask = new LevelMask_1.LevelMask(pruned.mask);
      for (let i = 0; i < pruned.pruned.length; i++) {
        depths.push(pruned.pruned[i].depth);
        hashes.push(pruned.pruned[i].hash);
      }
      return {
        type: CellType_1.CellType.PrunedBranch,
        depths,
        hashes,
        mask
      };
    }
    function resolveLibrary(bits, refs) {
      let pruned = (0, exoticLibrary_1.exoticLibrary)(bits, refs);
      let depths = [];
      let hashes = [];
      let mask = new LevelMask_1.LevelMask();
      return {
        type: CellType_1.CellType.Library,
        depths,
        hashes,
        mask
      };
    }
    function resolveMerkleProof(bits, refs) {
      let merkleProof = (0, exoticMerkleProof_1.exoticMerkleProof)(bits, refs);
      let depths = [];
      let hashes = [];
      let mask = new LevelMask_1.LevelMask(refs[0].level() >> 1);
      return {
        type: CellType_1.CellType.MerkleProof,
        depths,
        hashes,
        mask
      };
    }
    function resolveMerkleUpdate(bits, refs) {
      let merkleUpdate = (0, exoticMerkleUpdate_1.exoticMerkleUpdate)(bits, refs);
      let depths = [];
      let hashes = [];
      let mask = new LevelMask_1.LevelMask((refs[0].level() | refs[1].level()) >> 1);
      return {
        type: CellType_1.CellType.MerkleUpdate,
        depths,
        hashes,
        mask
      };
    }
    function resolveExotic(bits, refs) {
      let reader = new BitReader_1.BitReader(bits);
      let type = reader.preloadUint(8);
      if (type === 1) {
        return resolvePruned(bits, refs);
      }
      if (type === 2) {
        return resolveLibrary(bits, refs);
      }
      if (type === 3) {
        return resolveMerkleProof(bits, refs);
      }
      if (type === 4) {
        return resolveMerkleUpdate(bits, refs);
      }
      throw Error("Invalid exotic cell type: " + type);
    }
    exports.resolveExotic = resolveExotic;
  }
});

// node_modules/@ton/core/dist/boc/cell/descriptor.js
var require_descriptor = __commonJS({
  "node_modules/@ton/core/dist/boc/cell/descriptor.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getRepr = exports.getBitsDescriptor = exports.getRefsDescriptor = void 0;
    var CellType_1 = require_CellType();
    var paddedBits_1 = require_paddedBits();
    function getRefsDescriptor(refs, levelMask, type) {
      return refs.length + (type !== CellType_1.CellType.Ordinary ? 1 : 0) * 8 + levelMask * 32;
    }
    exports.getRefsDescriptor = getRefsDescriptor;
    function getBitsDescriptor(bits) {
      let len = bits.length;
      return Math.ceil(len / 8) + Math.floor(len / 8);
    }
    exports.getBitsDescriptor = getBitsDescriptor;
    function getRepr(originalBits, bits, refs, level, levelMask, type) {
      const bitsLen = Math.ceil(bits.length / 8);
      const repr = Buffer.alloc(2 + bitsLen + (2 + 32) * refs.length);
      let reprCursor = 0;
      repr[reprCursor++] = getRefsDescriptor(refs, levelMask, type);
      repr[reprCursor++] = getBitsDescriptor(originalBits);
      (0, paddedBits_1.bitsToPaddedBuffer)(bits).copy(repr, reprCursor);
      reprCursor += bitsLen;
      for (const c of refs) {
        let childDepth;
        if (type == CellType_1.CellType.MerkleProof || type == CellType_1.CellType.MerkleUpdate) {
          childDepth = c.depth(level + 1);
        } else {
          childDepth = c.depth(level);
        }
        repr[reprCursor++] = Math.floor(childDepth / 256);
        repr[reprCursor++] = childDepth % 256;
      }
      for (const c of refs) {
        let childHash;
        if (type == CellType_1.CellType.MerkleProof || type == CellType_1.CellType.MerkleUpdate) {
          childHash = c.hash(level + 1);
        } else {
          childHash = c.hash(level);
        }
        childHash.copy(repr, reprCursor);
        reprCursor += 32;
      }
      return repr;
    }
    exports.getRepr = getRepr;
  }
});

// node_modules/jssha/dist/sha.js
var require_sha = __commonJS({
  "node_modules/jssha/dist/sha.js"(exports, module) {
    !(function(n, r) {
      "object" == typeof exports && "undefined" != typeof module ? module.exports = r() : "function" == typeof define && define.amd ? define(r) : (n = "undefined" != typeof globalThis ? globalThis : n || self).jsSHA = r();
    })(exports, (function() {
      "use strict";
      var n = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      function r(n2, r2, t2, e2) {
        var i2, o2, u2, f2 = r2 || [0], w2 = (t2 = t2 || 0) >>> 3, s2 = -1 === e2 ? 3 : 0;
        for (i2 = 0; i2 < n2.length; i2 += 1) o2 = (u2 = i2 + w2) >>> 2, f2.length <= o2 && f2.push(0), f2[o2] |= n2[i2] << 8 * (s2 + e2 * (u2 % 4));
        return { value: f2, binLen: 8 * n2.length + t2 };
      }
      function t(t2, e2, i2) {
        switch (e2) {
          case "UTF8":
          case "UTF16BE":
          case "UTF16LE":
            break;
          default:
            throw new Error("encoding must be UTF8, UTF16BE, or UTF16LE");
        }
        switch (t2) {
          case "HEX":
            return function(n2, r2, t3) {
              return (function(n3, r3, t4, e3) {
                var i3, o2, u2, f2;
                if (0 != n3.length % 2) throw new Error("String of HEX type must be in byte increments");
                var w2 = r3 || [0], s2 = (t4 = t4 || 0) >>> 3, a2 = -1 === e3 ? 3 : 0;
                for (i3 = 0; i3 < n3.length; i3 += 2) {
                  if (o2 = parseInt(n3.substr(i3, 2), 16), isNaN(o2)) throw new Error("String of HEX type contains invalid characters");
                  for (u2 = (f2 = (i3 >>> 1) + s2) >>> 2; w2.length <= u2; ) w2.push(0);
                  w2[u2] |= o2 << 8 * (a2 + e3 * (f2 % 4));
                }
                return { value: w2, binLen: 4 * n3.length + t4 };
              })(n2, r2, t3, i2);
            };
          case "TEXT":
            return function(n2, r2, t3) {
              return (function(n3, r3, t4, e3, i3) {
                var o2, u2, f2, w2, s2, a2, h2, c2, v2 = 0, A2 = t4 || [0], E2 = (e3 = e3 || 0) >>> 3;
                if ("UTF8" === r3) for (h2 = -1 === i3 ? 3 : 0, f2 = 0; f2 < n3.length; f2 += 1) for (u2 = [], 128 > (o2 = n3.charCodeAt(f2)) ? u2.push(o2) : 2048 > o2 ? (u2.push(192 | o2 >>> 6), u2.push(128 | 63 & o2)) : 55296 > o2 || 57344 <= o2 ? u2.push(224 | o2 >>> 12, 128 | o2 >>> 6 & 63, 128 | 63 & o2) : (f2 += 1, o2 = 65536 + ((1023 & o2) << 10 | 1023 & n3.charCodeAt(f2)), u2.push(240 | o2 >>> 18, 128 | o2 >>> 12 & 63, 128 | o2 >>> 6 & 63, 128 | 63 & o2)), w2 = 0; w2 < u2.length; w2 += 1) {
                  for (s2 = (a2 = v2 + E2) >>> 2; A2.length <= s2; ) A2.push(0);
                  A2[s2] |= u2[w2] << 8 * (h2 + i3 * (a2 % 4)), v2 += 1;
                }
                else for (h2 = -1 === i3 ? 2 : 0, c2 = "UTF16LE" === r3 && 1 !== i3 || "UTF16LE" !== r3 && 1 === i3, f2 = 0; f2 < n3.length; f2 += 1) {
                  for (o2 = n3.charCodeAt(f2), true === c2 && (o2 = (w2 = 255 & o2) << 8 | o2 >>> 8), s2 = (a2 = v2 + E2) >>> 2; A2.length <= s2; ) A2.push(0);
                  A2[s2] |= o2 << 8 * (h2 + i3 * (a2 % 4)), v2 += 2;
                }
                return { value: A2, binLen: 8 * v2 + e3 };
              })(n2, e2, r2, t3, i2);
            };
          case "B64":
            return function(r2, t3, e3) {
              return (function(r3, t4, e4, i3) {
                var o2, u2, f2, w2, s2, a2, h2 = 0, c2 = t4 || [0], v2 = (e4 = e4 || 0) >>> 3, A2 = -1 === i3 ? 3 : 0, E2 = r3.indexOf("=");
                if (-1 === r3.search(/^[a-zA-Z0-9=+/]+$/)) throw new Error("Invalid character in base-64 string");
                if (r3 = r3.replace(/=/g, ""), -1 !== E2 && E2 < r3.length) throw new Error("Invalid '=' found in base-64 string");
                for (o2 = 0; o2 < r3.length; o2 += 4) {
                  for (w2 = r3.substr(o2, 4), f2 = 0, u2 = 0; u2 < w2.length; u2 += 1) f2 |= n.indexOf(w2.charAt(u2)) << 18 - 6 * u2;
                  for (u2 = 0; u2 < w2.length - 1; u2 += 1) {
                    for (s2 = (a2 = h2 + v2) >>> 2; c2.length <= s2; ) c2.push(0);
                    c2[s2] |= (f2 >>> 16 - 8 * u2 & 255) << 8 * (A2 + i3 * (a2 % 4)), h2 += 1;
                  }
                }
                return { value: c2, binLen: 8 * h2 + e4 };
              })(r2, t3, e3, i2);
            };
          case "BYTES":
            return function(n2, r2, t3) {
              return (function(n3, r3, t4, e3) {
                var i3, o2, u2, f2, w2 = r3 || [0], s2 = (t4 = t4 || 0) >>> 3, a2 = -1 === e3 ? 3 : 0;
                for (o2 = 0; o2 < n3.length; o2 += 1) i3 = n3.charCodeAt(o2), u2 = (f2 = o2 + s2) >>> 2, w2.length <= u2 && w2.push(0), w2[u2] |= i3 << 8 * (a2 + e3 * (f2 % 4));
                return { value: w2, binLen: 8 * n3.length + t4 };
              })(n2, r2, t3, i2);
            };
          case "ARRAYBUFFER":
            try {
              new ArrayBuffer(0);
            } catch (n2) {
              throw new Error("ARRAYBUFFER not supported by this environment");
            }
            return function(n2, t3, e3) {
              return (function(n3, t4, e4, i3) {
                return r(new Uint8Array(n3), t4, e4, i3);
              })(n2, t3, e3, i2);
            };
          case "UINT8ARRAY":
            try {
              new Uint8Array(0);
            } catch (n2) {
              throw new Error("UINT8ARRAY not supported by this environment");
            }
            return function(n2, t3, e3) {
              return r(n2, t3, e3, i2);
            };
          default:
            throw new Error("format must be HEX, TEXT, B64, BYTES, ARRAYBUFFER, or UINT8ARRAY");
        }
      }
      function e(r2, t2, e2, i2) {
        switch (r2) {
          case "HEX":
            return function(n2) {
              return (function(n3, r3, t3, e3) {
                var i3, o2, u2 = "", f2 = r3 / 8, w2 = -1 === t3 ? 3 : 0;
                for (i3 = 0; i3 < f2; i3 += 1) o2 = n3[i3 >>> 2] >>> 8 * (w2 + t3 * (i3 % 4)), u2 += "0123456789abcdef".charAt(o2 >>> 4 & 15) + "0123456789abcdef".charAt(15 & o2);
                return e3.outputUpper ? u2.toUpperCase() : u2;
              })(n2, t2, e2, i2);
            };
          case "B64":
            return function(r3) {
              return (function(r4, t3, e3, i3) {
                var o2, u2, f2, w2, s2, a2 = "", h2 = t3 / 8, c2 = -1 === e3 ? 3 : 0;
                for (o2 = 0; o2 < h2; o2 += 3) for (w2 = o2 + 1 < h2 ? r4[o2 + 1 >>> 2] : 0, s2 = o2 + 2 < h2 ? r4[o2 + 2 >>> 2] : 0, f2 = (r4[o2 >>> 2] >>> 8 * (c2 + e3 * (o2 % 4)) & 255) << 16 | (w2 >>> 8 * (c2 + e3 * ((o2 + 1) % 4)) & 255) << 8 | s2 >>> 8 * (c2 + e3 * ((o2 + 2) % 4)) & 255, u2 = 0; u2 < 4; u2 += 1) a2 += 8 * o2 + 6 * u2 <= t3 ? n.charAt(f2 >>> 6 * (3 - u2) & 63) : i3.b64Pad;
                return a2;
              })(r3, t2, e2, i2);
            };
          case "BYTES":
            return function(n2) {
              return (function(n3, r3, t3) {
                var e3, i3, o2 = "", u2 = r3 / 8, f2 = -1 === t3 ? 3 : 0;
                for (e3 = 0; e3 < u2; e3 += 1) i3 = n3[e3 >>> 2] >>> 8 * (f2 + t3 * (e3 % 4)) & 255, o2 += String.fromCharCode(i3);
                return o2;
              })(n2, t2, e2);
            };
          case "ARRAYBUFFER":
            try {
              new ArrayBuffer(0);
            } catch (n2) {
              throw new Error("ARRAYBUFFER not supported by this environment");
            }
            return function(n2) {
              return (function(n3, r3, t3) {
                var e3, i3 = r3 / 8, o2 = new ArrayBuffer(i3), u2 = new Uint8Array(o2), f2 = -1 === t3 ? 3 : 0;
                for (e3 = 0; e3 < i3; e3 += 1) u2[e3] = n3[e3 >>> 2] >>> 8 * (f2 + t3 * (e3 % 4)) & 255;
                return o2;
              })(n2, t2, e2);
            };
          case "UINT8ARRAY":
            try {
              new Uint8Array(0);
            } catch (n2) {
              throw new Error("UINT8ARRAY not supported by this environment");
            }
            return function(n2) {
              return (function(n3, r3, t3) {
                var e3, i3 = r3 / 8, o2 = -1 === t3 ? 3 : 0, u2 = new Uint8Array(i3);
                for (e3 = 0; e3 < i3; e3 += 1) u2[e3] = n3[e3 >>> 2] >>> 8 * (o2 + t3 * (e3 % 4)) & 255;
                return u2;
              })(n2, t2, e2);
            };
          default:
            throw new Error("format must be HEX, B64, BYTES, ARRAYBUFFER, or UINT8ARRAY");
        }
      }
      var i = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298], o = [3238371032, 914150663, 812702999, 4144912697, 4290775857, 1750603025, 1694076839, 3204075428], u = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225], f = "Chosen SHA variant is not supported";
      function w(n2, r2) {
        var t2, e2, i2 = n2.binLen >>> 3, o2 = r2.binLen >>> 3, u2 = i2 << 3, f2 = 4 - i2 << 3;
        if (i2 % 4 != 0) {
          for (t2 = 0; t2 < o2; t2 += 4) e2 = i2 + t2 >>> 2, n2.value[e2] |= r2.value[t2 >>> 2] << u2, n2.value.push(0), n2.value[e2 + 1] |= r2.value[t2 >>> 2] >>> f2;
          return (n2.value.length << 2) - 4 >= o2 + i2 && n2.value.pop(), { value: n2.value, binLen: n2.binLen + r2.binLen };
        }
        return { value: n2.value.concat(r2.value), binLen: n2.binLen + r2.binLen };
      }
      function s(n2) {
        var r2 = { outputUpper: false, b64Pad: "=", outputLen: -1 }, t2 = n2 || {}, e2 = "Output length must be a multiple of 8";
        if (r2.outputUpper = t2.outputUpper || false, t2.b64Pad && (r2.b64Pad = t2.b64Pad), t2.outputLen) {
          if (t2.outputLen % 8 != 0) throw new Error(e2);
          r2.outputLen = t2.outputLen;
        } else if (t2.shakeLen) {
          if (t2.shakeLen % 8 != 0) throw new Error(e2);
          r2.outputLen = t2.shakeLen;
        }
        if ("boolean" != typeof r2.outputUpper) throw new Error("Invalid outputUpper formatting option");
        if ("string" != typeof r2.b64Pad) throw new Error("Invalid b64Pad formatting option");
        return r2;
      }
      function a(n2, r2, e2, i2) {
        var o2 = n2 + " must include a value and format";
        if (!r2) {
          if (!i2) throw new Error(o2);
          return i2;
        }
        if (void 0 === r2.value || !r2.format) throw new Error(o2);
        return t(r2.format, r2.encoding || "UTF8", e2)(r2.value);
      }
      var h = (function() {
        function n2(n3, r2, t2) {
          var e2 = t2 || {};
          if (this.t = r2, this.i = e2.encoding || "UTF8", this.numRounds = e2.numRounds || 1, isNaN(this.numRounds) || this.numRounds !== parseInt(this.numRounds, 10) || 1 > this.numRounds) throw new Error("numRounds must a integer >= 1");
          this.o = n3, this.u = [], this.s = 0, this.h = false, this.v = 0, this.A = false, this.l = [], this.H = [];
        }
        return n2.prototype.update = function(n3) {
          var r2, t2 = 0, e2 = this.S >>> 5, i2 = this.p(n3, this.u, this.s), o2 = i2.binLen, u2 = i2.value, f2 = o2 >>> 5;
          for (r2 = 0; r2 < f2; r2 += e2) t2 + this.S <= o2 && (this.m = this.R(u2.slice(r2, r2 + e2), this.m), t2 += this.S);
          this.v += t2, this.u = u2.slice(t2 >>> 5), this.s = o2 % this.S, this.h = true;
        }, n2.prototype.getHash = function(n3, r2) {
          var t2, i2, o2 = this.U, u2 = s(r2);
          if (this.T) {
            if (-1 === u2.outputLen) throw new Error("Output length must be specified in options");
            o2 = u2.outputLen;
          }
          var f2 = e(n3, o2, this.C, u2);
          if (this.A && this.F) return f2(this.F(u2));
          for (i2 = this.K(this.u.slice(), this.s, this.v, this.B(this.m), o2), t2 = 1; t2 < this.numRounds; t2 += 1) this.T && o2 % 32 != 0 && (i2[i2.length - 1] &= 16777215 >>> 24 - o2 % 32), i2 = this.K(i2, o2, 0, this.L(this.o), o2);
          return f2(i2);
        }, n2.prototype.setHMACKey = function(n3, r2, e2) {
          if (!this.g) throw new Error("Variant does not support HMAC");
          if (this.h) throw new Error("Cannot set MAC key after calling update");
          var i2 = t(r2, (e2 || {}).encoding || "UTF8", this.C);
          this.k(i2(n3));
        }, n2.prototype.k = function(n3) {
          var r2, t2 = this.S >>> 3, e2 = t2 / 4 - 1;
          if (1 !== this.numRounds) throw new Error("Cannot set numRounds with MAC");
          if (this.A) throw new Error("MAC key already set");
          for (t2 < n3.binLen / 8 && (n3.value = this.K(n3.value, n3.binLen, 0, this.L(this.o), this.U)); n3.value.length <= e2; ) n3.value.push(0);
          for (r2 = 0; r2 <= e2; r2 += 1) this.l[r2] = 909522486 ^ n3.value[r2], this.H[r2] = 1549556828 ^ n3.value[r2];
          this.m = this.R(this.l, this.m), this.v = this.S, this.A = true;
        }, n2.prototype.getHMAC = function(n3, r2) {
          var t2 = s(r2);
          return e(n3, this.U, this.C, t2)(this.Y());
        }, n2.prototype.Y = function() {
          var n3;
          if (!this.A) throw new Error("Cannot call getHMAC without first setting MAC key");
          var r2 = this.K(this.u.slice(), this.s, this.v, this.B(this.m), this.U);
          return n3 = this.R(this.H, this.L(this.o)), n3 = this.K(r2, this.U, this.S, n3, this.U);
        }, n2;
      })(), c = function(n2, r2) {
        return (c = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(n3, r3) {
          n3.__proto__ = r3;
        } || function(n3, r3) {
          for (var t2 in r3) Object.prototype.hasOwnProperty.call(r3, t2) && (n3[t2] = r3[t2]);
        })(n2, r2);
      };
      function v(n2, r2) {
        function t2() {
          this.constructor = n2;
        }
        c(n2, r2), n2.prototype = null === r2 ? Object.create(r2) : (t2.prototype = r2.prototype, new t2());
      }
      function A(n2, r2) {
        return n2 << r2 | n2 >>> 32 - r2;
      }
      function E(n2, r2) {
        return n2 >>> r2 | n2 << 32 - r2;
      }
      function l(n2, r2) {
        return n2 >>> r2;
      }
      function b(n2, r2, t2) {
        return n2 ^ r2 ^ t2;
      }
      function H(n2, r2, t2) {
        return n2 & r2 ^ ~n2 & t2;
      }
      function d(n2, r2, t2) {
        return n2 & r2 ^ n2 & t2 ^ r2 & t2;
      }
      function S(n2) {
        return E(n2, 2) ^ E(n2, 13) ^ E(n2, 22);
      }
      function p(n2, r2) {
        var t2 = (65535 & n2) + (65535 & r2);
        return (65535 & (n2 >>> 16) + (r2 >>> 16) + (t2 >>> 16)) << 16 | 65535 & t2;
      }
      function m(n2, r2, t2, e2) {
        var i2 = (65535 & n2) + (65535 & r2) + (65535 & t2) + (65535 & e2);
        return (65535 & (n2 >>> 16) + (r2 >>> 16) + (t2 >>> 16) + (e2 >>> 16) + (i2 >>> 16)) << 16 | 65535 & i2;
      }
      function y(n2, r2, t2, e2, i2) {
        var o2 = (65535 & n2) + (65535 & r2) + (65535 & t2) + (65535 & e2) + (65535 & i2);
        return (65535 & (n2 >>> 16) + (r2 >>> 16) + (t2 >>> 16) + (e2 >>> 16) + (i2 >>> 16) + (o2 >>> 16)) << 16 | 65535 & o2;
      }
      function R(n2) {
        return E(n2, 7) ^ E(n2, 18) ^ l(n2, 3);
      }
      function U(n2) {
        return E(n2, 6) ^ E(n2, 11) ^ E(n2, 25);
      }
      function T(n2) {
        return [1732584193, 4023233417, 2562383102, 271733878, 3285377520];
      }
      function C(n2, r2) {
        var t2, e2, i2, o2, u2, f2, w2, s2 = [];
        for (t2 = r2[0], e2 = r2[1], i2 = r2[2], o2 = r2[3], u2 = r2[4], w2 = 0; w2 < 80; w2 += 1) s2[w2] = w2 < 16 ? n2[w2] : A(s2[w2 - 3] ^ s2[w2 - 8] ^ s2[w2 - 14] ^ s2[w2 - 16], 1), f2 = w2 < 20 ? y(A(t2, 5), H(e2, i2, o2), u2, 1518500249, s2[w2]) : w2 < 40 ? y(A(t2, 5), b(e2, i2, o2), u2, 1859775393, s2[w2]) : w2 < 60 ? y(A(t2, 5), d(e2, i2, o2), u2, 2400959708, s2[w2]) : y(A(t2, 5), b(e2, i2, o2), u2, 3395469782, s2[w2]), u2 = o2, o2 = i2, i2 = A(e2, 30), e2 = t2, t2 = f2;
        return r2[0] = p(t2, r2[0]), r2[1] = p(e2, r2[1]), r2[2] = p(i2, r2[2]), r2[3] = p(o2, r2[3]), r2[4] = p(u2, r2[4]), r2;
      }
      function F(n2, r2, t2, e2) {
        for (var i2, o2 = 15 + (r2 + 65 >>> 9 << 4), u2 = r2 + t2; n2.length <= o2; ) n2.push(0);
        for (n2[r2 >>> 5] |= 128 << 24 - r2 % 32, n2[o2] = 4294967295 & u2, n2[o2 - 1] = u2 / 4294967296 | 0, i2 = 0; i2 < n2.length; i2 += 16) e2 = C(n2.slice(i2, i2 + 16), e2);
        return e2;
      }
      var K = (function(n2) {
        function r2(r3, e2, i2) {
          var o2 = this;
          if ("SHA-1" !== r3) throw new Error(f);
          var u2 = i2 || {};
          return (o2 = n2.call(this, r3, e2, i2) || this).g = true, o2.F = o2.Y, o2.C = -1, o2.p = t(o2.t, o2.i, o2.C), o2.R = C, o2.B = function(n3) {
            return n3.slice();
          }, o2.L = T, o2.K = F, o2.m = [1732584193, 4023233417, 2562383102, 271733878, 3285377520], o2.S = 512, o2.U = 160, o2.T = false, u2.hmacKey && o2.k(a("hmacKey", u2.hmacKey, o2.C)), o2;
        }
        return v(r2, n2), r2;
      })(h);
      function B(n2) {
        return "SHA-224" == n2 ? o.slice() : u.slice();
      }
      function L(n2, r2) {
        var t2, e2, o2, u2, f2, w2, s2, a2, h2, c2, v2, A2, b2 = [];
        for (t2 = r2[0], e2 = r2[1], o2 = r2[2], u2 = r2[3], f2 = r2[4], w2 = r2[5], s2 = r2[6], a2 = r2[7], v2 = 0; v2 < 64; v2 += 1) b2[v2] = v2 < 16 ? n2[v2] : m(E(A2 = b2[v2 - 2], 17) ^ E(A2, 19) ^ l(A2, 10), b2[v2 - 7], R(b2[v2 - 15]), b2[v2 - 16]), h2 = y(a2, U(f2), H(f2, w2, s2), i[v2], b2[v2]), c2 = p(S(t2), d(t2, e2, o2)), a2 = s2, s2 = w2, w2 = f2, f2 = p(u2, h2), u2 = o2, o2 = e2, e2 = t2, t2 = p(h2, c2);
        return r2[0] = p(t2, r2[0]), r2[1] = p(e2, r2[1]), r2[2] = p(o2, r2[2]), r2[3] = p(u2, r2[3]), r2[4] = p(f2, r2[4]), r2[5] = p(w2, r2[5]), r2[6] = p(s2, r2[6]), r2[7] = p(a2, r2[7]), r2;
      }
      var g = (function(n2) {
        function r2(r3, e2, i2) {
          var o2 = this;
          if ("SHA-224" !== r3 && "SHA-256" !== r3) throw new Error(f);
          var u2 = i2 || {};
          return (o2 = n2.call(this, r3, e2, i2) || this).F = o2.Y, o2.g = true, o2.C = -1, o2.p = t(o2.t, o2.i, o2.C), o2.R = L, o2.B = function(n3) {
            return n3.slice();
          }, o2.L = B, o2.K = function(n3, t2, e3, i3) {
            return (function(n4, r4, t3, e4, i4) {
              for (var o3, u3 = 15 + (r4 + 65 >>> 9 << 4), f2 = r4 + t3; n4.length <= u3; ) n4.push(0);
              for (n4[r4 >>> 5] |= 128 << 24 - r4 % 32, n4[u3] = 4294967295 & f2, n4[u3 - 1] = f2 / 4294967296 | 0, o3 = 0; o3 < n4.length; o3 += 16) e4 = L(n4.slice(o3, o3 + 16), e4);
              return "SHA-224" === i4 ? [e4[0], e4[1], e4[2], e4[3], e4[4], e4[5], e4[6]] : e4;
            })(n3, t2, e3, i3, r3);
          }, o2.m = B(r3), o2.S = 512, o2.U = "SHA-224" === r3 ? 224 : 256, o2.T = false, u2.hmacKey && o2.k(a("hmacKey", u2.hmacKey, o2.C)), o2;
        }
        return v(r2, n2), r2;
      })(h), k = function(n2, r2) {
        this.N = n2, this.I = r2;
      };
      function Y(n2, r2) {
        var t2;
        return r2 > 32 ? (t2 = 64 - r2, new k(n2.I << r2 | n2.N >>> t2, n2.N << r2 | n2.I >>> t2)) : 0 !== r2 ? (t2 = 32 - r2, new k(n2.N << r2 | n2.I >>> t2, n2.I << r2 | n2.N >>> t2)) : n2;
      }
      function N(n2, r2) {
        var t2;
        return r2 < 32 ? (t2 = 32 - r2, new k(n2.N >>> r2 | n2.I << t2, n2.I >>> r2 | n2.N << t2)) : (t2 = 64 - r2, new k(n2.I >>> r2 | n2.N << t2, n2.N >>> r2 | n2.I << t2));
      }
      function I(n2, r2) {
        return new k(n2.N >>> r2, n2.I >>> r2 | n2.N << 32 - r2);
      }
      function M(n2, r2, t2) {
        return new k(n2.N & r2.N ^ ~n2.N & t2.N, n2.I & r2.I ^ ~n2.I & t2.I);
      }
      function X(n2, r2, t2) {
        return new k(n2.N & r2.N ^ n2.N & t2.N ^ r2.N & t2.N, n2.I & r2.I ^ n2.I & t2.I ^ r2.I & t2.I);
      }
      function z(n2) {
        var r2 = N(n2, 28), t2 = N(n2, 34), e2 = N(n2, 39);
        return new k(r2.N ^ t2.N ^ e2.N, r2.I ^ t2.I ^ e2.I);
      }
      function O(n2, r2) {
        var t2, e2;
        t2 = (65535 & n2.I) + (65535 & r2.I);
        var i2 = (65535 & (e2 = (n2.I >>> 16) + (r2.I >>> 16) + (t2 >>> 16))) << 16 | 65535 & t2;
        return t2 = (65535 & n2.N) + (65535 & r2.N) + (e2 >>> 16), e2 = (n2.N >>> 16) + (r2.N >>> 16) + (t2 >>> 16), new k((65535 & e2) << 16 | 65535 & t2, i2);
      }
      function j(n2, r2, t2, e2) {
        var i2, o2;
        i2 = (65535 & n2.I) + (65535 & r2.I) + (65535 & t2.I) + (65535 & e2.I);
        var u2 = (65535 & (o2 = (n2.I >>> 16) + (r2.I >>> 16) + (t2.I >>> 16) + (e2.I >>> 16) + (i2 >>> 16))) << 16 | 65535 & i2;
        return i2 = (65535 & n2.N) + (65535 & r2.N) + (65535 & t2.N) + (65535 & e2.N) + (o2 >>> 16), o2 = (n2.N >>> 16) + (r2.N >>> 16) + (t2.N >>> 16) + (e2.N >>> 16) + (i2 >>> 16), new k((65535 & o2) << 16 | 65535 & i2, u2);
      }
      function _(n2, r2, t2, e2, i2) {
        var o2, u2;
        o2 = (65535 & n2.I) + (65535 & r2.I) + (65535 & t2.I) + (65535 & e2.I) + (65535 & i2.I);
        var f2 = (65535 & (u2 = (n2.I >>> 16) + (r2.I >>> 16) + (t2.I >>> 16) + (e2.I >>> 16) + (i2.I >>> 16) + (o2 >>> 16))) << 16 | 65535 & o2;
        return o2 = (65535 & n2.N) + (65535 & r2.N) + (65535 & t2.N) + (65535 & e2.N) + (65535 & i2.N) + (u2 >>> 16), u2 = (n2.N >>> 16) + (r2.N >>> 16) + (t2.N >>> 16) + (e2.N >>> 16) + (i2.N >>> 16) + (o2 >>> 16), new k((65535 & u2) << 16 | 65535 & o2, f2);
      }
      function P(n2, r2) {
        return new k(n2.N ^ r2.N, n2.I ^ r2.I);
      }
      function x(n2) {
        var r2 = N(n2, 1), t2 = N(n2, 8), e2 = I(n2, 7);
        return new k(r2.N ^ t2.N ^ e2.N, r2.I ^ t2.I ^ e2.I);
      }
      function V(n2) {
        var r2 = N(n2, 14), t2 = N(n2, 18), e2 = N(n2, 41);
        return new k(r2.N ^ t2.N ^ e2.N, r2.I ^ t2.I ^ e2.I);
      }
      var Z = [new k(i[0], 3609767458), new k(i[1], 602891725), new k(i[2], 3964484399), new k(i[3], 2173295548), new k(i[4], 4081628472), new k(i[5], 3053834265), new k(i[6], 2937671579), new k(i[7], 3664609560), new k(i[8], 2734883394), new k(i[9], 1164996542), new k(i[10], 1323610764), new k(i[11], 3590304994), new k(i[12], 4068182383), new k(i[13], 991336113), new k(i[14], 633803317), new k(i[15], 3479774868), new k(i[16], 2666613458), new k(i[17], 944711139), new k(i[18], 2341262773), new k(i[19], 2007800933), new k(i[20], 1495990901), new k(i[21], 1856431235), new k(i[22], 3175218132), new k(i[23], 2198950837), new k(i[24], 3999719339), new k(i[25], 766784016), new k(i[26], 2566594879), new k(i[27], 3203337956), new k(i[28], 1034457026), new k(i[29], 2466948901), new k(i[30], 3758326383), new k(i[31], 168717936), new k(i[32], 1188179964), new k(i[33], 1546045734), new k(i[34], 1522805485), new k(i[35], 2643833823), new k(i[36], 2343527390), new k(i[37], 1014477480), new k(i[38], 1206759142), new k(i[39], 344077627), new k(i[40], 1290863460), new k(i[41], 3158454273), new k(i[42], 3505952657), new k(i[43], 106217008), new k(i[44], 3606008344), new k(i[45], 1432725776), new k(i[46], 1467031594), new k(i[47], 851169720), new k(i[48], 3100823752), new k(i[49], 1363258195), new k(i[50], 3750685593), new k(i[51], 3785050280), new k(i[52], 3318307427), new k(i[53], 3812723403), new k(i[54], 2003034995), new k(i[55], 3602036899), new k(i[56], 1575990012), new k(i[57], 1125592928), new k(i[58], 2716904306), new k(i[59], 442776044), new k(i[60], 593698344), new k(i[61], 3733110249), new k(i[62], 2999351573), new k(i[63], 3815920427), new k(3391569614, 3928383900), new k(3515267271, 566280711), new k(3940187606, 3454069534), new k(4118630271, 4000239992), new k(116418474, 1914138554), new k(174292421, 2731055270), new k(289380356, 3203993006), new k(460393269, 320620315), new k(685471733, 587496836), new k(852142971, 1086792851), new k(1017036298, 365543100), new k(1126000580, 2618297676), new k(1288033470, 3409855158), new k(1501505948, 4234509866), new k(1607167915, 987167468), new k(1816402316, 1246189591)];
      function q(n2) {
        return "SHA-384" === n2 ? [new k(3418070365, o[0]), new k(1654270250, o[1]), new k(2438529370, o[2]), new k(355462360, o[3]), new k(1731405415, o[4]), new k(41048885895, o[5]), new k(3675008525, o[6]), new k(1203062813, o[7])] : [new k(u[0], 4089235720), new k(u[1], 2227873595), new k(u[2], 4271175723), new k(u[3], 1595750129), new k(u[4], 2917565137), new k(u[5], 725511199), new k(u[6], 4215389547), new k(u[7], 327033209)];
      }
      function D(n2, r2) {
        var t2, e2, i2, o2, u2, f2, w2, s2, a2, h2, c2, v2, A2, E2, l2, b2, H2 = [];
        for (t2 = r2[0], e2 = r2[1], i2 = r2[2], o2 = r2[3], u2 = r2[4], f2 = r2[5], w2 = r2[6], s2 = r2[7], c2 = 0; c2 < 80; c2 += 1) c2 < 16 ? (v2 = 2 * c2, H2[c2] = new k(n2[v2], n2[v2 + 1])) : H2[c2] = j((A2 = H2[c2 - 2], E2 = void 0, l2 = void 0, b2 = void 0, E2 = N(A2, 19), l2 = N(A2, 61), b2 = I(A2, 6), new k(E2.N ^ l2.N ^ b2.N, E2.I ^ l2.I ^ b2.I)), H2[c2 - 7], x(H2[c2 - 15]), H2[c2 - 16]), a2 = _(s2, V(u2), M(u2, f2, w2), Z[c2], H2[c2]), h2 = O(z(t2), X(t2, e2, i2)), s2 = w2, w2 = f2, f2 = u2, u2 = O(o2, a2), o2 = i2, i2 = e2, e2 = t2, t2 = O(a2, h2);
        return r2[0] = O(t2, r2[0]), r2[1] = O(e2, r2[1]), r2[2] = O(i2, r2[2]), r2[3] = O(o2, r2[3]), r2[4] = O(u2, r2[4]), r2[5] = O(f2, r2[5]), r2[6] = O(w2, r2[6]), r2[7] = O(s2, r2[7]), r2;
      }
      var G = (function(n2) {
        function r2(r3, e2, i2) {
          var o2 = this;
          if ("SHA-384" !== r3 && "SHA-512" !== r3) throw new Error(f);
          var u2 = i2 || {};
          return (o2 = n2.call(this, r3, e2, i2) || this).F = o2.Y, o2.g = true, o2.C = -1, o2.p = t(o2.t, o2.i, o2.C), o2.R = D, o2.B = function(n3) {
            return n3.slice();
          }, o2.L = q, o2.K = function(n3, t2, e3, i3) {
            return (function(n4, r4, t3, e4, i4) {
              for (var o3, u3 = 31 + (r4 + 129 >>> 10 << 5), f2 = r4 + t3; n4.length <= u3; ) n4.push(0);
              for (n4[r4 >>> 5] |= 128 << 24 - r4 % 32, n4[u3] = 4294967295 & f2, n4[u3 - 1] = f2 / 4294967296 | 0, o3 = 0; o3 < n4.length; o3 += 32) e4 = D(n4.slice(o3, o3 + 32), e4);
              return "SHA-384" === i4 ? [(e4 = e4)[0].N, e4[0].I, e4[1].N, e4[1].I, e4[2].N, e4[2].I, e4[3].N, e4[3].I, e4[4].N, e4[4].I, e4[5].N, e4[5].I] : [e4[0].N, e4[0].I, e4[1].N, e4[1].I, e4[2].N, e4[2].I, e4[3].N, e4[3].I, e4[4].N, e4[4].I, e4[5].N, e4[5].I, e4[6].N, e4[6].I, e4[7].N, e4[7].I];
            })(n3, t2, e3, i3, r3);
          }, o2.m = q(r3), o2.S = 1024, o2.U = "SHA-384" === r3 ? 384 : 512, o2.T = false, u2.hmacKey && o2.k(a("hmacKey", u2.hmacKey, o2.C)), o2;
        }
        return v(r2, n2), r2;
      })(h), J = [new k(0, 1), new k(0, 32898), new k(2147483648, 32906), new k(2147483648, 2147516416), new k(0, 32907), new k(0, 2147483649), new k(2147483648, 2147516545), new k(2147483648, 32777), new k(0, 138), new k(0, 136), new k(0, 2147516425), new k(0, 2147483658), new k(0, 2147516555), new k(2147483648, 139), new k(2147483648, 32905), new k(2147483648, 32771), new k(2147483648, 32770), new k(2147483648, 128), new k(0, 32778), new k(2147483648, 2147483658), new k(2147483648, 2147516545), new k(2147483648, 32896), new k(0, 2147483649), new k(2147483648, 2147516424)], Q = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]];
      function W(n2) {
        var r2, t2 = [];
        for (r2 = 0; r2 < 5; r2 += 1) t2[r2] = [new k(0, 0), new k(0, 0), new k(0, 0), new k(0, 0), new k(0, 0)];
        return t2;
      }
      function $(n2) {
        var r2, t2 = [];
        for (r2 = 0; r2 < 5; r2 += 1) t2[r2] = n2[r2].slice();
        return t2;
      }
      function nn(n2, r2) {
        var t2, e2, i2, o2, u2, f2, w2, s2, a2, h2 = [], c2 = [];
        if (null !== n2) for (e2 = 0; e2 < n2.length; e2 += 2) r2[(e2 >>> 1) % 5][(e2 >>> 1) / 5 | 0] = P(r2[(e2 >>> 1) % 5][(e2 >>> 1) / 5 | 0], new k(n2[e2 + 1], n2[e2]));
        for (t2 = 0; t2 < 24; t2 += 1) {
          for (o2 = W(), e2 = 0; e2 < 5; e2 += 1) h2[e2] = (u2 = r2[e2][0], f2 = r2[e2][1], w2 = r2[e2][2], s2 = r2[e2][3], a2 = r2[e2][4], new k(u2.N ^ f2.N ^ w2.N ^ s2.N ^ a2.N, u2.I ^ f2.I ^ w2.I ^ s2.I ^ a2.I));
          for (e2 = 0; e2 < 5; e2 += 1) c2[e2] = P(h2[(e2 + 4) % 5], Y(h2[(e2 + 1) % 5], 1));
          for (e2 = 0; e2 < 5; e2 += 1) for (i2 = 0; i2 < 5; i2 += 1) r2[e2][i2] = P(r2[e2][i2], c2[e2]);
          for (e2 = 0; e2 < 5; e2 += 1) for (i2 = 0; i2 < 5; i2 += 1) o2[i2][(2 * e2 + 3 * i2) % 5] = Y(r2[e2][i2], Q[e2][i2]);
          for (e2 = 0; e2 < 5; e2 += 1) for (i2 = 0; i2 < 5; i2 += 1) r2[e2][i2] = P(o2[e2][i2], new k(~o2[(e2 + 1) % 5][i2].N & o2[(e2 + 2) % 5][i2].N, ~o2[(e2 + 1) % 5][i2].I & o2[(e2 + 2) % 5][i2].I));
          r2[0][0] = P(r2[0][0], J[t2]);
        }
        return r2;
      }
      function rn(n2) {
        var r2, t2, e2 = 0, i2 = [0, 0], o2 = [4294967295 & n2, n2 / 4294967296 & 2097151];
        for (r2 = 6; r2 >= 0; r2--) 0 === (t2 = o2[r2 >> 2] >>> 8 * r2 & 255) && 0 === e2 || (i2[e2 + 1 >> 2] |= t2 << 8 * (e2 + 1), e2 += 1);
        return e2 = 0 !== e2 ? e2 : 1, i2[0] |= e2, { value: e2 + 1 > 4 ? i2 : [i2[0]], binLen: 8 + 8 * e2 };
      }
      function tn(n2) {
        return w(rn(n2.binLen), n2);
      }
      function en(n2, r2) {
        var t2, e2 = rn(r2), i2 = r2 >>> 2, o2 = (i2 - (e2 = w(e2, n2)).value.length % i2) % i2;
        for (t2 = 0; t2 < o2; t2++) e2.value.push(0);
        return e2.value;
      }
      var on = (function(n2) {
        function r2(r3, e2, i2) {
          var o2 = this, u2 = 6, w2 = 0, s2 = i2 || {};
          if (1 !== (o2 = n2.call(this, r3, e2, i2) || this).numRounds) {
            if (s2.kmacKey || s2.hmacKey) throw new Error("Cannot set numRounds with MAC");
            if ("CSHAKE128" === o2.o || "CSHAKE256" === o2.o) throw new Error("Cannot set numRounds for CSHAKE variants");
          }
          switch (o2.C = 1, o2.p = t(o2.t, o2.i, o2.C), o2.R = nn, o2.B = $, o2.L = W, o2.m = W(), o2.T = false, r3) {
            case "SHA3-224":
              o2.S = w2 = 1152, o2.U = 224, o2.g = true, o2.F = o2.Y;
              break;
            case "SHA3-256":
              o2.S = w2 = 1088, o2.U = 256, o2.g = true, o2.F = o2.Y;
              break;
            case "SHA3-384":
              o2.S = w2 = 832, o2.U = 384, o2.g = true, o2.F = o2.Y;
              break;
            case "SHA3-512":
              o2.S = w2 = 576, o2.U = 512, o2.g = true, o2.F = o2.Y;
              break;
            case "SHAKE128":
              u2 = 31, o2.S = w2 = 1344, o2.U = -1, o2.T = true, o2.g = false, o2.F = null;
              break;
            case "SHAKE256":
              u2 = 31, o2.S = w2 = 1088, o2.U = -1, o2.T = true, o2.g = false, o2.F = null;
              break;
            case "KMAC128":
              u2 = 4, o2.S = w2 = 1344, o2.M(i2), o2.U = -1, o2.T = true, o2.g = false, o2.F = o2.X;
              break;
            case "KMAC256":
              u2 = 4, o2.S = w2 = 1088, o2.M(i2), o2.U = -1, o2.T = true, o2.g = false, o2.F = o2.X;
              break;
            case "CSHAKE128":
              o2.S = w2 = 1344, u2 = o2.O(i2), o2.U = -1, o2.T = true, o2.g = false, o2.F = null;
              break;
            case "CSHAKE256":
              o2.S = w2 = 1088, u2 = o2.O(i2), o2.U = -1, o2.T = true, o2.g = false, o2.F = null;
              break;
            default:
              throw new Error(f);
          }
          return o2.K = function(n3, r4, t2, e3, i3) {
            return (function(n4, r5, t3, e4, i4, o3, u3) {
              var f2, w3, s3 = 0, a2 = [], h2 = i4 >>> 5, c2 = r5 >>> 5;
              for (f2 = 0; f2 < c2 && r5 >= i4; f2 += h2) e4 = nn(n4.slice(f2, f2 + h2), e4), r5 -= i4;
              for (n4 = n4.slice(f2), r5 %= i4; n4.length < h2; ) n4.push(0);
              for (n4[(f2 = r5 >>> 3) >> 2] ^= o3 << f2 % 4 * 8, n4[h2 - 1] ^= 2147483648, e4 = nn(n4, e4); 32 * a2.length < u3 && (w3 = e4[s3 % 5][s3 / 5 | 0], a2.push(w3.I), !(32 * a2.length >= u3)); ) a2.push(w3.N), 0 == 64 * (s3 += 1) % i4 && (nn(null, e4), s3 = 0);
              return a2;
            })(n3, r4, 0, e3, w2, u2, i3);
          }, s2.hmacKey && o2.k(a("hmacKey", s2.hmacKey, o2.C)), o2;
        }
        return v(r2, n2), r2.prototype.O = function(n3, r3) {
          var t2 = (function(n4) {
            var r4 = n4 || {};
            return { funcName: a("funcName", r4.funcName, 1, { value: [], binLen: 0 }), customization: a("Customization", r4.customization, 1, { value: [], binLen: 0 }) };
          })(n3 || {});
          r3 && (t2.funcName = r3);
          var e2 = w(tn(t2.funcName), tn(t2.customization));
          if (0 !== t2.customization.binLen || 0 !== t2.funcName.binLen) {
            for (var i2 = en(e2, this.S >>> 3), o2 = 0; o2 < i2.length; o2 += this.S >>> 5) this.m = this.R(i2.slice(o2, o2 + (this.S >>> 5)), this.m), this.v += this.S;
            return 4;
          }
          return 31;
        }, r2.prototype.M = function(n3) {
          var r3 = (function(n4) {
            var r4 = n4 || {};
            return { kmacKey: a("kmacKey", r4.kmacKey, 1), funcName: { value: [1128353099], binLen: 32 }, customization: a("Customization", r4.customization, 1, { value: [], binLen: 0 }) };
          })(n3 || {});
          this.O(n3, r3.funcName);
          for (var t2 = en(tn(r3.kmacKey), this.S >>> 3), e2 = 0; e2 < t2.length; e2 += this.S >>> 5) this.m = this.R(t2.slice(e2, e2 + (this.S >>> 5)), this.m), this.v += this.S;
          this.A = true;
        }, r2.prototype.X = function(n3) {
          var r3 = w({ value: this.u.slice(), binLen: this.s }, (function(n4) {
            var r4, t2, e2 = 0, i2 = [0, 0], o2 = [4294967295 & n4, n4 / 4294967296 & 2097151];
            for (r4 = 6; r4 >= 0; r4--) 0 == (t2 = o2[r4 >> 2] >>> 8 * r4 & 255) && 0 === e2 || (i2[e2 >> 2] |= t2 << 8 * e2, e2 += 1);
            return i2[(e2 = 0 !== e2 ? e2 : 1) >> 2] |= e2 << 8 * e2, { value: e2 + 1 > 4 ? i2 : [i2[0]], binLen: 8 + 8 * e2 };
          })(n3.outputLen));
          return this.K(r3.value, r3.binLen, this.v, this.B(this.m), n3.outputLen);
        }, r2;
      })(h);
      return (function() {
        function n2(n3, r2, t2) {
          if ("SHA-1" == n3) this.j = new K(n3, r2, t2);
          else if ("SHA-224" == n3 || "SHA-256" == n3) this.j = new g(n3, r2, t2);
          else if ("SHA-384" == n3 || "SHA-512" == n3) this.j = new G(n3, r2, t2);
          else {
            if ("SHA3-224" != n3 && "SHA3-256" != n3 && "SHA3-384" != n3 && "SHA3-512" != n3 && "SHAKE128" != n3 && "SHAKE256" != n3 && "CSHAKE128" != n3 && "CSHAKE256" != n3 && "KMAC128" != n3 && "KMAC256" != n3) throw new Error(f);
            this.j = new on(n3, r2, t2);
          }
        }
        return n2.prototype.update = function(n3) {
          this.j.update(n3);
        }, n2.prototype.getHash = function(n3, r2) {
          return this.j.getHash(n3, r2);
        }, n2.prototype.setHMACKey = function(n3, r2, t2) {
          this.j.setHMACKey(n3, r2, t2);
        }, n2.prototype.getHMAC = function(n3, r2) {
          return this.j.getHMAC(n3, r2);
        }, n2;
      })();
    }));
  }
});

// node_modules/@ton/crypto-primitives/dist/browser/getSecureRandom.js
var require_getSecureRandom = __commonJS({
  "node_modules/@ton/crypto-primitives/dist/browser/getSecureRandom.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getSecureRandomWords = exports.getSecureRandomBytes = void 0;
    function getSecureRandomBytes(size) {
      return Buffer.from(window.crypto.getRandomValues(new Uint8Array(size)));
    }
    exports.getSecureRandomBytes = getSecureRandomBytes;
    function getSecureRandomWords(size) {
      return window.crypto.getRandomValues(new Uint16Array(size));
    }
    exports.getSecureRandomWords = getSecureRandomWords;
  }
});

// node_modules/@ton/crypto-primitives/dist/browser/hmac_sha512.js
var require_hmac_sha512 = __commonJS({
  "node_modules/@ton/crypto-primitives/dist/browser/hmac_sha512.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.hmac_sha512 = void 0;
    async function hmac_sha512(key, data) {
      let keyBuffer = typeof key === "string" ? Buffer.from(key, "utf-8") : key;
      let dataBuffer = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
      const hmacAlgo = { name: "HMAC", hash: "SHA-512" };
      const hmacKey = await window.crypto.subtle.importKey("raw", keyBuffer, hmacAlgo, false, ["sign"]);
      return Buffer.from(await crypto.subtle.sign(hmacAlgo, hmacKey, dataBuffer));
    }
    exports.hmac_sha512 = hmac_sha512;
  }
});

// node_modules/@ton/crypto-primitives/dist/browser/pbkdf2_sha512.js
var require_pbkdf2_sha512 = __commonJS({
  "node_modules/@ton/crypto-primitives/dist/browser/pbkdf2_sha512.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.pbkdf2_sha512 = void 0;
    async function pbkdf2_sha512(key, salt, iterations, keyLen) {
      const keyBuffer = typeof key === "string" ? Buffer.from(key, "utf-8") : key;
      const saltBuffer = typeof salt === "string" ? Buffer.from(salt, "utf-8") : salt;
      const pbkdf2_key = await window.crypto.subtle.importKey("raw", keyBuffer, { name: "PBKDF2" }, false, ["deriveBits"]);
      const derivedBits = await window.crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-512", salt: saltBuffer, iterations }, pbkdf2_key, keyLen * 8);
      return Buffer.from(derivedBits);
    }
    exports.pbkdf2_sha512 = pbkdf2_sha512;
  }
});

// node_modules/@ton/crypto-primitives/dist/browser/sha256.js
var require_sha256 = __commonJS({
  "node_modules/@ton/crypto-primitives/dist/browser/sha256.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.sha256 = void 0;
    async function sha256(source) {
      if (typeof source === "string") {
        return Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from(source, "utf-8")));
      }
      return Buffer.from(await crypto.subtle.digest("SHA-256", source));
    }
    exports.sha256 = sha256;
  }
});

// node_modules/@ton/crypto-primitives/dist/browser/sha512.js
var require_sha512 = __commonJS({
  "node_modules/@ton/crypto-primitives/dist/browser/sha512.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.sha512 = void 0;
    async function sha512(source) {
      if (typeof source === "string") {
        return Buffer.from(await crypto.subtle.digest("SHA-512", Buffer.from(source, "utf-8")));
      }
      return Buffer.from(await crypto.subtle.digest("SHA-512", source));
    }
    exports.sha512 = sha512;
  }
});

// node_modules/@ton/crypto-primitives/dist/browser.js
var require_browser = __commonJS({
  "node_modules/@ton/crypto-primitives/dist/browser.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.sha512 = exports.sha256 = exports.pbkdf2_sha512 = exports.hmac_sha512 = exports.getSecureRandomWords = exports.getSecureRandomBytes = void 0;
    var getSecureRandom_1 = require_getSecureRandom();
    Object.defineProperty(exports, "getSecureRandomBytes", { enumerable: true, get: function() {
      return getSecureRandom_1.getSecureRandomBytes;
    } });
    Object.defineProperty(exports, "getSecureRandomWords", { enumerable: true, get: function() {
      return getSecureRandom_1.getSecureRandomWords;
    } });
    var hmac_sha512_1 = require_hmac_sha512();
    Object.defineProperty(exports, "hmac_sha512", { enumerable: true, get: function() {
      return hmac_sha512_1.hmac_sha512;
    } });
    var pbkdf2_sha512_1 = require_pbkdf2_sha512();
    Object.defineProperty(exports, "pbkdf2_sha512", { enumerable: true, get: function() {
      return pbkdf2_sha512_1.pbkdf2_sha512;
    } });
    var sha256_1 = require_sha256();
    Object.defineProperty(exports, "sha256", { enumerable: true, get: function() {
      return sha256_1.sha256;
    } });
    var sha512_1 = require_sha512();
    Object.defineProperty(exports, "sha512", { enumerable: true, get: function() {
      return sha512_1.sha512;
    } });
  }
});

// node_modules/@ton/crypto/dist/primitives/sha256.js
var require_sha2562 = __commonJS({
  "node_modules/@ton/crypto/dist/primitives/sha256.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.sha256 = exports.sha256_fallback = exports.sha256_sync = void 0;
    var jssha_1 = __importDefault(require_sha());
    var crypto_primitives_1 = require_browser();
    function sha256_sync(source) {
      let src;
      if (typeof source === "string") {
        src = Buffer.from(source, "utf-8").toString("hex");
      } else {
        src = source.toString("hex");
      }
      let hasher = new jssha_1.default("SHA-256", "HEX");
      hasher.update(src);
      let res = hasher.getHash("HEX");
      return Buffer.from(res, "hex");
    }
    exports.sha256_sync = sha256_sync;
    async function sha256_fallback(source) {
      return sha256_sync(source);
    }
    exports.sha256_fallback = sha256_fallback;
    function sha256(source) {
      return (0, crypto_primitives_1.sha256)(source);
    }
    exports.sha256 = sha256;
  }
});

// node_modules/@ton/crypto/dist/primitives/sha512.js
var require_sha5122 = __commonJS({
  "node_modules/@ton/crypto/dist/primitives/sha512.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.sha512 = exports.sha512_fallback = exports.sha512_sync = void 0;
    var jssha_1 = __importDefault(require_sha());
    var crypto_primitives_1 = require_browser();
    function sha512_sync(source) {
      let src;
      if (typeof source === "string") {
        src = Buffer.from(source, "utf-8").toString("hex");
      } else {
        src = source.toString("hex");
      }
      let hasher = new jssha_1.default("SHA-512", "HEX");
      hasher.update(src);
      let res = hasher.getHash("HEX");
      return Buffer.from(res, "hex");
    }
    exports.sha512_sync = sha512_sync;
    async function sha512_fallback(source) {
      return sha512_sync(source);
    }
    exports.sha512_fallback = sha512_fallback;
    async function sha512(source) {
      return (0, crypto_primitives_1.sha512)(source);
    }
    exports.sha512 = sha512;
  }
});

// node_modules/@ton/crypto/dist/primitives/pbkdf2_sha512.js
var require_pbkdf2_sha5122 = __commonJS({
  "node_modules/@ton/crypto/dist/primitives/pbkdf2_sha512.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.pbkdf2_sha512 = void 0;
    var crypto_primitives_1 = require_browser();
    function pbkdf2_sha512(key, salt, iterations, keyLen) {
      return (0, crypto_primitives_1.pbkdf2_sha512)(key, salt, iterations, keyLen);
    }
    exports.pbkdf2_sha512 = pbkdf2_sha512;
  }
});

// node_modules/@ton/crypto/dist/primitives/hmac_sha512.js
var require_hmac_sha5122 = __commonJS({
  "node_modules/@ton/crypto/dist/primitives/hmac_sha512.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.hmac_sha512 = exports.hmac_sha512_fallback = void 0;
    var jssha_1 = __importDefault(require_sha());
    var crypto_primitives_1 = require_browser();
    async function hmac_sha512_fallback(key, data) {
      let keyBuffer = typeof key === "string" ? Buffer.from(key, "utf-8") : key;
      let dataBuffer = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
      const shaObj = new jssha_1.default("SHA-512", "HEX", {
        hmacKey: { value: keyBuffer.toString("hex"), format: "HEX" }
      });
      shaObj.update(dataBuffer.toString("hex"));
      const hmac = shaObj.getHash("HEX");
      return Buffer.from(hmac, "hex");
    }
    exports.hmac_sha512_fallback = hmac_sha512_fallback;
    function hmac_sha512(key, data) {
      return (0, crypto_primitives_1.hmac_sha512)(key, data);
    }
    exports.hmac_sha512 = hmac_sha512;
  }
});

// node_modules/@ton/crypto/dist/primitives/getSecureRandom.js
var require_getSecureRandom2 = __commonJS({
  "node_modules/@ton/crypto/dist/primitives/getSecureRandom.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getSecureRandomNumber = exports.getSecureRandomWords = exports.getSecureRandomBytes = void 0;
    var crypto_primitives_1 = require_browser();
    async function getSecureRandomBytes(size) {
      return (0, crypto_primitives_1.getSecureRandomBytes)(size);
    }
    exports.getSecureRandomBytes = getSecureRandomBytes;
    async function getSecureRandomWords(size) {
      return getSecureRandomWords(size);
    }
    exports.getSecureRandomWords = getSecureRandomWords;
    async function getSecureRandomNumber(min, max) {
      let range = max - min;
      var bitsNeeded = Math.ceil(Math.log2(range));
      if (bitsNeeded > 53) {
        throw new Error("Range is too large");
      }
      var bytesNeeded = Math.ceil(bitsNeeded / 8);
      var mask = Math.pow(2, bitsNeeded) - 1;
      while (true) {
        let res = await getSecureRandomBytes(bitsNeeded);
        let power = (bytesNeeded - 1) * 8;
        let numberValue = 0;
        for (var i = 0; i < bytesNeeded; i++) {
          numberValue += res[i] * Math.pow(2, power);
          power -= 8;
        }
        numberValue = numberValue & mask;
        if (numberValue >= range) {
          continue;
        }
        return min + numberValue;
      }
    }
    exports.getSecureRandomNumber = getSecureRandomNumber;
  }
});

// node_modules/@ton/crypto/dist/passwords/wordlist.js
var require_wordlist = __commonJS({
  "node_modules/@ton/crypto/dist/passwords/wordlist.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.wordlist = void 0;
    exports.wordlist = [
      "abacus",
      "abdomen",
      "abdominal",
      "abide",
      "abiding",
      "ability",
      "ablaze",
      "able",
      "abnormal",
      "abrasion",
      "abrasive",
      "abreast",
      "abridge",
      "abroad",
      "abruptly",
      "absence",
      "absentee",
      "absently",
      "absinthe",
      "absolute",
      "absolve",
      "abstain",
      "abstract",
      "absurd",
      "accent",
      "acclaim",
      "acclimate",
      "accompany",
      "account",
      "accuracy",
      "accurate",
      "accustom",
      "acetone",
      "achiness",
      "aching",
      "acid",
      "acorn",
      "acquaint",
      "acquire",
      "acre",
      "acrobat",
      "acronym",
      "acting",
      "action",
      "activate",
      "activator",
      "active",
      "activism",
      "activist",
      "activity",
      "actress",
      "acts",
      "acutely",
      "acuteness",
      "aeration",
      "aerobics",
      "aerosol",
      "aerospace",
      "afar",
      "affair",
      "affected",
      "affecting",
      "affection",
      "affidavit",
      "affiliate",
      "affirm",
      "affix",
      "afflicted",
      "affluent",
      "afford",
      "affront",
      "aflame",
      "afloat",
      "aflutter",
      "afoot",
      "afraid",
      "afterglow",
      "afterlife",
      "aftermath",
      "aftermost",
      "afternoon",
      "aged",
      "ageless",
      "agency",
      "agenda",
      "agent",
      "aggregate",
      "aghast",
      "agile",
      "agility",
      "aging",
      "agnostic",
      "agonize",
      "agonizing",
      "agony",
      "agreeable",
      "agreeably",
      "agreed",
      "agreeing",
      "agreement",
      "aground",
      "ahead",
      "ahoy",
      "aide",
      "aids",
      "aim",
      "ajar",
      "alabaster",
      "alarm",
      "albatross",
      "album",
      "alfalfa",
      "algebra",
      "algorithm",
      "alias",
      "alibi",
      "alienable",
      "alienate",
      "aliens",
      "alike",
      "alive",
      "alkaline",
      "alkalize",
      "almanac",
      "almighty",
      "almost",
      "aloe",
      "aloft",
      "aloha",
      "alone",
      "alongside",
      "aloof",
      "alphabet",
      "alright",
      "although",
      "altitude",
      "alto",
      "aluminum",
      "alumni",
      "always",
      "amaretto",
      "amaze",
      "amazingly",
      "amber",
      "ambiance",
      "ambiguity",
      "ambiguous",
      "ambition",
      "ambitious",
      "ambulance",
      "ambush",
      "amendable",
      "amendment",
      "amends",
      "amenity",
      "amiable",
      "amicably",
      "amid",
      "amigo",
      "amino",
      "amiss",
      "ammonia",
      "ammonium",
      "amnesty",
      "amniotic",
      "among",
      "amount",
      "amperage",
      "ample",
      "amplifier",
      "amplify",
      "amply",
      "amuck",
      "amulet",
      "amusable",
      "amused",
      "amusement",
      "amuser",
      "amusing",
      "anaconda",
      "anaerobic",
      "anagram",
      "anatomist",
      "anatomy",
      "anchor",
      "anchovy",
      "ancient",
      "android",
      "anemia",
      "anemic",
      "aneurism",
      "anew",
      "angelfish",
      "angelic",
      "anger",
      "angled",
      "angler",
      "angles",
      "angling",
      "angrily",
      "angriness",
      "anguished",
      "angular",
      "animal",
      "animate",
      "animating",
      "animation",
      "animator",
      "anime",
      "animosity",
      "ankle",
      "annex",
      "annotate",
      "announcer",
      "annoying",
      "annually",
      "annuity",
      "anointer",
      "another",
      "answering",
      "antacid",
      "antarctic",
      "anteater",
      "antelope",
      "antennae",
      "anthem",
      "anthill",
      "anthology",
      "antibody",
      "antics",
      "antidote",
      "antihero",
      "antiquely",
      "antiques",
      "antiquity",
      "antirust",
      "antitoxic",
      "antitrust",
      "antiviral",
      "antivirus",
      "antler",
      "antonym",
      "antsy",
      "anvil",
      "anybody",
      "anyhow",
      "anymore",
      "anyone",
      "anyplace",
      "anything",
      "anytime",
      "anyway",
      "anywhere",
      "aorta",
      "apache",
      "apostle",
      "appealing",
      "appear",
      "appease",
      "appeasing",
      "appendage",
      "appendix",
      "appetite",
      "appetizer",
      "applaud",
      "applause",
      "apple",
      "appliance",
      "applicant",
      "applied",
      "apply",
      "appointee",
      "appraisal",
      "appraiser",
      "apprehend",
      "approach",
      "approval",
      "approve",
      "apricot",
      "april",
      "apron",
      "aptitude",
      "aptly",
      "aqua",
      "aqueduct",
      "arbitrary",
      "arbitrate",
      "ardently",
      "area",
      "arena",
      "arguable",
      "arguably",
      "argue",
      "arise",
      "armadillo",
      "armband",
      "armchair",
      "armed",
      "armful",
      "armhole",
      "arming",
      "armless",
      "armoire",
      "armored",
      "armory",
      "armrest",
      "army",
      "aroma",
      "arose",
      "around",
      "arousal",
      "arrange",
      "array",
      "arrest",
      "arrival",
      "arrive",
      "arrogance",
      "arrogant",
      "arson",
      "art",
      "ascend",
      "ascension",
      "ascent",
      "ascertain",
      "ashamed",
      "ashen",
      "ashes",
      "ashy",
      "aside",
      "askew",
      "asleep",
      "asparagus",
      "aspect",
      "aspirate",
      "aspire",
      "aspirin",
      "astonish",
      "astound",
      "astride",
      "astrology",
      "astronaut",
      "astronomy",
      "astute",
      "atlantic",
      "atlas",
      "atom",
      "atonable",
      "atop",
      "atrium",
      "atrocious",
      "atrophy",
      "attach",
      "attain",
      "attempt",
      "attendant",
      "attendee",
      "attention",
      "attentive",
      "attest",
      "attic",
      "attire",
      "attitude",
      "attractor",
      "attribute",
      "atypical",
      "auction",
      "audacious",
      "audacity",
      "audible",
      "audibly",
      "audience",
      "audio",
      "audition",
      "augmented",
      "august",
      "authentic",
      "author",
      "autism",
      "autistic",
      "autograph",
      "automaker",
      "automated",
      "automatic",
      "autopilot",
      "available",
      "avalanche",
      "avatar",
      "avenge",
      "avenging",
      "avenue",
      "average",
      "aversion",
      "avert",
      "aviation",
      "aviator",
      "avid",
      "avoid",
      "await",
      "awaken",
      "award",
      "aware",
      "awhile",
      "awkward",
      "awning",
      "awoke",
      "awry",
      "axis",
      "babble",
      "babbling",
      "babied",
      "baboon",
      "backache",
      "backboard",
      "backboned",
      "backdrop",
      "backed",
      "backer",
      "backfield",
      "backfire",
      "backhand",
      "backing",
      "backlands",
      "backlash",
      "backless",
      "backlight",
      "backlit",
      "backlog",
      "backpack",
      "backpedal",
      "backrest",
      "backroom",
      "backshift",
      "backside",
      "backslid",
      "backspace",
      "backspin",
      "backstab",
      "backstage",
      "backtalk",
      "backtrack",
      "backup",
      "backward",
      "backwash",
      "backwater",
      "backyard",
      "bacon",
      "bacteria",
      "bacterium",
      "badass",
      "badge",
      "badland",
      "badly",
      "badness",
      "baffle",
      "baffling",
      "bagel",
      "bagful",
      "baggage",
      "bagged",
      "baggie",
      "bagginess",
      "bagging",
      "baggy",
      "bagpipe",
      "baguette",
      "baked",
      "bakery",
      "bakeshop",
      "baking",
      "balance",
      "balancing",
      "balcony",
      "balmy",
      "balsamic",
      "bamboo",
      "banana",
      "banish",
      "banister",
      "banjo",
      "bankable",
      "bankbook",
      "banked",
      "banker",
      "banking",
      "banknote",
      "bankroll",
      "banner",
      "bannister",
      "banshee",
      "banter",
      "barbecue",
      "barbed",
      "barbell",
      "barber",
      "barcode",
      "barge",
      "bargraph",
      "barista",
      "baritone",
      "barley",
      "barmaid",
      "barman",
      "barn",
      "barometer",
      "barrack",
      "barracuda",
      "barrel",
      "barrette",
      "barricade",
      "barrier",
      "barstool",
      "bartender",
      "barterer",
      "bash",
      "basically",
      "basics",
      "basil",
      "basin",
      "basis",
      "basket",
      "batboy",
      "batch",
      "bath",
      "baton",
      "bats",
      "battalion",
      "battered",
      "battering",
      "battery",
      "batting",
      "battle",
      "bauble",
      "bazooka",
      "blabber",
      "bladder",
      "blade",
      "blah",
      "blame",
      "blaming",
      "blanching",
      "blandness",
      "blank",
      "blaspheme",
      "blasphemy",
      "blast",
      "blatancy",
      "blatantly",
      "blazer",
      "blazing",
      "bleach",
      "bleak",
      "bleep",
      "blemish",
      "blend",
      "bless",
      "blighted",
      "blimp",
      "bling",
      "blinked",
      "blinker",
      "blinking",
      "blinks",
      "blip",
      "blissful",
      "blitz",
      "blizzard",
      "bloated",
      "bloating",
      "blob",
      "blog",
      "bloomers",
      "blooming",
      "blooper",
      "blot",
      "blouse",
      "blubber",
      "bluff",
      "bluish",
      "blunderer",
      "blunt",
      "blurb",
      "blurred",
      "blurry",
      "blurt",
      "blush",
      "blustery",
      "boaster",
      "boastful",
      "boasting",
      "boat",
      "bobbed",
      "bobbing",
      "bobble",
      "bobcat",
      "bobsled",
      "bobtail",
      "bodacious",
      "body",
      "bogged",
      "boggle",
      "bogus",
      "boil",
      "bok",
      "bolster",
      "bolt",
      "bonanza",
      "bonded",
      "bonding",
      "bondless",
      "boned",
      "bonehead",
      "boneless",
      "bonelike",
      "boney",
      "bonfire",
      "bonnet",
      "bonsai",
      "bonus",
      "bony",
      "boogeyman",
      "boogieman",
      "book",
      "boondocks",
      "booted",
      "booth",
      "bootie",
      "booting",
      "bootlace",
      "bootleg",
      "boots",
      "boozy",
      "borax",
      "boring",
      "borough",
      "borrower",
      "borrowing",
      "boss",
      "botanical",
      "botanist",
      "botany",
      "botch",
      "both",
      "bottle",
      "bottling",
      "bottom",
      "bounce",
      "bouncing",
      "bouncy",
      "bounding",
      "boundless",
      "bountiful",
      "bovine",
      "boxcar",
      "boxer",
      "boxing",
      "boxlike",
      "boxy",
      "breach",
      "breath",
      "breeches",
      "breeching",
      "breeder",
      "breeding",
      "breeze",
      "breezy",
      "brethren",
      "brewery",
      "brewing",
      "briar",
      "bribe",
      "brick",
      "bride",
      "bridged",
      "brigade",
      "bright",
      "brilliant",
      "brim",
      "bring",
      "brink",
      "brisket",
      "briskly",
      "briskness",
      "bristle",
      "brittle",
      "broadband",
      "broadcast",
      "broaden",
      "broadly",
      "broadness",
      "broadside",
      "broadways",
      "broiler",
      "broiling",
      "broken",
      "broker",
      "bronchial",
      "bronco",
      "bronze",
      "bronzing",
      "brook",
      "broom",
      "brought",
      "browbeat",
      "brownnose",
      "browse",
      "browsing",
      "bruising",
      "brunch",
      "brunette",
      "brunt",
      "brush",
      "brussels",
      "brute",
      "brutishly",
      "bubble",
      "bubbling",
      "bubbly",
      "buccaneer",
      "bucked",
      "bucket",
      "buckle",
      "buckshot",
      "buckskin",
      "bucktooth",
      "buckwheat",
      "buddhism",
      "buddhist",
      "budding",
      "buddy",
      "budget",
      "buffalo",
      "buffed",
      "buffer",
      "buffing",
      "buffoon",
      "buggy",
      "bulb",
      "bulge",
      "bulginess",
      "bulgur",
      "bulk",
      "bulldog",
      "bulldozer",
      "bullfight",
      "bullfrog",
      "bullhorn",
      "bullion",
      "bullish",
      "bullpen",
      "bullring",
      "bullseye",
      "bullwhip",
      "bully",
      "bunch",
      "bundle",
      "bungee",
      "bunion",
      "bunkbed",
      "bunkhouse",
      "bunkmate",
      "bunny",
      "bunt",
      "busboy",
      "bush",
      "busily",
      "busload",
      "bust",
      "busybody",
      "buzz",
      "cabana",
      "cabbage",
      "cabbie",
      "cabdriver",
      "cable",
      "caboose",
      "cache",
      "cackle",
      "cacti",
      "cactus",
      "caddie",
      "caddy",
      "cadet",
      "cadillac",
      "cadmium",
      "cage",
      "cahoots",
      "cake",
      "calamari",
      "calamity",
      "calcium",
      "calculate",
      "calculus",
      "caliber",
      "calibrate",
      "calm",
      "caloric",
      "calorie",
      "calzone",
      "camcorder",
      "cameo",
      "camera",
      "camisole",
      "camper",
      "campfire",
      "camping",
      "campsite",
      "campus",
      "canal",
      "canary",
      "cancel",
      "candied",
      "candle",
      "candy",
      "cane",
      "canine",
      "canister",
      "cannabis",
      "canned",
      "canning",
      "cannon",
      "cannot",
      "canola",
      "canon",
      "canopener",
      "canopy",
      "canteen",
      "canyon",
      "capable",
      "capably",
      "capacity",
      "cape",
      "capillary",
      "capital",
      "capitol",
      "capped",
      "capricorn",
      "capsize",
      "capsule",
      "caption",
      "captivate",
      "captive",
      "captivity",
      "capture",
      "caramel",
      "carat",
      "caravan",
      "carbon",
      "cardboard",
      "carded",
      "cardiac",
      "cardigan",
      "cardinal",
      "cardstock",
      "carefully",
      "caregiver",
      "careless",
      "caress",
      "caretaker",
      "cargo",
      "caring",
      "carless",
      "carload",
      "carmaker",
      "carnage",
      "carnation",
      "carnival",
      "carnivore",
      "carol",
      "carpenter",
      "carpentry",
      "carpool",
      "carport",
      "carried",
      "carrot",
      "carrousel",
      "carry",
      "cartel",
      "cartload",
      "carton",
      "cartoon",
      "cartridge",
      "cartwheel",
      "carve",
      "carving",
      "carwash",
      "cascade",
      "case",
      "cash",
      "casing",
      "casino",
      "casket",
      "cassette",
      "casually",
      "casualty",
      "catacomb",
      "catalog",
      "catalyst",
      "catalyze",
      "catapult",
      "cataract",
      "catatonic",
      "catcall",
      "catchable",
      "catcher",
      "catching",
      "catchy",
      "caterer",
      "catering",
      "catfight",
      "catfish",
      "cathedral",
      "cathouse",
      "catlike",
      "catnap",
      "catnip",
      "catsup",
      "cattail",
      "cattishly",
      "cattle",
      "catty",
      "catwalk",
      "caucasian",
      "caucus",
      "causal",
      "causation",
      "cause",
      "causing",
      "cauterize",
      "caution",
      "cautious",
      "cavalier",
      "cavalry",
      "caviar",
      "cavity",
      "cedar",
      "celery",
      "celestial",
      "celibacy",
      "celibate",
      "celtic",
      "cement",
      "census",
      "ceramics",
      "ceremony",
      "certainly",
      "certainty",
      "certified",
      "certify",
      "cesarean",
      "cesspool",
      "chafe",
      "chaffing",
      "chain",
      "chair",
      "chalice",
      "challenge",
      "chamber",
      "chamomile",
      "champion",
      "chance",
      "change",
      "channel",
      "chant",
      "chaos",
      "chaperone",
      "chaplain",
      "chapped",
      "chaps",
      "chapter",
      "character",
      "charbroil",
      "charcoal",
      "charger",
      "charging",
      "chariot",
      "charity",
      "charm",
      "charred",
      "charter",
      "charting",
      "chase",
      "chasing",
      "chaste",
      "chastise",
      "chastity",
      "chatroom",
      "chatter",
      "chatting",
      "chatty",
      "cheating",
      "cheddar",
      "cheek",
      "cheer",
      "cheese",
      "cheesy",
      "chef",
      "chemicals",
      "chemist",
      "chemo",
      "cherisher",
      "cherub",
      "chess",
      "chest",
      "chevron",
      "chevy",
      "chewable",
      "chewer",
      "chewing",
      "chewy",
      "chief",
      "chihuahua",
      "childcare",
      "childhood",
      "childish",
      "childless",
      "childlike",
      "chili",
      "chill",
      "chimp",
      "chip",
      "chirping",
      "chirpy",
      "chitchat",
      "chivalry",
      "chive",
      "chloride",
      "chlorine",
      "choice",
      "chokehold",
      "choking",
      "chomp",
      "chooser",
      "choosing",
      "choosy",
      "chop",
      "chosen",
      "chowder",
      "chowtime",
      "chrome",
      "chubby",
      "chuck",
      "chug",
      "chummy",
      "chump",
      "chunk",
      "churn",
      "chute",
      "cider",
      "cilantro",
      "cinch",
      "cinema",
      "cinnamon",
      "circle",
      "circling",
      "circular",
      "circulate",
      "circus",
      "citable",
      "citadel",
      "citation",
      "citizen",
      "citric",
      "citrus",
      "city",
      "civic",
      "civil",
      "clad",
      "claim",
      "clambake",
      "clammy",
      "clamor",
      "clamp",
      "clamshell",
      "clang",
      "clanking",
      "clapped",
      "clapper",
      "clapping",
      "clarify",
      "clarinet",
      "clarity",
      "clash",
      "clasp",
      "class",
      "clatter",
      "clause",
      "clavicle",
      "claw",
      "clay",
      "clean",
      "clear",
      "cleat",
      "cleaver",
      "cleft",
      "clench",
      "clergyman",
      "clerical",
      "clerk",
      "clever",
      "clicker",
      "client",
      "climate",
      "climatic",
      "cling",
      "clinic",
      "clinking",
      "clip",
      "clique",
      "cloak",
      "clobber",
      "clock",
      "clone",
      "cloning",
      "closable",
      "closure",
      "clothes",
      "clothing",
      "cloud",
      "clover",
      "clubbed",
      "clubbing",
      "clubhouse",
      "clump",
      "clumsily",
      "clumsy",
      "clunky",
      "clustered",
      "clutch",
      "clutter",
      "coach",
      "coagulant",
      "coastal",
      "coaster",
      "coasting",
      "coastland",
      "coastline",
      "coat",
      "coauthor",
      "cobalt",
      "cobbler",
      "cobweb",
      "cocoa",
      "coconut",
      "cod",
      "coeditor",
      "coerce",
      "coexist",
      "coffee",
      "cofounder",
      "cognition",
      "cognitive",
      "cogwheel",
      "coherence",
      "coherent",
      "cohesive",
      "coil",
      "coke",
      "cola",
      "cold",
      "coleslaw",
      "coliseum",
      "collage",
      "collapse",
      "collar",
      "collected",
      "collector",
      "collide",
      "collie",
      "collision",
      "colonial",
      "colonist",
      "colonize",
      "colony",
      "colossal",
      "colt",
      "coma",
      "come",
      "comfort",
      "comfy",
      "comic",
      "coming",
      "comma",
      "commence",
      "commend",
      "comment",
      "commerce",
      "commode",
      "commodity",
      "commodore",
      "common",
      "commotion",
      "commute",
      "commuting",
      "compacted",
      "compacter",
      "compactly",
      "compactor",
      "companion",
      "company",
      "compare",
      "compel",
      "compile",
      "comply",
      "component",
      "composed",
      "composer",
      "composite",
      "compost",
      "composure",
      "compound",
      "compress",
      "comprised",
      "computer",
      "computing",
      "comrade",
      "concave",
      "conceal",
      "conceded",
      "concept",
      "concerned",
      "concert",
      "conch",
      "concierge",
      "concise",
      "conclude",
      "concrete",
      "concur",
      "condense",
      "condiment",
      "condition",
      "condone",
      "conducive",
      "conductor",
      "conduit",
      "cone",
      "confess",
      "confetti",
      "confidant",
      "confident",
      "confider",
      "confiding",
      "configure",
      "confined",
      "confining",
      "confirm",
      "conflict",
      "conform",
      "confound",
      "confront",
      "confused",
      "confusing",
      "confusion",
      "congenial",
      "congested",
      "congrats",
      "congress",
      "conical",
      "conjoined",
      "conjure",
      "conjuror",
      "connected",
      "connector",
      "consensus",
      "consent",
      "console",
      "consoling",
      "consonant",
      "constable",
      "constant",
      "constrain",
      "constrict",
      "construct",
      "consult",
      "consumer",
      "consuming",
      "contact",
      "container",
      "contempt",
      "contend",
      "contented",
      "contently",
      "contents",
      "contest",
      "context",
      "contort",
      "contour",
      "contrite",
      "control",
      "contusion",
      "convene",
      "convent",
      "copartner",
      "cope",
      "copied",
      "copier",
      "copilot",
      "coping",
      "copious",
      "copper",
      "copy",
      "coral",
      "cork",
      "cornball",
      "cornbread",
      "corncob",
      "cornea",
      "corned",
      "corner",
      "cornfield",
      "cornflake",
      "cornhusk",
      "cornmeal",
      "cornstalk",
      "corny",
      "coronary",
      "coroner",
      "corporal",
      "corporate",
      "corral",
      "correct",
      "corridor",
      "corrode",
      "corroding",
      "corrosive",
      "corsage",
      "corset",
      "cortex",
      "cosigner",
      "cosmetics",
      "cosmic",
      "cosmos",
      "cosponsor",
      "cost",
      "cottage",
      "cotton",
      "couch",
      "cough",
      "could",
      "countable",
      "countdown",
      "counting",
      "countless",
      "country",
      "county",
      "courier",
      "covenant",
      "cover",
      "coveted",
      "coveting",
      "coyness",
      "cozily",
      "coziness",
      "cozy",
      "crabbing",
      "crabgrass",
      "crablike",
      "crabmeat",
      "cradle",
      "cradling",
      "crafter",
      "craftily",
      "craftsman",
      "craftwork",
      "crafty",
      "cramp",
      "cranberry",
      "crane",
      "cranial",
      "cranium",
      "crank",
      "crate",
      "crave",
      "craving",
      "crawfish",
      "crawlers",
      "crawling",
      "crayfish",
      "crayon",
      "crazed",
      "crazily",
      "craziness",
      "crazy",
      "creamed",
      "creamer",
      "creamlike",
      "crease",
      "creasing",
      "creatable",
      "create",
      "creation",
      "creative",
      "creature",
      "credible",
      "credibly",
      "credit",
      "creed",
      "creme",
      "creole",
      "crepe",
      "crept",
      "crescent",
      "crested",
      "cresting",
      "crestless",
      "crevice",
      "crewless",
      "crewman",
      "crewmate",
      "crib",
      "cricket",
      "cried",
      "crier",
      "crimp",
      "crimson",
      "cringe",
      "cringing",
      "crinkle",
      "crinkly",
      "crisped",
      "crisping",
      "crisply",
      "crispness",
      "crispy",
      "criteria",
      "critter",
      "croak",
      "crock",
      "crook",
      "croon",
      "crop",
      "cross",
      "crouch",
      "crouton",
      "crowbar",
      "crowd",
      "crown",
      "crucial",
      "crudely",
      "crudeness",
      "cruelly",
      "cruelness",
      "cruelty",
      "crumb",
      "crummiest",
      "crummy",
      "crumpet",
      "crumpled",
      "cruncher",
      "crunching",
      "crunchy",
      "crusader",
      "crushable",
      "crushed",
      "crusher",
      "crushing",
      "crust",
      "crux",
      "crying",
      "cryptic",
      "crystal",
      "cubbyhole",
      "cube",
      "cubical",
      "cubicle",
      "cucumber",
      "cuddle",
      "cuddly",
      "cufflink",
      "culinary",
      "culminate",
      "culpable",
      "culprit",
      "cultivate",
      "cultural",
      "culture",
      "cupbearer",
      "cupcake",
      "cupid",
      "cupped",
      "cupping",
      "curable",
      "curator",
      "curdle",
      "cure",
      "curfew",
      "curing",
      "curled",
      "curler",
      "curliness",
      "curling",
      "curly",
      "curry",
      "curse",
      "cursive",
      "cursor",
      "curtain",
      "curtly",
      "curtsy",
      "curvature",
      "curve",
      "curvy",
      "cushy",
      "cusp",
      "cussed",
      "custard",
      "custodian",
      "custody",
      "customary",
      "customer",
      "customize",
      "customs",
      "cut",
      "cycle",
      "cyclic",
      "cycling",
      "cyclist",
      "cylinder",
      "cymbal",
      "cytoplasm",
      "cytoplast",
      "dab",
      "dad",
      "daffodil",
      "dagger",
      "daily",
      "daintily",
      "dainty",
      "dairy",
      "daisy",
      "dallying",
      "dance",
      "dancing",
      "dandelion",
      "dander",
      "dandruff",
      "dandy",
      "danger",
      "dangle",
      "dangling",
      "daredevil",
      "dares",
      "daringly",
      "darkened",
      "darkening",
      "darkish",
      "darkness",
      "darkroom",
      "darling",
      "darn",
      "dart",
      "darwinism",
      "dash",
      "dastardly",
      "data",
      "datebook",
      "dating",
      "daughter",
      "daunting",
      "dawdler",
      "dawn",
      "daybed",
      "daybreak",
      "daycare",
      "daydream",
      "daylight",
      "daylong",
      "dayroom",
      "daytime",
      "dazzler",
      "dazzling",
      "deacon",
      "deafening",
      "deafness",
      "dealer",
      "dealing",
      "dealmaker",
      "dealt",
      "dean",
      "debatable",
      "debate",
      "debating",
      "debit",
      "debrief",
      "debtless",
      "debtor",
      "debug",
      "debunk",
      "decade",
      "decaf",
      "decal",
      "decathlon",
      "decay",
      "deceased",
      "deceit",
      "deceiver",
      "deceiving",
      "december",
      "decency",
      "decent",
      "deception",
      "deceptive",
      "decibel",
      "decidable",
      "decimal",
      "decimeter",
      "decipher",
      "deck",
      "declared",
      "decline",
      "decode",
      "decompose",
      "decorated",
      "decorator",
      "decoy",
      "decrease",
      "decree",
      "dedicate",
      "dedicator",
      "deduce",
      "deduct",
      "deed",
      "deem",
      "deepen",
      "deeply",
      "deepness",
      "deface",
      "defacing",
      "defame",
      "default",
      "defeat",
      "defection",
      "defective",
      "defendant",
      "defender",
      "defense",
      "defensive",
      "deferral",
      "deferred",
      "defiance",
      "defiant",
      "defile",
      "defiling",
      "define",
      "definite",
      "deflate",
      "deflation",
      "deflator",
      "deflected",
      "deflector",
      "defog",
      "deforest",
      "defraud",
      "defrost",
      "deftly",
      "defuse",
      "defy",
      "degraded",
      "degrading",
      "degrease",
      "degree",
      "dehydrate",
      "deity",
      "dejected",
      "delay",
      "delegate",
      "delegator",
      "delete",
      "deletion",
      "delicacy",
      "delicate",
      "delicious",
      "delighted",
      "delirious",
      "delirium",
      "deliverer",
      "delivery",
      "delouse",
      "delta",
      "deluge",
      "delusion",
      "deluxe",
      "demanding",
      "demeaning",
      "demeanor",
      "demise",
      "democracy",
      "democrat",
      "demote",
      "demotion",
      "demystify",
      "denatured",
      "deniable",
      "denial",
      "denim",
      "denote",
      "dense",
      "density",
      "dental",
      "dentist",
      "denture",
      "deny",
      "deodorant",
      "deodorize",
      "departed",
      "departure",
      "depict",
      "deplete",
      "depletion",
      "deplored",
      "deploy",
      "deport",
      "depose",
      "depraved",
      "depravity",
      "deprecate",
      "depress",
      "deprive",
      "depth",
      "deputize",
      "deputy",
      "derail",
      "deranged",
      "derby",
      "derived",
      "desecrate",
      "deserve",
      "deserving",
      "designate",
      "designed",
      "designer",
      "designing",
      "deskbound",
      "desktop",
      "deskwork",
      "desolate",
      "despair",
      "despise",
      "despite",
      "destiny",
      "destitute",
      "destruct",
      "detached",
      "detail",
      "detection",
      "detective",
      "detector",
      "detention",
      "detergent",
      "detest",
      "detonate",
      "detonator",
      "detoxify",
      "detract",
      "deuce",
      "devalue",
      "deviancy",
      "deviant",
      "deviate",
      "deviation",
      "deviator",
      "device",
      "devious",
      "devotedly",
      "devotee",
      "devotion",
      "devourer",
      "devouring",
      "devoutly",
      "dexterity",
      "dexterous",
      "diabetes",
      "diabetic",
      "diabolic",
      "diagnoses",
      "diagnosis",
      "diagram",
      "dial",
      "diameter",
      "diaper",
      "diaphragm",
      "diary",
      "dice",
      "dicing",
      "dictate",
      "dictation",
      "dictator",
      "difficult",
      "diffused",
      "diffuser",
      "diffusion",
      "diffusive",
      "dig",
      "dilation",
      "diligence",
      "diligent",
      "dill",
      "dilute",
      "dime",
      "diminish",
      "dimly",
      "dimmed",
      "dimmer",
      "dimness",
      "dimple",
      "diner",
      "dingbat",
      "dinghy",
      "dinginess",
      "dingo",
      "dingy",
      "dining",
      "dinner",
      "diocese",
      "dioxide",
      "diploma",
      "dipped",
      "dipper",
      "dipping",
      "directed",
      "direction",
      "directive",
      "directly",
      "directory",
      "direness",
      "dirtiness",
      "disabled",
      "disagree",
      "disallow",
      "disarm",
      "disarray",
      "disaster",
      "disband",
      "disbelief",
      "disburse",
      "discard",
      "discern",
      "discharge",
      "disclose",
      "discolor",
      "discount",
      "discourse",
      "discover",
      "discuss",
      "disdain",
      "disengage",
      "disfigure",
      "disgrace",
      "dish",
      "disinfect",
      "disjoin",
      "disk",
      "dislike",
      "disliking",
      "dislocate",
      "dislodge",
      "disloyal",
      "dismantle",
      "dismay",
      "dismiss",
      "dismount",
      "disobey",
      "disorder",
      "disown",
      "disparate",
      "disparity",
      "dispatch",
      "dispense",
      "dispersal",
      "dispersed",
      "disperser",
      "displace",
      "display",
      "displease",
      "disposal",
      "dispose",
      "disprove",
      "dispute",
      "disregard",
      "disrupt",
      "dissuade",
      "distance",
      "distant",
      "distaste",
      "distill",
      "distinct",
      "distort",
      "distract",
      "distress",
      "district",
      "distrust",
      "ditch",
      "ditto",
      "ditzy",
      "dividable",
      "divided",
      "dividend",
      "dividers",
      "dividing",
      "divinely",
      "diving",
      "divinity",
      "divisible",
      "divisibly",
      "division",
      "divisive",
      "divorcee",
      "dizziness",
      "dizzy",
      "doable",
      "docile",
      "dock",
      "doctrine",
      "document",
      "dodge",
      "dodgy",
      "doily",
      "doing",
      "dole",
      "dollar",
      "dollhouse",
      "dollop",
      "dolly",
      "dolphin",
      "domain",
      "domelike",
      "domestic",
      "dominion",
      "dominoes",
      "donated",
      "donation",
      "donator",
      "donor",
      "donut",
      "doodle",
      "doorbell",
      "doorframe",
      "doorknob",
      "doorman",
      "doormat",
      "doornail",
      "doorpost",
      "doorstep",
      "doorstop",
      "doorway",
      "doozy",
      "dork",
      "dormitory",
      "dorsal",
      "dosage",
      "dose",
      "dotted",
      "doubling",
      "douche",
      "dove",
      "down",
      "dowry",
      "doze",
      "drab",
      "dragging",
      "dragonfly",
      "dragonish",
      "dragster",
      "drainable",
      "drainage",
      "drained",
      "drainer",
      "drainpipe",
      "dramatic",
      "dramatize",
      "drank",
      "drapery",
      "drastic",
      "draw",
      "dreaded",
      "dreadful",
      "dreadlock",
      "dreamboat",
      "dreamily",
      "dreamland",
      "dreamless",
      "dreamlike",
      "dreamt",
      "dreamy",
      "drearily",
      "dreary",
      "drench",
      "dress",
      "drew",
      "dribble",
      "dried",
      "drier",
      "drift",
      "driller",
      "drilling",
      "drinkable",
      "drinking",
      "dripping",
      "drippy",
      "drivable",
      "driven",
      "driver",
      "driveway",
      "driving",
      "drizzle",
      "drizzly",
      "drone",
      "drool",
      "droop",
      "drop-down",
      "dropbox",
      "dropkick",
      "droplet",
      "dropout",
      "dropper",
      "drove",
      "drown",
      "drowsily",
      "drudge",
      "drum",
      "dry",
      "dubbed",
      "dubiously",
      "duchess",
      "duckbill",
      "ducking",
      "duckling",
      "ducktail",
      "ducky",
      "duct",
      "dude",
      "duffel",
      "dugout",
      "duh",
      "duke",
      "duller",
      "dullness",
      "duly",
      "dumping",
      "dumpling",
      "dumpster",
      "duo",
      "dupe",
      "duplex",
      "duplicate",
      "duplicity",
      "durable",
      "durably",
      "duration",
      "duress",
      "during",
      "dusk",
      "dust",
      "dutiful",
      "duty",
      "duvet",
      "dwarf",
      "dweeb",
      "dwelled",
      "dweller",
      "dwelling",
      "dwindle",
      "dwindling",
      "dynamic",
      "dynamite",
      "dynasty",
      "dyslexia",
      "dyslexic",
      "each",
      "eagle",
      "earache",
      "eardrum",
      "earflap",
      "earful",
      "earlobe",
      "early",
      "earmark",
      "earmuff",
      "earphone",
      "earpiece",
      "earplugs",
      "earring",
      "earshot",
      "earthen",
      "earthlike",
      "earthling",
      "earthly",
      "earthworm",
      "earthy",
      "earwig",
      "easeful",
      "easel",
      "easiest",
      "easily",
      "easiness",
      "easing",
      "eastbound",
      "eastcoast",
      "easter",
      "eastward",
      "eatable",
      "eaten",
      "eatery",
      "eating",
      "eats",
      "ebay",
      "ebony",
      "ebook",
      "ecard",
      "eccentric",
      "echo",
      "eclair",
      "eclipse",
      "ecologist",
      "ecology",
      "economic",
      "economist",
      "economy",
      "ecosphere",
      "ecosystem",
      "edge",
      "edginess",
      "edging",
      "edgy",
      "edition",
      "editor",
      "educated",
      "education",
      "educator",
      "eel",
      "effective",
      "effects",
      "efficient",
      "effort",
      "eggbeater",
      "egging",
      "eggnog",
      "eggplant",
      "eggshell",
      "egomaniac",
      "egotism",
      "egotistic",
      "either",
      "eject",
      "elaborate",
      "elastic",
      "elated",
      "elbow",
      "eldercare",
      "elderly",
      "eldest",
      "electable",
      "election",
      "elective",
      "elephant",
      "elevate",
      "elevating",
      "elevation",
      "elevator",
      "eleven",
      "elf",
      "eligible",
      "eligibly",
      "eliminate",
      "elite",
      "elitism",
      "elixir",
      "elk",
      "ellipse",
      "elliptic",
      "elm",
      "elongated",
      "elope",
      "eloquence",
      "eloquent",
      "elsewhere",
      "elude",
      "elusive",
      "elves",
      "email",
      "embargo",
      "embark",
      "embassy",
      "embattled",
      "embellish",
      "ember",
      "embezzle",
      "emblaze",
      "emblem",
      "embody",
      "embolism",
      "emboss",
      "embroider",
      "emcee",
      "emerald",
      "emergency",
      "emission",
      "emit",
      "emote",
      "emoticon",
      "emotion",
      "empathic",
      "empathy",
      "emperor",
      "emphases",
      "emphasis",
      "emphasize",
      "emphatic",
      "empirical",
      "employed",
      "employee",
      "employer",
      "emporium",
      "empower",
      "emptier",
      "emptiness",
      "empty",
      "emu",
      "enable",
      "enactment",
      "enamel",
      "enchanted",
      "enchilada",
      "encircle",
      "enclose",
      "enclosure",
      "encode",
      "encore",
      "encounter",
      "encourage",
      "encroach",
      "encrust",
      "encrypt",
      "endanger",
      "endeared",
      "endearing",
      "ended",
      "ending",
      "endless",
      "endnote",
      "endocrine",
      "endorphin",
      "endorse",
      "endowment",
      "endpoint",
      "endurable",
      "endurance",
      "enduring",
      "energetic",
      "energize",
      "energy",
      "enforced",
      "enforcer",
      "engaged",
      "engaging",
      "engine",
      "engorge",
      "engraved",
      "engraver",
      "engraving",
      "engross",
      "engulf",
      "enhance",
      "enigmatic",
      "enjoyable",
      "enjoyably",
      "enjoyer",
      "enjoying",
      "enjoyment",
      "enlarged",
      "enlarging",
      "enlighten",
      "enlisted",
      "enquirer",
      "enrage",
      "enrich",
      "enroll",
      "enslave",
      "ensnare",
      "ensure",
      "entail",
      "entangled",
      "entering",
      "entertain",
      "enticing",
      "entire",
      "entitle",
      "entity",
      "entomb",
      "entourage",
      "entrap",
      "entree",
      "entrench",
      "entrust",
      "entryway",
      "entwine",
      "enunciate",
      "envelope",
      "enviable",
      "enviably",
      "envious",
      "envision",
      "envoy",
      "envy",
      "enzyme",
      "epic",
      "epidemic",
      "epidermal",
      "epidermis",
      "epidural",
      "epilepsy",
      "epileptic",
      "epilogue",
      "epiphany",
      "episode",
      "equal",
      "equate",
      "equation",
      "equator",
      "equinox",
      "equipment",
      "equity",
      "equivocal",
      "eradicate",
      "erasable",
      "erased",
      "eraser",
      "erasure",
      "ergonomic",
      "errand",
      "errant",
      "erratic",
      "error",
      "erupt",
      "escalate",
      "escalator",
      "escapable",
      "escapade",
      "escapist",
      "escargot",
      "eskimo",
      "esophagus",
      "espionage",
      "espresso",
      "esquire",
      "essay",
      "essence",
      "essential",
      "establish",
      "estate",
      "esteemed",
      "estimate",
      "estimator",
      "estranged",
      "estrogen",
      "etching",
      "eternal",
      "eternity",
      "ethanol",
      "ether",
      "ethically",
      "ethics",
      "euphemism",
      "evacuate",
      "evacuee",
      "evade",
      "evaluate",
      "evaluator",
      "evaporate",
      "evasion",
      "evasive",
      "even",
      "everglade",
      "evergreen",
      "everybody",
      "everyday",
      "everyone",
      "evict",
      "evidence",
      "evident",
      "evil",
      "evoke",
      "evolution",
      "evolve",
      "exact",
      "exalted",
      "example",
      "excavate",
      "excavator",
      "exceeding",
      "exception",
      "excess",
      "exchange",
      "excitable",
      "exciting",
      "exclaim",
      "exclude",
      "excluding",
      "exclusion",
      "exclusive",
      "excretion",
      "excretory",
      "excursion",
      "excusable",
      "excusably",
      "excuse",
      "exemplary",
      "exemplify",
      "exemption",
      "exerciser",
      "exert",
      "exes",
      "exfoliate",
      "exhale",
      "exhaust",
      "exhume",
      "exile",
      "existing",
      "exit",
      "exodus",
      "exonerate",
      "exorcism",
      "exorcist",
      "expand",
      "expanse",
      "expansion",
      "expansive",
      "expectant",
      "expedited",
      "expediter",
      "expel",
      "expend",
      "expenses",
      "expensive",
      "expert",
      "expire",
      "expiring",
      "explain",
      "expletive",
      "explicit",
      "explode",
      "exploit",
      "explore",
      "exploring",
      "exponent",
      "exporter",
      "exposable",
      "expose",
      "exposure",
      "express",
      "expulsion",
      "exquisite",
      "extended",
      "extending",
      "extent",
      "extenuate",
      "exterior",
      "external",
      "extinct",
      "extortion",
      "extradite",
      "extras",
      "extrovert",
      "extrude",
      "extruding",
      "exuberant",
      "fable",
      "fabric",
      "fabulous",
      "facebook",
      "facecloth",
      "facedown",
      "faceless",
      "facelift",
      "faceplate",
      "faceted",
      "facial",
      "facility",
      "facing",
      "facsimile",
      "faction",
      "factoid",
      "factor",
      "factsheet",
      "factual",
      "faculty",
      "fade",
      "fading",
      "failing",
      "falcon",
      "fall",
      "false",
      "falsify",
      "fame",
      "familiar",
      "family",
      "famine",
      "famished",
      "fanatic",
      "fancied",
      "fanciness",
      "fancy",
      "fanfare",
      "fang",
      "fanning",
      "fantasize",
      "fantastic",
      "fantasy",
      "fascism",
      "fastball",
      "faster",
      "fasting",
      "fastness",
      "faucet",
      "favorable",
      "favorably",
      "favored",
      "favoring",
      "favorite",
      "fax",
      "feast",
      "federal",
      "fedora",
      "feeble",
      "feed",
      "feel",
      "feisty",
      "feline",
      "felt-tip",
      "feminine",
      "feminism",
      "feminist",
      "feminize",
      "femur",
      "fence",
      "fencing",
      "fender",
      "ferment",
      "fernlike",
      "ferocious",
      "ferocity",
      "ferret",
      "ferris",
      "ferry",
      "fervor",
      "fester",
      "festival",
      "festive",
      "festivity",
      "fetal",
      "fetch",
      "fever",
      "fiber",
      "fiction",
      "fiddle",
      "fiddling",
      "fidelity",
      "fidgeting",
      "fidgety",
      "fifteen",
      "fifth",
      "fiftieth",
      "fifty",
      "figment",
      "figure",
      "figurine",
      "filing",
      "filled",
      "filler",
      "filling",
      "film",
      "filter",
      "filth",
      "filtrate",
      "finale",
      "finalist",
      "finalize",
      "finally",
      "finance",
      "financial",
      "finch",
      "fineness",
      "finer",
      "finicky",
      "finished",
      "finisher",
      "finishing",
      "finite",
      "finless",
      "finlike",
      "fiscally",
      "fit",
      "five",
      "flaccid",
      "flagman",
      "flagpole",
      "flagship",
      "flagstick",
      "flagstone",
      "flail",
      "flakily",
      "flaky",
      "flame",
      "flammable",
      "flanked",
      "flanking",
      "flannels",
      "flap",
      "flaring",
      "flashback",
      "flashbulb",
      "flashcard",
      "flashily",
      "flashing",
      "flashy",
      "flask",
      "flatbed",
      "flatfoot",
      "flatly",
      "flatness",
      "flatten",
      "flattered",
      "flatterer",
      "flattery",
      "flattop",
      "flatware",
      "flatworm",
      "flavored",
      "flavorful",
      "flavoring",
      "flaxseed",
      "fled",
      "fleshed",
      "fleshy",
      "flick",
      "flier",
      "flight",
      "flinch",
      "fling",
      "flint",
      "flip",
      "flirt",
      "float",
      "flock",
      "flogging",
      "flop",
      "floral",
      "florist",
      "floss",
      "flounder",
      "flyable",
      "flyaway",
      "flyer",
      "flying",
      "flyover",
      "flypaper",
      "foam",
      "foe",
      "fog",
      "foil",
      "folic",
      "folk",
      "follicle",
      "follow",
      "fondling",
      "fondly",
      "fondness",
      "fondue",
      "font",
      "food",
      "fool",
      "footage",
      "football",
      "footbath",
      "footboard",
      "footer",
      "footgear",
      "foothill",
      "foothold",
      "footing",
      "footless",
      "footman",
      "footnote",
      "footpad",
      "footpath",
      "footprint",
      "footrest",
      "footsie",
      "footsore",
      "footwear",
      "footwork",
      "fossil",
      "foster",
      "founder",
      "founding",
      "fountain",
      "fox",
      "foyer",
      "fraction",
      "fracture",
      "fragile",
      "fragility",
      "fragment",
      "fragrance",
      "fragrant",
      "frail",
      "frame",
      "framing",
      "frantic",
      "fraternal",
      "frayed",
      "fraying",
      "frays",
      "freckled",
      "freckles",
      "freebase",
      "freebee",
      "freebie",
      "freedom",
      "freefall",
      "freehand",
      "freeing",
      "freeload",
      "freely",
      "freemason",
      "freeness",
      "freestyle",
      "freeware",
      "freeway",
      "freewill",
      "freezable",
      "freezing",
      "freight",
      "french",
      "frenzied",
      "frenzy",
      "frequency",
      "frequent",
      "fresh",
      "fretful",
      "fretted",
      "friction",
      "friday",
      "fridge",
      "fried",
      "friend",
      "frighten",
      "frightful",
      "frigidity",
      "frigidly",
      "frill",
      "fringe",
      "frisbee",
      "frisk",
      "fritter",
      "frivolous",
      "frolic",
      "from",
      "front",
      "frostbite",
      "frosted",
      "frostily",
      "frosting",
      "frostlike",
      "frosty",
      "froth",
      "frown",
      "frozen",
      "fructose",
      "frugality",
      "frugally",
      "fruit",
      "frustrate",
      "frying",
      "gab",
      "gaffe",
      "gag",
      "gainfully",
      "gaining",
      "gains",
      "gala",
      "gallantly",
      "galleria",
      "gallery",
      "galley",
      "gallon",
      "gallows",
      "gallstone",
      "galore",
      "galvanize",
      "gambling",
      "game",
      "gaming",
      "gamma",
      "gander",
      "gangly",
      "gangrene",
      "gangway",
      "gap",
      "garage",
      "garbage",
      "garden",
      "gargle",
      "garland",
      "garlic",
      "garment",
      "garnet",
      "garnish",
      "garter",
      "gas",
      "gatherer",
      "gathering",
      "gating",
      "gauging",
      "gauntlet",
      "gauze",
      "gave",
      "gawk",
      "gazing",
      "gear",
      "gecko",
      "geek",
      "geiger",
      "gem",
      "gender",
      "generic",
      "generous",
      "genetics",
      "genre",
      "gentile",
      "gentleman",
      "gently",
      "gents",
      "geography",
      "geologic",
      "geologist",
      "geology",
      "geometric",
      "geometry",
      "geranium",
      "gerbil",
      "geriatric",
      "germicide",
      "germinate",
      "germless",
      "germproof",
      "gestate",
      "gestation",
      "gesture",
      "getaway",
      "getting",
      "getup",
      "giant",
      "gibberish",
      "giblet",
      "giddily",
      "giddiness",
      "giddy",
      "gift",
      "gigabyte",
      "gigahertz",
      "gigantic",
      "giggle",
      "giggling",
      "giggly",
      "gigolo",
      "gilled",
      "gills",
      "gimmick",
      "girdle",
      "giveaway",
      "given",
      "giver",
      "giving",
      "gizmo",
      "gizzard",
      "glacial",
      "glacier",
      "glade",
      "gladiator",
      "gladly",
      "glamorous",
      "glamour",
      "glance",
      "glancing",
      "glandular",
      "glare",
      "glaring",
      "glass",
      "glaucoma",
      "glazing",
      "gleaming",
      "gleeful",
      "glider",
      "gliding",
      "glimmer",
      "glimpse",
      "glisten",
      "glitch",
      "glitter",
      "glitzy",
      "gloater",
      "gloating",
      "gloomily",
      "gloomy",
      "glorified",
      "glorifier",
      "glorify",
      "glorious",
      "glory",
      "gloss",
      "glove",
      "glowing",
      "glowworm",
      "glucose",
      "glue",
      "gluten",
      "glutinous",
      "glutton",
      "gnarly",
      "gnat",
      "goal",
      "goatskin",
      "goes",
      "goggles",
      "going",
      "goldfish",
      "goldmine",
      "goldsmith",
      "golf",
      "goliath",
      "gonad",
      "gondola",
      "gone",
      "gong",
      "good",
      "gooey",
      "goofball",
      "goofiness",
      "goofy",
      "google",
      "goon",
      "gopher",
      "gore",
      "gorged",
      "gorgeous",
      "gory",
      "gosling",
      "gossip",
      "gothic",
      "gotten",
      "gout",
      "gown",
      "grab",
      "graceful",
      "graceless",
      "gracious",
      "gradation",
      "graded",
      "grader",
      "gradient",
      "grading",
      "gradually",
      "graduate",
      "graffiti",
      "grafted",
      "grafting",
      "grain",
      "granddad",
      "grandkid",
      "grandly",
      "grandma",
      "grandpa",
      "grandson",
      "granite",
      "granny",
      "granola",
      "grant",
      "granular",
      "grape",
      "graph",
      "grapple",
      "grappling",
      "grasp",
      "grass",
      "gratified",
      "gratify",
      "grating",
      "gratitude",
      "gratuity",
      "gravel",
      "graveness",
      "graves",
      "graveyard",
      "gravitate",
      "gravity",
      "gravy",
      "gray",
      "grazing",
      "greasily",
      "greedily",
      "greedless",
      "greedy",
      "green",
      "greeter",
      "greeting",
      "grew",
      "greyhound",
      "grid",
      "grief",
      "grievance",
      "grieving",
      "grievous",
      "grill",
      "grimace",
      "grimacing",
      "grime",
      "griminess",
      "grimy",
      "grinch",
      "grinning",
      "grip",
      "gristle",
      "grit",
      "groggily",
      "groggy",
      "groin",
      "groom",
      "groove",
      "grooving",
      "groovy",
      "grope",
      "ground",
      "grouped",
      "grout",
      "grove",
      "grower",
      "growing",
      "growl",
      "grub",
      "grudge",
      "grudging",
      "grueling",
      "gruffly",
      "grumble",
      "grumbling",
      "grumbly",
      "grumpily",
      "grunge",
      "grunt",
      "guacamole",
      "guidable",
      "guidance",
      "guide",
      "guiding",
      "guileless",
      "guise",
      "gulf",
      "gullible",
      "gully",
      "gulp",
      "gumball",
      "gumdrop",
      "gumminess",
      "gumming",
      "gummy",
      "gurgle",
      "gurgling",
      "guru",
      "gush",
      "gusto",
      "gusty",
      "gutless",
      "guts",
      "gutter",
      "guy",
      "guzzler",
      "gyration",
      "habitable",
      "habitant",
      "habitat",
      "habitual",
      "hacked",
      "hacker",
      "hacking",
      "hacksaw",
      "had",
      "haggler",
      "haiku",
      "half",
      "halogen",
      "halt",
      "halved",
      "halves",
      "hamburger",
      "hamlet",
      "hammock",
      "hamper",
      "hamster",
      "hamstring",
      "handbag",
      "handball",
      "handbook",
      "handbrake",
      "handcart",
      "handclap",
      "handclasp",
      "handcraft",
      "handcuff",
      "handed",
      "handful",
      "handgrip",
      "handgun",
      "handheld",
      "handiness",
      "handiwork",
      "handlebar",
      "handled",
      "handler",
      "handling",
      "handmade",
      "handoff",
      "handpick",
      "handprint",
      "handrail",
      "handsaw",
      "handset",
      "handsfree",
      "handshake",
      "handstand",
      "handwash",
      "handwork",
      "handwoven",
      "handwrite",
      "handyman",
      "hangnail",
      "hangout",
      "hangover",
      "hangup",
      "hankering",
      "hankie",
      "hanky",
      "haphazard",
      "happening",
      "happier",
      "happiest",
      "happily",
      "happiness",
      "happy",
      "harbor",
      "hardcopy",
      "hardcore",
      "hardcover",
      "harddisk",
      "hardened",
      "hardener",
      "hardening",
      "hardhat",
      "hardhead",
      "hardiness",
      "hardly",
      "hardness",
      "hardship",
      "hardware",
      "hardwired",
      "hardwood",
      "hardy",
      "harmful",
      "harmless",
      "harmonica",
      "harmonics",
      "harmonize",
      "harmony",
      "harness",
      "harpist",
      "harsh",
      "harvest",
      "hash",
      "hassle",
      "haste",
      "hastily",
      "hastiness",
      "hasty",
      "hatbox",
      "hatchback",
      "hatchery",
      "hatchet",
      "hatching",
      "hatchling",
      "hate",
      "hatless",
      "hatred",
      "haunt",
      "haven",
      "hazard",
      "hazelnut",
      "hazily",
      "haziness",
      "hazing",
      "hazy",
      "headache",
      "headband",
      "headboard",
      "headcount",
      "headdress",
      "headed",
      "header",
      "headfirst",
      "headgear",
      "heading",
      "headlamp",
      "headless",
      "headlock",
      "headphone",
      "headpiece",
      "headrest",
      "headroom",
      "headscarf",
      "headset",
      "headsman",
      "headstand",
      "headstone",
      "headway",
      "headwear",
      "heap",
      "heat",
      "heave",
      "heavily",
      "heaviness",
      "heaving",
      "hedge",
      "hedging",
      "heftiness",
      "hefty",
      "helium",
      "helmet",
      "helper",
      "helpful",
      "helping",
      "helpless",
      "helpline",
      "hemlock",
      "hemstitch",
      "hence",
      "henchman",
      "henna",
      "herald",
      "herbal",
      "herbicide",
      "herbs",
      "heritage",
      "hermit",
      "heroics",
      "heroism",
      "herring",
      "herself",
      "hertz",
      "hesitancy",
      "hesitant",
      "hesitate",
      "hexagon",
      "hexagram",
      "hubcap",
      "huddle",
      "huddling",
      "huff",
      "hug",
      "hula",
      "hulk",
      "hull",
      "human",
      "humble",
      "humbling",
      "humbly",
      "humid",
      "humiliate",
      "humility",
      "humming",
      "hummus",
      "humongous",
      "humorist",
      "humorless",
      "humorous",
      "humpback",
      "humped",
      "humvee",
      "hunchback",
      "hundredth",
      "hunger",
      "hungrily",
      "hungry",
      "hunk",
      "hunter",
      "hunting",
      "huntress",
      "huntsman",
      "hurdle",
      "hurled",
      "hurler",
      "hurling",
      "hurray",
      "hurricane",
      "hurried",
      "hurry",
      "hurt",
      "husband",
      "hush",
      "husked",
      "huskiness",
      "hut",
      "hybrid",
      "hydrant",
      "hydrated",
      "hydration",
      "hydrogen",
      "hydroxide",
      "hyperlink",
      "hypertext",
      "hyphen",
      "hypnoses",
      "hypnosis",
      "hypnotic",
      "hypnotism",
      "hypnotist",
      "hypnotize",
      "hypocrisy",
      "hypocrite",
      "ibuprofen",
      "ice",
      "iciness",
      "icing",
      "icky",
      "icon",
      "icy",
      "idealism",
      "idealist",
      "idealize",
      "ideally",
      "idealness",
      "identical",
      "identify",
      "identity",
      "ideology",
      "idiocy",
      "idiom",
      "idly",
      "igloo",
      "ignition",
      "ignore",
      "iguana",
      "illicitly",
      "illusion",
      "illusive",
      "image",
      "imaginary",
      "imagines",
      "imaging",
      "imbecile",
      "imitate",
      "imitation",
      "immature",
      "immerse",
      "immersion",
      "imminent",
      "immobile",
      "immodest",
      "immorally",
      "immortal",
      "immovable",
      "immovably",
      "immunity",
      "immunize",
      "impaired",
      "impale",
      "impart",
      "impatient",
      "impeach",
      "impeding",
      "impending",
      "imperfect",
      "imperial",
      "impish",
      "implant",
      "implement",
      "implicate",
      "implicit",
      "implode",
      "implosion",
      "implosive",
      "imply",
      "impolite",
      "important",
      "importer",
      "impose",
      "imposing",
      "impotence",
      "impotency",
      "impotent",
      "impound",
      "imprecise",
      "imprint",
      "imprison",
      "impromptu",
      "improper",
      "improve",
      "improving",
      "improvise",
      "imprudent",
      "impulse",
      "impulsive",
      "impure",
      "impurity",
      "iodine",
      "iodize",
      "ion",
      "ipad",
      "iphone",
      "ipod",
      "irate",
      "irk",
      "iron",
      "irregular",
      "irrigate",
      "irritable",
      "irritably",
      "irritant",
      "irritate",
      "islamic",
      "islamist",
      "isolated",
      "isolating",
      "isolation",
      "isotope",
      "issue",
      "issuing",
      "italicize",
      "italics",
      "item",
      "itinerary",
      "itunes",
      "ivory",
      "ivy",
      "jab",
      "jackal",
      "jacket",
      "jackknife",
      "jackpot",
      "jailbird",
      "jailbreak",
      "jailer",
      "jailhouse",
      "jalapeno",
      "jam",
      "janitor",
      "january",
      "jargon",
      "jarring",
      "jasmine",
      "jaundice",
      "jaunt",
      "java",
      "jawed",
      "jawless",
      "jawline",
      "jaws",
      "jaybird",
      "jaywalker",
      "jazz",
      "jeep",
      "jeeringly",
      "jellied",
      "jelly",
      "jersey",
      "jester",
      "jet",
      "jiffy",
      "jigsaw",
      "jimmy",
      "jingle",
      "jingling",
      "jinx",
      "jitters",
      "jittery",
      "job",
      "jockey",
      "jockstrap",
      "jogger",
      "jogging",
      "john",
      "joining",
      "jokester",
      "jokingly",
      "jolliness",
      "jolly",
      "jolt",
      "jot",
      "jovial",
      "joyfully",
      "joylessly",
      "joyous",
      "joyride",
      "joystick",
      "jubilance",
      "jubilant",
      "judge",
      "judgingly",
      "judicial",
      "judiciary",
      "judo",
      "juggle",
      "juggling",
      "jugular",
      "juice",
      "juiciness",
      "juicy",
      "jujitsu",
      "jukebox",
      "july",
      "jumble",
      "jumbo",
      "jump",
      "junction",
      "juncture",
      "june",
      "junior",
      "juniper",
      "junkie",
      "junkman",
      "junkyard",
      "jurist",
      "juror",
      "jury",
      "justice",
      "justifier",
      "justify",
      "justly",
      "justness",
      "juvenile",
      "kabob",
      "kangaroo",
      "karaoke",
      "karate",
      "karma",
      "kebab",
      "keenly",
      "keenness",
      "keep",
      "keg",
      "kelp",
      "kennel",
      "kept",
      "kerchief",
      "kerosene",
      "kettle",
      "kick",
      "kiln",
      "kilobyte",
      "kilogram",
      "kilometer",
      "kilowatt",
      "kilt",
      "kimono",
      "kindle",
      "kindling",
      "kindly",
      "kindness",
      "kindred",
      "kinetic",
      "kinfolk",
      "king",
      "kinship",
      "kinsman",
      "kinswoman",
      "kissable",
      "kisser",
      "kissing",
      "kitchen",
      "kite",
      "kitten",
      "kitty",
      "kiwi",
      "kleenex",
      "knapsack",
      "knee",
      "knelt",
      "knickers",
      "knoll",
      "koala",
      "kooky",
      "kosher",
      "krypton",
      "kudos",
      "kung",
      "labored",
      "laborer",
      "laboring",
      "laborious",
      "labrador",
      "ladder",
      "ladies",
      "ladle",
      "ladybug",
      "ladylike",
      "lagged",
      "lagging",
      "lagoon",
      "lair",
      "lake",
      "lance",
      "landed",
      "landfall",
      "landfill",
      "landing",
      "landlady",
      "landless",
      "landline",
      "landlord",
      "landmark",
      "landmass",
      "landmine",
      "landowner",
      "landscape",
      "landside",
      "landslide",
      "language",
      "lankiness",
      "lanky",
      "lantern",
      "lapdog",
      "lapel",
      "lapped",
      "lapping",
      "laptop",
      "lard",
      "large",
      "lark",
      "lash",
      "lasso",
      "last",
      "latch",
      "late",
      "lather",
      "latitude",
      "latrine",
      "latter",
      "latticed",
      "launch",
      "launder",
      "laundry",
      "laurel",
      "lavender",
      "lavish",
      "laxative",
      "lazily",
      "laziness",
      "lazy",
      "lecturer",
      "left",
      "legacy",
      "legal",
      "legend",
      "legged",
      "leggings",
      "legible",
      "legibly",
      "legislate",
      "lego",
      "legroom",
      "legume",
      "legwarmer",
      "legwork",
      "lemon",
      "lend",
      "length",
      "lens",
      "lent",
      "leotard",
      "lesser",
      "letdown",
      "lethargic",
      "lethargy",
      "letter",
      "lettuce",
      "level",
      "leverage",
      "levers",
      "levitate",
      "levitator",
      "liability",
      "liable",
      "liberty",
      "librarian",
      "library",
      "licking",
      "licorice",
      "lid",
      "life",
      "lifter",
      "lifting",
      "liftoff",
      "ligament",
      "likely",
      "likeness",
      "likewise",
      "liking",
      "lilac",
      "lilly",
      "lily",
      "limb",
      "limeade",
      "limelight",
      "limes",
      "limit",
      "limping",
      "limpness",
      "line",
      "lingo",
      "linguini",
      "linguist",
      "lining",
      "linked",
      "linoleum",
      "linseed",
      "lint",
      "lion",
      "lip",
      "liquefy",
      "liqueur",
      "liquid",
      "lisp",
      "list",
      "litigate",
      "litigator",
      "litmus",
      "litter",
      "little",
      "livable",
      "lived",
      "lively",
      "liver",
      "livestock",
      "lividly",
      "living",
      "lizard",
      "lubricant",
      "lubricate",
      "lucid",
      "luckily",
      "luckiness",
      "luckless",
      "lucrative",
      "ludicrous",
      "lugged",
      "lukewarm",
      "lullaby",
      "lumber",
      "luminance",
      "luminous",
      "lumpiness",
      "lumping",
      "lumpish",
      "lunacy",
      "lunar",
      "lunchbox",
      "luncheon",
      "lunchroom",
      "lunchtime",
      "lung",
      "lurch",
      "lure",
      "luridness",
      "lurk",
      "lushly",
      "lushness",
      "luster",
      "lustfully",
      "lustily",
      "lustiness",
      "lustrous",
      "lusty",
      "luxurious",
      "luxury",
      "lying",
      "lyrically",
      "lyricism",
      "lyricist",
      "lyrics",
      "macarena",
      "macaroni",
      "macaw",
      "mace",
      "machine",
      "machinist",
      "magazine",
      "magenta",
      "maggot",
      "magical",
      "magician",
      "magma",
      "magnesium",
      "magnetic",
      "magnetism",
      "magnetize",
      "magnifier",
      "magnify",
      "magnitude",
      "magnolia",
      "mahogany",
      "maimed",
      "majestic",
      "majesty",
      "majorette",
      "majority",
      "makeover",
      "maker",
      "makeshift",
      "making",
      "malformed",
      "malt",
      "mama",
      "mammal",
      "mammary",
      "mammogram",
      "manager",
      "managing",
      "manatee",
      "mandarin",
      "mandate",
      "mandatory",
      "mandolin",
      "manger",
      "mangle",
      "mango",
      "mangy",
      "manhandle",
      "manhole",
      "manhood",
      "manhunt",
      "manicotti",
      "manicure",
      "manifesto",
      "manila",
      "mankind",
      "manlike",
      "manliness",
      "manly",
      "manmade",
      "manned",
      "mannish",
      "manor",
      "manpower",
      "mantis",
      "mantra",
      "manual",
      "many",
      "map",
      "marathon",
      "marauding",
      "marbled",
      "marbles",
      "marbling",
      "march",
      "mardi",
      "margarine",
      "margarita",
      "margin",
      "marigold",
      "marina",
      "marine",
      "marital",
      "maritime",
      "marlin",
      "marmalade",
      "maroon",
      "married",
      "marrow",
      "marry",
      "marshland",
      "marshy",
      "marsupial",
      "marvelous",
      "marxism",
      "mascot",
      "masculine",
      "mashed",
      "mashing",
      "massager",
      "masses",
      "massive",
      "mastiff",
      "matador",
      "matchbook",
      "matchbox",
      "matcher",
      "matching",
      "matchless",
      "material",
      "maternal",
      "maternity",
      "math",
      "mating",
      "matriarch",
      "matrimony",
      "matrix",
      "matron",
      "matted",
      "matter",
      "maturely",
      "maturing",
      "maturity",
      "mauve",
      "maverick",
      "maximize",
      "maximum",
      "maybe",
      "mayday",
      "mayflower",
      "moaner",
      "moaning",
      "mobile",
      "mobility",
      "mobilize",
      "mobster",
      "mocha",
      "mocker",
      "mockup",
      "modified",
      "modify",
      "modular",
      "modulator",
      "module",
      "moisten",
      "moistness",
      "moisture",
      "molar",
      "molasses",
      "mold",
      "molecular",
      "molecule",
      "molehill",
      "mollusk",
      "mom",
      "monastery",
      "monday",
      "monetary",
      "monetize",
      "moneybags",
      "moneyless",
      "moneywise",
      "mongoose",
      "mongrel",
      "monitor",
      "monkhood",
      "monogamy",
      "monogram",
      "monologue",
      "monopoly",
      "monorail",
      "monotone",
      "monotype",
      "monoxide",
      "monsieur",
      "monsoon",
      "monstrous",
      "monthly",
      "monument",
      "moocher",
      "moodiness",
      "moody",
      "mooing",
      "moonbeam",
      "mooned",
      "moonlight",
      "moonlike",
      "moonlit",
      "moonrise",
      "moonscape",
      "moonshine",
      "moonstone",
      "moonwalk",
      "mop",
      "morale",
      "morality",
      "morally",
      "morbidity",
      "morbidly",
      "morphine",
      "morphing",
      "morse",
      "mortality",
      "mortally",
      "mortician",
      "mortified",
      "mortify",
      "mortuary",
      "mosaic",
      "mossy",
      "most",
      "mothball",
      "mothproof",
      "motion",
      "motivate",
      "motivator",
      "motive",
      "motocross",
      "motor",
      "motto",
      "mountable",
      "mountain",
      "mounted",
      "mounting",
      "mourner",
      "mournful",
      "mouse",
      "mousiness",
      "moustache",
      "mousy",
      "mouth",
      "movable",
      "move",
      "movie",
      "moving",
      "mower",
      "mowing",
      "much",
      "muck",
      "mud",
      "mug",
      "mulberry",
      "mulch",
      "mule",
      "mulled",
      "mullets",
      "multiple",
      "multiply",
      "multitask",
      "multitude",
      "mumble",
      "mumbling",
      "mumbo",
      "mummified",
      "mummify",
      "mummy",
      "mumps",
      "munchkin",
      "mundane",
      "municipal",
      "muppet",
      "mural",
      "murkiness",
      "murky",
      "murmuring",
      "muscular",
      "museum",
      "mushily",
      "mushiness",
      "mushroom",
      "mushy",
      "music",
      "musket",
      "muskiness",
      "musky",
      "mustang",
      "mustard",
      "muster",
      "mustiness",
      "musty",
      "mutable",
      "mutate",
      "mutation",
      "mute",
      "mutilated",
      "mutilator",
      "mutiny",
      "mutt",
      "mutual",
      "muzzle",
      "myself",
      "myspace",
      "mystified",
      "mystify",
      "myth",
      "nacho",
      "nag",
      "nail",
      "name",
      "naming",
      "nanny",
      "nanometer",
      "nape",
      "napkin",
      "napped",
      "napping",
      "nappy",
      "narrow",
      "nastily",
      "nastiness",
      "national",
      "native",
      "nativity",
      "natural",
      "nature",
      "naturist",
      "nautical",
      "navigate",
      "navigator",
      "navy",
      "nearby",
      "nearest",
      "nearly",
      "nearness",
      "neatly",
      "neatness",
      "nebula",
      "nebulizer",
      "nectar",
      "negate",
      "negation",
      "negative",
      "neglector",
      "negligee",
      "negligent",
      "negotiate",
      "nemeses",
      "nemesis",
      "neon",
      "nephew",
      "nerd",
      "nervous",
      "nervy",
      "nest",
      "net",
      "neurology",
      "neuron",
      "neurosis",
      "neurotic",
      "neuter",
      "neutron",
      "never",
      "next",
      "nibble",
      "nickname",
      "nicotine",
      "niece",
      "nifty",
      "nimble",
      "nimbly",
      "nineteen",
      "ninetieth",
      "ninja",
      "nintendo",
      "ninth",
      "nuclear",
      "nuclei",
      "nucleus",
      "nugget",
      "nullify",
      "number",
      "numbing",
      "numbly",
      "numbness",
      "numeral",
      "numerate",
      "numerator",
      "numeric",
      "numerous",
      "nuptials",
      "nursery",
      "nursing",
      "nurture",
      "nutcase",
      "nutlike",
      "nutmeg",
      "nutrient",
      "nutshell",
      "nuttiness",
      "nutty",
      "nuzzle",
      "nylon",
      "oaf",
      "oak",
      "oasis",
      "oat",
      "obedience",
      "obedient",
      "obituary",
      "object",
      "obligate",
      "obliged",
      "oblivion",
      "oblivious",
      "oblong",
      "obnoxious",
      "oboe",
      "obscure",
      "obscurity",
      "observant",
      "observer",
      "observing",
      "obsessed",
      "obsession",
      "obsessive",
      "obsolete",
      "obstacle",
      "obstinate",
      "obstruct",
      "obtain",
      "obtrusive",
      "obtuse",
      "obvious",
      "occultist",
      "occupancy",
      "occupant",
      "occupier",
      "occupy",
      "ocean",
      "ocelot",
      "octagon",
      "octane",
      "october",
      "octopus",
      "ogle",
      "oil",
      "oink",
      "ointment",
      "okay",
      "old",
      "olive",
      "olympics",
      "omega",
      "omen",
      "ominous",
      "omission",
      "omit",
      "omnivore",
      "onboard",
      "oncoming",
      "ongoing",
      "onion",
      "online",
      "onlooker",
      "only",
      "onscreen",
      "onset",
      "onshore",
      "onslaught",
      "onstage",
      "onto",
      "onward",
      "onyx",
      "oops",
      "ooze",
      "oozy",
      "opacity",
      "opal",
      "open",
      "operable",
      "operate",
      "operating",
      "operation",
      "operative",
      "operator",
      "opium",
      "opossum",
      "opponent",
      "oppose",
      "opposing",
      "opposite",
      "oppressed",
      "oppressor",
      "opt",
      "opulently",
      "osmosis",
      "other",
      "otter",
      "ouch",
      "ought",
      "ounce",
      "outage",
      "outback",
      "outbid",
      "outboard",
      "outbound",
      "outbreak",
      "outburst",
      "outcast",
      "outclass",
      "outcome",
      "outdated",
      "outdoors",
      "outer",
      "outfield",
      "outfit",
      "outflank",
      "outgoing",
      "outgrow",
      "outhouse",
      "outing",
      "outlast",
      "outlet",
      "outline",
      "outlook",
      "outlying",
      "outmatch",
      "outmost",
      "outnumber",
      "outplayed",
      "outpost",
      "outpour",
      "output",
      "outrage",
      "outrank",
      "outreach",
      "outright",
      "outscore",
      "outsell",
      "outshine",
      "outshoot",
      "outsider",
      "outskirts",
      "outsmart",
      "outsource",
      "outspoken",
      "outtakes",
      "outthink",
      "outward",
      "outweigh",
      "outwit",
      "oval",
      "ovary",
      "oven",
      "overact",
      "overall",
      "overarch",
      "overbid",
      "overbill",
      "overbite",
      "overblown",
      "overboard",
      "overbook",
      "overbuilt",
      "overcast",
      "overcoat",
      "overcome",
      "overcook",
      "overcrowd",
      "overdraft",
      "overdrawn",
      "overdress",
      "overdrive",
      "overdue",
      "overeager",
      "overeater",
      "overexert",
      "overfed",
      "overfeed",
      "overfill",
      "overflow",
      "overfull",
      "overgrown",
      "overhand",
      "overhang",
      "overhaul",
      "overhead",
      "overhear",
      "overheat",
      "overhung",
      "overjoyed",
      "overkill",
      "overlabor",
      "overlaid",
      "overlap",
      "overlay",
      "overload",
      "overlook",
      "overlord",
      "overlying",
      "overnight",
      "overpass",
      "overpay",
      "overplant",
      "overplay",
      "overpower",
      "overprice",
      "overrate",
      "overreach",
      "overreact",
      "override",
      "overripe",
      "overrule",
      "overrun",
      "overshoot",
      "overshot",
      "oversight",
      "oversized",
      "oversleep",
      "oversold",
      "overspend",
      "overstate",
      "overstay",
      "overstep",
      "overstock",
      "overstuff",
      "oversweet",
      "overtake",
      "overthrow",
      "overtime",
      "overtly",
      "overtone",
      "overture",
      "overturn",
      "overuse",
      "overvalue",
      "overview",
      "overwrite",
      "owl",
      "oxford",
      "oxidant",
      "oxidation",
      "oxidize",
      "oxidizing",
      "oxygen",
      "oxymoron",
      "oyster",
      "ozone",
      "paced",
      "pacemaker",
      "pacific",
      "pacifier",
      "pacifism",
      "pacifist",
      "pacify",
      "padded",
      "padding",
      "paddle",
      "paddling",
      "padlock",
      "pagan",
      "pager",
      "paging",
      "pajamas",
      "palace",
      "palatable",
      "palm",
      "palpable",
      "palpitate",
      "paltry",
      "pampered",
      "pamperer",
      "pampers",
      "pamphlet",
      "panama",
      "pancake",
      "pancreas",
      "panda",
      "pandemic",
      "pang",
      "panhandle",
      "panic",
      "panning",
      "panorama",
      "panoramic",
      "panther",
      "pantomime",
      "pantry",
      "pants",
      "pantyhose",
      "paparazzi",
      "papaya",
      "paper",
      "paprika",
      "papyrus",
      "parabola",
      "parachute",
      "parade",
      "paradox",
      "paragraph",
      "parakeet",
      "paralegal",
      "paralyses",
      "paralysis",
      "paralyze",
      "paramedic",
      "parameter",
      "paramount",
      "parasail",
      "parasite",
      "parasitic",
      "parcel",
      "parched",
      "parchment",
      "pardon",
      "parish",
      "parka",
      "parking",
      "parkway",
      "parlor",
      "parmesan",
      "parole",
      "parrot",
      "parsley",
      "parsnip",
      "partake",
      "parted",
      "parting",
      "partition",
      "partly",
      "partner",
      "partridge",
      "party",
      "passable",
      "passably",
      "passage",
      "passcode",
      "passenger",
      "passerby",
      "passing",
      "passion",
      "passive",
      "passivism",
      "passover",
      "passport",
      "password",
      "pasta",
      "pasted",
      "pastel",
      "pastime",
      "pastor",
      "pastrami",
      "pasture",
      "pasty",
      "patchwork",
      "patchy",
      "paternal",
      "paternity",
      "path",
      "patience",
      "patient",
      "patio",
      "patriarch",
      "patriot",
      "patrol",
      "patronage",
      "patronize",
      "pauper",
      "pavement",
      "paver",
      "pavestone",
      "pavilion",
      "paving",
      "pawing",
      "payable",
      "payback",
      "paycheck",
      "payday",
      "payee",
      "payer",
      "paying",
      "payment",
      "payphone",
      "payroll",
      "pebble",
      "pebbly",
      "pecan",
      "pectin",
      "peculiar",
      "peddling",
      "pediatric",
      "pedicure",
      "pedigree",
      "pedometer",
      "pegboard",
      "pelican",
      "pellet",
      "pelt",
      "pelvis",
      "penalize",
      "penalty",
      "pencil",
      "pendant",
      "pending",
      "penholder",
      "penknife",
      "pennant",
      "penniless",
      "penny",
      "penpal",
      "pension",
      "pentagon",
      "pentagram",
      "pep",
      "perceive",
      "percent",
      "perch",
      "percolate",
      "perennial",
      "perfected",
      "perfectly",
      "perfume",
      "periscope",
      "perish",
      "perjurer",
      "perjury",
      "perkiness",
      "perky",
      "perm",
      "peroxide",
      "perpetual",
      "perplexed",
      "persecute",
      "persevere",
      "persuaded",
      "persuader",
      "pesky",
      "peso",
      "pessimism",
      "pessimist",
      "pester",
      "pesticide",
      "petal",
      "petite",
      "petition",
      "petri",
      "petroleum",
      "petted",
      "petticoat",
      "pettiness",
      "petty",
      "petunia",
      "phantom",
      "phobia",
      "phoenix",
      "phonebook",
      "phoney",
      "phonics",
      "phoniness",
      "phony",
      "phosphate",
      "photo",
      "phrase",
      "phrasing",
      "placard",
      "placate",
      "placidly",
      "plank",
      "planner",
      "plant",
      "plasma",
      "plaster",
      "plastic",
      "plated",
      "platform",
      "plating",
      "platinum",
      "platonic",
      "platter",
      "platypus",
      "plausible",
      "plausibly",
      "playable",
      "playback",
      "player",
      "playful",
      "playgroup",
      "playhouse",
      "playing",
      "playlist",
      "playmaker",
      "playmate",
      "playoff",
      "playpen",
      "playroom",
      "playset",
      "plaything",
      "playtime",
      "plaza",
      "pleading",
      "pleat",
      "pledge",
      "plentiful",
      "plenty",
      "plethora",
      "plexiglas",
      "pliable",
      "plod",
      "plop",
      "plot",
      "plow",
      "ploy",
      "pluck",
      "plug",
      "plunder",
      "plunging",
      "plural",
      "plus",
      "plutonium",
      "plywood",
      "poach",
      "pod",
      "poem",
      "poet",
      "pogo",
      "pointed",
      "pointer",
      "pointing",
      "pointless",
      "pointy",
      "poise",
      "poison",
      "poker",
      "poking",
      "polar",
      "police",
      "policy",
      "polio",
      "polish",
      "politely",
      "polka",
      "polo",
      "polyester",
      "polygon",
      "polygraph",
      "polymer",
      "poncho",
      "pond",
      "pony",
      "popcorn",
      "pope",
      "poplar",
      "popper",
      "poppy",
      "popsicle",
      "populace",
      "popular",
      "populate",
      "porcupine",
      "pork",
      "porous",
      "porridge",
      "portable",
      "portal",
      "portfolio",
      "porthole",
      "portion",
      "portly",
      "portside",
      "poser",
      "posh",
      "posing",
      "possible",
      "possibly",
      "possum",
      "postage",
      "postal",
      "postbox",
      "postcard",
      "posted",
      "poster",
      "posting",
      "postnasal",
      "posture",
      "postwar",
      "pouch",
      "pounce",
      "pouncing",
      "pound",
      "pouring",
      "pout",
      "powdered",
      "powdering",
      "powdery",
      "power",
      "powwow",
      "pox",
      "praising",
      "prance",
      "prancing",
      "pranker",
      "prankish",
      "prankster",
      "prayer",
      "praying",
      "preacher",
      "preaching",
      "preachy",
      "preamble",
      "precinct",
      "precise",
      "precision",
      "precook",
      "precut",
      "predator",
      "predefine",
      "predict",
      "preface",
      "prefix",
      "preflight",
      "preformed",
      "pregame",
      "pregnancy",
      "pregnant",
      "preheated",
      "prelaunch",
      "prelaw",
      "prelude",
      "premiere",
      "premises",
      "premium",
      "prenatal",
      "preoccupy",
      "preorder",
      "prepaid",
      "prepay",
      "preplan",
      "preppy",
      "preschool",
      "prescribe",
      "preseason",
      "preset",
      "preshow",
      "president",
      "presoak",
      "press",
      "presume",
      "presuming",
      "preteen",
      "pretended",
      "pretender",
      "pretense",
      "pretext",
      "pretty",
      "pretzel",
      "prevail",
      "prevalent",
      "prevent",
      "preview",
      "previous",
      "prewar",
      "prewashed",
      "prideful",
      "pried",
      "primal",
      "primarily",
      "primary",
      "primate",
      "primer",
      "primp",
      "princess",
      "print",
      "prior",
      "prism",
      "prison",
      "prissy",
      "pristine",
      "privacy",
      "private",
      "privatize",
      "prize",
      "proactive",
      "probable",
      "probably",
      "probation",
      "probe",
      "probing",
      "probiotic",
      "problem",
      "procedure",
      "process",
      "proclaim",
      "procreate",
      "procurer",
      "prodigal",
      "prodigy",
      "produce",
      "product",
      "profane",
      "profanity",
      "professed",
      "professor",
      "profile",
      "profound",
      "profusely",
      "progeny",
      "prognosis",
      "program",
      "progress",
      "projector",
      "prologue",
      "prolonged",
      "promenade",
      "prominent",
      "promoter",
      "promotion",
      "prompter",
      "promptly",
      "prone",
      "prong",
      "pronounce",
      "pronto",
      "proofing",
      "proofread",
      "proofs",
      "propeller",
      "properly",
      "property",
      "proponent",
      "proposal",
      "propose",
      "props",
      "prorate",
      "protector",
      "protegee",
      "proton",
      "prototype",
      "protozoan",
      "protract",
      "protrude",
      "proud",
      "provable",
      "proved",
      "proven",
      "provided",
      "provider",
      "providing",
      "province",
      "proving",
      "provoke",
      "provoking",
      "provolone",
      "prowess",
      "prowler",
      "prowling",
      "proximity",
      "proxy",
      "prozac",
      "prude",
      "prudishly",
      "prune",
      "pruning",
      "pry",
      "psychic",
      "public",
      "publisher",
      "pucker",
      "pueblo",
      "pug",
      "pull",
      "pulmonary",
      "pulp",
      "pulsate",
      "pulse",
      "pulverize",
      "puma",
      "pumice",
      "pummel",
      "punch",
      "punctual",
      "punctuate",
      "punctured",
      "pungent",
      "punisher",
      "punk",
      "pupil",
      "puppet",
      "puppy",
      "purchase",
      "pureblood",
      "purebred",
      "purely",
      "pureness",
      "purgatory",
      "purge",
      "purging",
      "purifier",
      "purify",
      "purist",
      "puritan",
      "purity",
      "purple",
      "purplish",
      "purposely",
      "purr",
      "purse",
      "pursuable",
      "pursuant",
      "pursuit",
      "purveyor",
      "pushcart",
      "pushchair",
      "pusher",
      "pushiness",
      "pushing",
      "pushover",
      "pushpin",
      "pushup",
      "pushy",
      "putdown",
      "putt",
      "puzzle",
      "puzzling",
      "pyramid",
      "pyromania",
      "python",
      "quack",
      "quadrant",
      "quail",
      "quaintly",
      "quake",
      "quaking",
      "qualified",
      "qualifier",
      "qualify",
      "quality",
      "qualm",
      "quantum",
      "quarrel",
      "quarry",
      "quartered",
      "quarterly",
      "quarters",
      "quartet",
      "quench",
      "query",
      "quicken",
      "quickly",
      "quickness",
      "quicksand",
      "quickstep",
      "quiet",
      "quill",
      "quilt",
      "quintet",
      "quintuple",
      "quirk",
      "quit",
      "quiver",
      "quizzical",
      "quotable",
      "quotation",
      "quote",
      "rabid",
      "race",
      "racing",
      "racism",
      "rack",
      "racoon",
      "radar",
      "radial",
      "radiance",
      "radiantly",
      "radiated",
      "radiation",
      "radiator",
      "radio",
      "radish",
      "raffle",
      "raft",
      "rage",
      "ragged",
      "raging",
      "ragweed",
      "raider",
      "railcar",
      "railing",
      "railroad",
      "railway",
      "raisin",
      "rake",
      "raking",
      "rally",
      "ramble",
      "rambling",
      "ramp",
      "ramrod",
      "ranch",
      "rancidity",
      "random",
      "ranged",
      "ranger",
      "ranging",
      "ranked",
      "ranking",
      "ransack",
      "ranting",
      "rants",
      "rare",
      "rarity",
      "rascal",
      "rash",
      "rasping",
      "ravage",
      "raven",
      "ravine",
      "raving",
      "ravioli",
      "ravishing",
      "reabsorb",
      "reach",
      "reacquire",
      "reaction",
      "reactive",
      "reactor",
      "reaffirm",
      "ream",
      "reanalyze",
      "reappear",
      "reapply",
      "reappoint",
      "reapprove",
      "rearrange",
      "rearview",
      "reason",
      "reassign",
      "reassure",
      "reattach",
      "reawake",
      "rebalance",
      "rebate",
      "rebel",
      "rebirth",
      "reboot",
      "reborn",
      "rebound",
      "rebuff",
      "rebuild",
      "rebuilt",
      "reburial",
      "rebuttal",
      "recall",
      "recant",
      "recapture",
      "recast",
      "recede",
      "recent",
      "recess",
      "recharger",
      "recipient",
      "recital",
      "recite",
      "reckless",
      "reclaim",
      "recliner",
      "reclining",
      "recluse",
      "reclusive",
      "recognize",
      "recoil",
      "recollect",
      "recolor",
      "reconcile",
      "reconfirm",
      "reconvene",
      "recopy",
      "record",
      "recount",
      "recoup",
      "recovery",
      "recreate",
      "rectal",
      "rectangle",
      "rectified",
      "rectify",
      "recycled",
      "recycler",
      "recycling",
      "reemerge",
      "reenact",
      "reenter",
      "reentry",
      "reexamine",
      "referable",
      "referee",
      "reference",
      "refill",
      "refinance",
      "refined",
      "refinery",
      "refining",
      "refinish",
      "reflected",
      "reflector",
      "reflex",
      "reflux",
      "refocus",
      "refold",
      "reforest",
      "reformat",
      "reformed",
      "reformer",
      "reformist",
      "refract",
      "refrain",
      "refreeze",
      "refresh",
      "refried",
      "refueling",
      "refund",
      "refurbish",
      "refurnish",
      "refusal",
      "refuse",
      "refusing",
      "refutable",
      "refute",
      "regain",
      "regalia",
      "regally",
      "reggae",
      "regime",
      "region",
      "register",
      "registrar",
      "registry",
      "regress",
      "regretful",
      "regroup",
      "regular",
      "regulate",
      "regulator",
      "rehab",
      "reheat",
      "rehire",
      "rehydrate",
      "reimburse",
      "reissue",
      "reiterate",
      "rejoice",
      "rejoicing",
      "rejoin",
      "rekindle",
      "relapse",
      "relapsing",
      "relatable",
      "related",
      "relation",
      "relative",
      "relax",
      "relay",
      "relearn",
      "release",
      "relenting",
      "reliable",
      "reliably",
      "reliance",
      "reliant",
      "relic",
      "relieve",
      "relieving",
      "relight",
      "relish",
      "relive",
      "reload",
      "relocate",
      "relock",
      "reluctant",
      "rely",
      "remake",
      "remark",
      "remarry",
      "rematch",
      "remedial",
      "remedy",
      "remember",
      "reminder",
      "remindful",
      "remission",
      "remix",
      "remnant",
      "remodeler",
      "remold",
      "remorse",
      "remote",
      "removable",
      "removal",
      "removed",
      "remover",
      "removing",
      "rename",
      "renderer",
      "rendering",
      "rendition",
      "renegade",
      "renewable",
      "renewably",
      "renewal",
      "renewed",
      "renounce",
      "renovate",
      "renovator",
      "rentable",
      "rental",
      "rented",
      "renter",
      "reoccupy",
      "reoccur",
      "reopen",
      "reorder",
      "repackage",
      "repacking",
      "repaint",
      "repair",
      "repave",
      "repaying",
      "repayment",
      "repeal",
      "repeated",
      "repeater",
      "repent",
      "rephrase",
      "replace",
      "replay",
      "replica",
      "reply",
      "reporter",
      "repose",
      "repossess",
      "repost",
      "repressed",
      "reprimand",
      "reprint",
      "reprise",
      "reproach",
      "reprocess",
      "reproduce",
      "reprogram",
      "reps",
      "reptile",
      "reptilian",
      "repugnant",
      "repulsion",
      "repulsive",
      "repurpose",
      "reputable",
      "reputably",
      "request",
      "require",
      "requisite",
      "reroute",
      "rerun",
      "resale",
      "resample",
      "rescuer",
      "reseal",
      "research",
      "reselect",
      "reseller",
      "resemble",
      "resend",
      "resent",
      "reset",
      "reshape",
      "reshoot",
      "reshuffle",
      "residence",
      "residency",
      "resident",
      "residual",
      "residue",
      "resigned",
      "resilient",
      "resistant",
      "resisting",
      "resize",
      "resolute",
      "resolved",
      "resonant",
      "resonate",
      "resort",
      "resource",
      "respect",
      "resubmit",
      "result",
      "resume",
      "resupply",
      "resurface",
      "resurrect",
      "retail",
      "retainer",
      "retaining",
      "retake",
      "retaliate",
      "retention",
      "rethink",
      "retinal",
      "retired",
      "retiree",
      "retiring",
      "retold",
      "retool",
      "retorted",
      "retouch",
      "retrace",
      "retract",
      "retrain",
      "retread",
      "retreat",
      "retrial",
      "retrieval",
      "retriever",
      "retry",
      "return",
      "retying",
      "retype",
      "reunion",
      "reunite",
      "reusable",
      "reuse",
      "reveal",
      "reveler",
      "revenge",
      "revenue",
      "reverb",
      "revered",
      "reverence",
      "reverend",
      "reversal",
      "reverse",
      "reversing",
      "reversion",
      "revert",
      "revisable",
      "revise",
      "revision",
      "revisit",
      "revivable",
      "revival",
      "reviver",
      "reviving",
      "revocable",
      "revoke",
      "revolt",
      "revolver",
      "revolving",
      "reward",
      "rewash",
      "rewind",
      "rewire",
      "reword",
      "rework",
      "rewrap",
      "rewrite",
      "rhyme",
      "ribbon",
      "ribcage",
      "rice",
      "riches",
      "richly",
      "richness",
      "rickety",
      "ricotta",
      "riddance",
      "ridden",
      "ride",
      "riding",
      "rifling",
      "rift",
      "rigging",
      "rigid",
      "rigor",
      "rimless",
      "rimmed",
      "rind",
      "rink",
      "rinse",
      "rinsing",
      "riot",
      "ripcord",
      "ripeness",
      "ripening",
      "ripping",
      "ripple",
      "rippling",
      "riptide",
      "rise",
      "rising",
      "risk",
      "risotto",
      "ritalin",
      "ritzy",
      "rival",
      "riverbank",
      "riverbed",
      "riverboat",
      "riverside",
      "riveter",
      "riveting",
      "roamer",
      "roaming",
      "roast",
      "robbing",
      "robe",
      "robin",
      "robotics",
      "robust",
      "rockband",
      "rocker",
      "rocket",
      "rockfish",
      "rockiness",
      "rocking",
      "rocklike",
      "rockslide",
      "rockstar",
      "rocky",
      "rogue",
      "roman",
      "romp",
      "rope",
      "roping",
      "roster",
      "rosy",
      "rotten",
      "rotting",
      "rotunda",
      "roulette",
      "rounding",
      "roundish",
      "roundness",
      "roundup",
      "roundworm",
      "routine",
      "routing",
      "rover",
      "roving",
      "royal",
      "rubbed",
      "rubber",
      "rubbing",
      "rubble",
      "rubdown",
      "ruby",
      "ruckus",
      "rudder",
      "rug",
      "ruined",
      "rule",
      "rumble",
      "rumbling",
      "rummage",
      "rumor",
      "runaround",
      "rundown",
      "runner",
      "running",
      "runny",
      "runt",
      "runway",
      "rupture",
      "rural",
      "ruse",
      "rush",
      "rust",
      "rut",
      "sabbath",
      "sabotage",
      "sacrament",
      "sacred",
      "sacrifice",
      "sadden",
      "saddlebag",
      "saddled",
      "saddling",
      "sadly",
      "sadness",
      "safari",
      "safeguard",
      "safehouse",
      "safely",
      "safeness",
      "saffron",
      "saga",
      "sage",
      "sagging",
      "saggy",
      "said",
      "saint",
      "sake",
      "salad",
      "salami",
      "salaried",
      "salary",
      "saline",
      "salon",
      "saloon",
      "salsa",
      "salt",
      "salutary",
      "salute",
      "salvage",
      "salvaging",
      "salvation",
      "same",
      "sample",
      "sampling",
      "sanction",
      "sanctity",
      "sanctuary",
      "sandal",
      "sandbag",
      "sandbank",
      "sandbar",
      "sandblast",
      "sandbox",
      "sanded",
      "sandfish",
      "sanding",
      "sandlot",
      "sandpaper",
      "sandpit",
      "sandstone",
      "sandstorm",
      "sandworm",
      "sandy",
      "sanitary",
      "sanitizer",
      "sank",
      "santa",
      "sapling",
      "sappiness",
      "sappy",
      "sarcasm",
      "sarcastic",
      "sardine",
      "sash",
      "sasquatch",
      "sassy",
      "satchel",
      "satiable",
      "satin",
      "satirical",
      "satisfied",
      "satisfy",
      "saturate",
      "saturday",
      "sauciness",
      "saucy",
      "sauna",
      "savage",
      "savanna",
      "saved",
      "savings",
      "savior",
      "savor",
      "saxophone",
      "say",
      "scabbed",
      "scabby",
      "scalded",
      "scalding",
      "scale",
      "scaling",
      "scallion",
      "scallop",
      "scalping",
      "scam",
      "scandal",
      "scanner",
      "scanning",
      "scant",
      "scapegoat",
      "scarce",
      "scarcity",
      "scarecrow",
      "scared",
      "scarf",
      "scarily",
      "scariness",
      "scarring",
      "scary",
      "scavenger",
      "scenic",
      "schedule",
      "schematic",
      "scheme",
      "scheming",
      "schilling",
      "schnapps",
      "scholar",
      "science",
      "scientist",
      "scion",
      "scoff",
      "scolding",
      "scone",
      "scoop",
      "scooter",
      "scope",
      "scorch",
      "scorebook",
      "scorecard",
      "scored",
      "scoreless",
      "scorer",
      "scoring",
      "scorn",
      "scorpion",
      "scotch",
      "scoundrel",
      "scoured",
      "scouring",
      "scouting",
      "scouts",
      "scowling",
      "scrabble",
      "scraggly",
      "scrambled",
      "scrambler",
      "scrap",
      "scratch",
      "scrawny",
      "screen",
      "scribble",
      "scribe",
      "scribing",
      "scrimmage",
      "script",
      "scroll",
      "scrooge",
      "scrounger",
      "scrubbed",
      "scrubber",
      "scruffy",
      "scrunch",
      "scrutiny",
      "scuba",
      "scuff",
      "sculptor",
      "sculpture",
      "scurvy",
      "scuttle",
      "secluded",
      "secluding",
      "seclusion",
      "second",
      "secrecy",
      "secret",
      "sectional",
      "sector",
      "secular",
      "securely",
      "security",
      "sedan",
      "sedate",
      "sedation",
      "sedative",
      "sediment",
      "seduce",
      "seducing",
      "segment",
      "seismic",
      "seizing",
      "seldom",
      "selected",
      "selection",
      "selective",
      "selector",
      "self",
      "seltzer",
      "semantic",
      "semester",
      "semicolon",
      "semifinal",
      "seminar",
      "semisoft",
      "semisweet",
      "senate",
      "senator",
      "send",
      "senior",
      "senorita",
      "sensation",
      "sensitive",
      "sensitize",
      "sensually",
      "sensuous",
      "sepia",
      "september",
      "septic",
      "septum",
      "sequel",
      "sequence",
      "sequester",
      "series",
      "sermon",
      "serotonin",
      "serpent",
      "serrated",
      "serve",
      "service",
      "serving",
      "sesame",
      "sessions",
      "setback",
      "setting",
      "settle",
      "settling",
      "setup",
      "sevenfold",
      "seventeen",
      "seventh",
      "seventy",
      "severity",
      "shabby",
      "shack",
      "shaded",
      "shadily",
      "shadiness",
      "shading",
      "shadow",
      "shady",
      "shaft",
      "shakable",
      "shakily",
      "shakiness",
      "shaking",
      "shaky",
      "shale",
      "shallot",
      "shallow",
      "shame",
      "shampoo",
      "shamrock",
      "shank",
      "shanty",
      "shape",
      "shaping",
      "share",
      "sharpener",
      "sharper",
      "sharpie",
      "sharply",
      "sharpness",
      "shawl",
      "sheath",
      "shed",
      "sheep",
      "sheet",
      "shelf",
      "shell",
      "shelter",
      "shelve",
      "shelving",
      "sherry",
      "shield",
      "shifter",
      "shifting",
      "shiftless",
      "shifty",
      "shimmer",
      "shimmy",
      "shindig",
      "shine",
      "shingle",
      "shininess",
      "shining",
      "shiny",
      "ship",
      "shirt",
      "shivering",
      "shock",
      "shone",
      "shoplift",
      "shopper",
      "shopping",
      "shoptalk",
      "shore",
      "shortage",
      "shortcake",
      "shortcut",
      "shorten",
      "shorter",
      "shorthand",
      "shortlist",
      "shortly",
      "shortness",
      "shorts",
      "shortwave",
      "shorty",
      "shout",
      "shove",
      "showbiz",
      "showcase",
      "showdown",
      "shower",
      "showgirl",
      "showing",
      "showman",
      "shown",
      "showoff",
      "showpiece",
      "showplace",
      "showroom",
      "showy",
      "shrank",
      "shrapnel",
      "shredder",
      "shredding",
      "shrewdly",
      "shriek",
      "shrill",
      "shrimp",
      "shrine",
      "shrink",
      "shrivel",
      "shrouded",
      "shrubbery",
      "shrubs",
      "shrug",
      "shrunk",
      "shucking",
      "shudder",
      "shuffle",
      "shuffling",
      "shun",
      "shush",
      "shut",
      "shy",
      "siamese",
      "siberian",
      "sibling",
      "siding",
      "sierra",
      "siesta",
      "sift",
      "sighing",
      "silenced",
      "silencer",
      "silent",
      "silica",
      "silicon",
      "silk",
      "silliness",
      "silly",
      "silo",
      "silt",
      "silver",
      "similarly",
      "simile",
      "simmering",
      "simple",
      "simplify",
      "simply",
      "sincere",
      "sincerity",
      "singer",
      "singing",
      "single",
      "singular",
      "sinister",
      "sinless",
      "sinner",
      "sinuous",
      "sip",
      "siren",
      "sister",
      "sitcom",
      "sitter",
      "sitting",
      "situated",
      "situation",
      "sixfold",
      "sixteen",
      "sixth",
      "sixties",
      "sixtieth",
      "sixtyfold",
      "sizable",
      "sizably",
      "size",
      "sizing",
      "sizzle",
      "sizzling",
      "skater",
      "skating",
      "skedaddle",
      "skeletal",
      "skeleton",
      "skeptic",
      "sketch",
      "skewed",
      "skewer",
      "skid",
      "skied",
      "skier",
      "skies",
      "skiing",
      "skilled",
      "skillet",
      "skillful",
      "skimmed",
      "skimmer",
      "skimming",
      "skimpily",
      "skincare",
      "skinhead",
      "skinless",
      "skinning",
      "skinny",
      "skintight",
      "skipper",
      "skipping",
      "skirmish",
      "skirt",
      "skittle",
      "skydiver",
      "skylight",
      "skyline",
      "skype",
      "skyrocket",
      "skyward",
      "slab",
      "slacked",
      "slacker",
      "slacking",
      "slackness",
      "slacks",
      "slain",
      "slam",
      "slander",
      "slang",
      "slapping",
      "slapstick",
      "slashed",
      "slashing",
      "slate",
      "slather",
      "slaw",
      "sled",
      "sleek",
      "sleep",
      "sleet",
      "sleeve",
      "slept",
      "sliceable",
      "sliced",
      "slicer",
      "slicing",
      "slick",
      "slider",
      "slideshow",
      "sliding",
      "slighted",
      "slighting",
      "slightly",
      "slimness",
      "slimy",
      "slinging",
      "slingshot",
      "slinky",
      "slip",
      "slit",
      "sliver",
      "slobbery",
      "slogan",
      "sloped",
      "sloping",
      "sloppily",
      "sloppy",
      "slot",
      "slouching",
      "slouchy",
      "sludge",
      "slug",
      "slum",
      "slurp",
      "slush",
      "sly",
      "small",
      "smartly",
      "smartness",
      "smasher",
      "smashing",
      "smashup",
      "smell",
      "smelting",
      "smile",
      "smilingly",
      "smirk",
      "smite",
      "smith",
      "smitten",
      "smock",
      "smog",
      "smoked",
      "smokeless",
      "smokiness",
      "smoking",
      "smoky",
      "smolder",
      "smooth",
      "smother",
      "smudge",
      "smudgy",
      "smuggler",
      "smuggling",
      "smugly",
      "smugness",
      "snack",
      "snagged",
      "snaking",
      "snap",
      "snare",
      "snarl",
      "snazzy",
      "sneak",
      "sneer",
      "sneeze",
      "sneezing",
      "snide",
      "sniff",
      "snippet",
      "snipping",
      "snitch",
      "snooper",
      "snooze",
      "snore",
      "snoring",
      "snorkel",
      "snort",
      "snout",
      "snowbird",
      "snowboard",
      "snowbound",
      "snowcap",
      "snowdrift",
      "snowdrop",
      "snowfall",
      "snowfield",
      "snowflake",
      "snowiness",
      "snowless",
      "snowman",
      "snowplow",
      "snowshoe",
      "snowstorm",
      "snowsuit",
      "snowy",
      "snub",
      "snuff",
      "snuggle",
      "snugly",
      "snugness",
      "speak",
      "spearfish",
      "spearhead",
      "spearman",
      "spearmint",
      "species",
      "specimen",
      "specked",
      "speckled",
      "specks",
      "spectacle",
      "spectator",
      "spectrum",
      "speculate",
      "speech",
      "speed",
      "spellbind",
      "speller",
      "spelling",
      "spendable",
      "spender",
      "spending",
      "spent",
      "spew",
      "sphere",
      "spherical",
      "sphinx",
      "spider",
      "spied",
      "spiffy",
      "spill",
      "spilt",
      "spinach",
      "spinal",
      "spindle",
      "spinner",
      "spinning",
      "spinout",
      "spinster",
      "spiny",
      "spiral",
      "spirited",
      "spiritism",
      "spirits",
      "spiritual",
      "splashed",
      "splashing",
      "splashy",
      "splatter",
      "spleen",
      "splendid",
      "splendor",
      "splice",
      "splicing",
      "splinter",
      "splotchy",
      "splurge",
      "spoilage",
      "spoiled",
      "spoiler",
      "spoiling",
      "spoils",
      "spoken",
      "spokesman",
      "sponge",
      "spongy",
      "sponsor",
      "spoof",
      "spookily",
      "spooky",
      "spool",
      "spoon",
      "spore",
      "sporting",
      "sports",
      "sporty",
      "spotless",
      "spotlight",
      "spotted",
      "spotter",
      "spotting",
      "spotty",
      "spousal",
      "spouse",
      "spout",
      "sprain",
      "sprang",
      "sprawl",
      "spray",
      "spree",
      "sprig",
      "spring",
      "sprinkled",
      "sprinkler",
      "sprint",
      "sprite",
      "sprout",
      "spruce",
      "sprung",
      "spry",
      "spud",
      "spur",
      "sputter",
      "spyglass",
      "squabble",
      "squad",
      "squall",
      "squander",
      "squash",
      "squatted",
      "squatter",
      "squatting",
      "squeak",
      "squealer",
      "squealing",
      "squeamish",
      "squeegee",
      "squeeze",
      "squeezing",
      "squid",
      "squiggle",
      "squiggly",
      "squint",
      "squire",
      "squirt",
      "squishier",
      "squishy",
      "stability",
      "stabilize",
      "stable",
      "stack",
      "stadium",
      "staff",
      "stage",
      "staging",
      "stagnant",
      "stagnate",
      "stainable",
      "stained",
      "staining",
      "stainless",
      "stalemate",
      "staleness",
      "stalling",
      "stallion",
      "stamina",
      "stammer",
      "stamp",
      "stand",
      "stank",
      "staple",
      "stapling",
      "starboard",
      "starch",
      "stardom",
      "stardust",
      "starfish",
      "stargazer",
      "staring",
      "stark",
      "starless",
      "starlet",
      "starlight",
      "starlit",
      "starring",
      "starry",
      "starship",
      "starter",
      "starting",
      "startle",
      "startling",
      "startup",
      "starved",
      "starving",
      "stash",
      "state",
      "static",
      "statistic",
      "statue",
      "stature",
      "status",
      "statute",
      "statutory",
      "staunch",
      "stays",
      "steadfast",
      "steadier",
      "steadily",
      "steadying",
      "steam",
      "steed",
      "steep",
      "steerable",
      "steering",
      "steersman",
      "stegosaur",
      "stellar",
      "stem",
      "stench",
      "stencil",
      "step",
      "stereo",
      "sterile",
      "sterility",
      "sterilize",
      "sterling",
      "sternness",
      "sternum",
      "stew",
      "stick",
      "stiffen",
      "stiffly",
      "stiffness",
      "stifle",
      "stifling",
      "stillness",
      "stilt",
      "stimulant",
      "stimulate",
      "stimuli",
      "stimulus",
      "stinger",
      "stingily",
      "stinging",
      "stingray",
      "stingy",
      "stinking",
      "stinky",
      "stipend",
      "stipulate",
      "stir",
      "stitch",
      "stock",
      "stoic",
      "stoke",
      "stole",
      "stomp",
      "stonewall",
      "stoneware",
      "stonework",
      "stoning",
      "stony",
      "stood",
      "stooge",
      "stool",
      "stoop",
      "stoplight",
      "stoppable",
      "stoppage",
      "stopped",
      "stopper",
      "stopping",
      "stopwatch",
      "storable",
      "storage",
      "storeroom",
      "storewide",
      "storm",
      "stout",
      "stove",
      "stowaway",
      "stowing",
      "straddle",
      "straggler",
      "strained",
      "strainer",
      "straining",
      "strangely",
      "stranger",
      "strangle",
      "strategic",
      "strategy",
      "stratus",
      "straw",
      "stray",
      "streak",
      "stream",
      "street",
      "strength",
      "strenuous",
      "strep",
      "stress",
      "stretch",
      "strewn",
      "stricken",
      "strict",
      "stride",
      "strife",
      "strike",
      "striking",
      "strive",
      "striving",
      "strobe",
      "strode",
      "stroller",
      "strongbox",
      "strongly",
      "strongman",
      "struck",
      "structure",
      "strudel",
      "struggle",
      "strum",
      "strung",
      "strut",
      "stubbed",
      "stubble",
      "stubbly",
      "stubborn",
      "stucco",
      "stuck",
      "student",
      "studied",
      "studio",
      "study",
      "stuffed",
      "stuffing",
      "stuffy",
      "stumble",
      "stumbling",
      "stump",
      "stung",
      "stunned",
      "stunner",
      "stunning",
      "stunt",
      "stupor",
      "sturdily",
      "sturdy",
      "styling",
      "stylishly",
      "stylist",
      "stylized",
      "stylus",
      "suave",
      "subarctic",
      "subatomic",
      "subdivide",
      "subdued",
      "subduing",
      "subfloor",
      "subgroup",
      "subheader",
      "subject",
      "sublease",
      "sublet",
      "sublevel",
      "sublime",
      "submarine",
      "submerge",
      "submersed",
      "submitter",
      "subpanel",
      "subpar",
      "subplot",
      "subprime",
      "subscribe",
      "subscript",
      "subsector",
      "subside",
      "subsiding",
      "subsidize",
      "subsidy",
      "subsoil",
      "subsonic",
      "substance",
      "subsystem",
      "subtext",
      "subtitle",
      "subtly",
      "subtotal",
      "subtract",
      "subtype",
      "suburb",
      "subway",
      "subwoofer",
      "subzero",
      "succulent",
      "such",
      "suction",
      "sudden",
      "sudoku",
      "suds",
      "sufferer",
      "suffering",
      "suffice",
      "suffix",
      "suffocate",
      "suffrage",
      "sugar",
      "suggest",
      "suing",
      "suitable",
      "suitably",
      "suitcase",
      "suitor",
      "sulfate",
      "sulfide",
      "sulfite",
      "sulfur",
      "sulk",
      "sullen",
      "sulphate",
      "sulphuric",
      "sultry",
      "superbowl",
      "superglue",
      "superhero",
      "superior",
      "superjet",
      "superman",
      "supermom",
      "supernova",
      "supervise",
      "supper",
      "supplier",
      "supply",
      "support",
      "supremacy",
      "supreme",
      "surcharge",
      "surely",
      "sureness",
      "surface",
      "surfacing",
      "surfboard",
      "surfer",
      "surgery",
      "surgical",
      "surging",
      "surname",
      "surpass",
      "surplus",
      "surprise",
      "surreal",
      "surrender",
      "surrogate",
      "surround",
      "survey",
      "survival",
      "survive",
      "surviving",
      "survivor",
      "sushi",
      "suspect",
      "suspend",
      "suspense",
      "sustained",
      "sustainer",
      "swab",
      "swaddling",
      "swagger",
      "swampland",
      "swan",
      "swapping",
      "swarm",
      "sway",
      "swear",
      "sweat",
      "sweep",
      "swell",
      "swept",
      "swerve",
      "swifter",
      "swiftly",
      "swiftness",
      "swimmable",
      "swimmer",
      "swimming",
      "swimsuit",
      "swimwear",
      "swinger",
      "swinging",
      "swipe",
      "swirl",
      "switch",
      "swivel",
      "swizzle",
      "swooned",
      "swoop",
      "swoosh",
      "swore",
      "sworn",
      "swung",
      "sycamore",
      "sympathy",
      "symphonic",
      "symphony",
      "symptom",
      "synapse",
      "syndrome",
      "synergy",
      "synopses",
      "synopsis",
      "synthesis",
      "synthetic",
      "syrup",
      "system",
      "t-shirt",
      "tabasco",
      "tabby",
      "tableful",
      "tables",
      "tablet",
      "tableware",
      "tabloid",
      "tackiness",
      "tacking",
      "tackle",
      "tackling",
      "tacky",
      "taco",
      "tactful",
      "tactical",
      "tactics",
      "tactile",
      "tactless",
      "tadpole",
      "taekwondo",
      "tag",
      "tainted",
      "take",
      "taking",
      "talcum",
      "talisman",
      "tall",
      "talon",
      "tamale",
      "tameness",
      "tamer",
      "tamper",
      "tank",
      "tanned",
      "tannery",
      "tanning",
      "tantrum",
      "tapeless",
      "tapered",
      "tapering",
      "tapestry",
      "tapioca",
      "tapping",
      "taps",
      "tarantula",
      "target",
      "tarmac",
      "tarnish",
      "tarot",
      "tartar",
      "tartly",
      "tartness",
      "task",
      "tassel",
      "taste",
      "tastiness",
      "tasting",
      "tasty",
      "tattered",
      "tattle",
      "tattling",
      "tattoo",
      "taunt",
      "tavern",
      "thank",
      "that",
      "thaw",
      "theater",
      "theatrics",
      "thee",
      "theft",
      "theme",
      "theology",
      "theorize",
      "thermal",
      "thermos",
      "thesaurus",
      "these",
      "thesis",
      "thespian",
      "thicken",
      "thicket",
      "thickness",
      "thieving",
      "thievish",
      "thigh",
      "thimble",
      "thing",
      "think",
      "thinly",
      "thinner",
      "thinness",
      "thinning",
      "thirstily",
      "thirsting",
      "thirsty",
      "thirteen",
      "thirty",
      "thong",
      "thorn",
      "those",
      "thousand",
      "thrash",
      "thread",
      "threaten",
      "threefold",
      "thrift",
      "thrill",
      "thrive",
      "thriving",
      "throat",
      "throbbing",
      "throng",
      "throttle",
      "throwaway",
      "throwback",
      "thrower",
      "throwing",
      "thud",
      "thumb",
      "thumping",
      "thursday",
      "thus",
      "thwarting",
      "thyself",
      "tiara",
      "tibia",
      "tidal",
      "tidbit",
      "tidiness",
      "tidings",
      "tidy",
      "tiger",
      "tighten",
      "tightly",
      "tightness",
      "tightrope",
      "tightwad",
      "tigress",
      "tile",
      "tiling",
      "till",
      "tilt",
      "timid",
      "timing",
      "timothy",
      "tinderbox",
      "tinfoil",
      "tingle",
      "tingling",
      "tingly",
      "tinker",
      "tinkling",
      "tinsel",
      "tinsmith",
      "tint",
      "tinwork",
      "tiny",
      "tipoff",
      "tipped",
      "tipper",
      "tipping",
      "tiptoeing",
      "tiptop",
      "tiring",
      "tissue",
      "trace",
      "tracing",
      "track",
      "traction",
      "tractor",
      "trade",
      "trading",
      "tradition",
      "traffic",
      "tragedy",
      "trailing",
      "trailside",
      "train",
      "traitor",
      "trance",
      "tranquil",
      "transfer",
      "transform",
      "translate",
      "transpire",
      "transport",
      "transpose",
      "trapdoor",
      "trapeze",
      "trapezoid",
      "trapped",
      "trapper",
      "trapping",
      "traps",
      "trash",
      "travel",
      "traverse",
      "travesty",
      "tray",
      "treachery",
      "treading",
      "treadmill",
      "treason",
      "treat",
      "treble",
      "tree",
      "trekker",
      "tremble",
      "trembling",
      "tremor",
      "trench",
      "trend",
      "trespass",
      "triage",
      "trial",
      "triangle",
      "tribesman",
      "tribunal",
      "tribune",
      "tributary",
      "tribute",
      "triceps",
      "trickery",
      "trickily",
      "tricking",
      "trickle",
      "trickster",
      "tricky",
      "tricolor",
      "tricycle",
      "trident",
      "tried",
      "trifle",
      "trifocals",
      "trillion",
      "trilogy",
      "trimester",
      "trimmer",
      "trimming",
      "trimness",
      "trinity",
      "trio",
      "tripod",
      "tripping",
      "triumph",
      "trivial",
      "trodden",
      "trolling",
      "trombone",
      "trophy",
      "tropical",
      "tropics",
      "trouble",
      "troubling",
      "trough",
      "trousers",
      "trout",
      "trowel",
      "truce",
      "truck",
      "truffle",
      "trump",
      "trunks",
      "trustable",
      "trustee",
      "trustful",
      "trusting",
      "trustless",
      "truth",
      "try",
      "tubby",
      "tubeless",
      "tubular",
      "tucking",
      "tuesday",
      "tug",
      "tuition",
      "tulip",
      "tumble",
      "tumbling",
      "tummy",
      "turban",
      "turbine",
      "turbofan",
      "turbojet",
      "turbulent",
      "turf",
      "turkey",
      "turmoil",
      "turret",
      "turtle",
      "tusk",
      "tutor",
      "tutu",
      "tux",
      "tweak",
      "tweed",
      "tweet",
      "tweezers",
      "twelve",
      "twentieth",
      "twenty",
      "twerp",
      "twice",
      "twiddle",
      "twiddling",
      "twig",
      "twilight",
      "twine",
      "twins",
      "twirl",
      "twistable",
      "twisted",
      "twister",
      "twisting",
      "twisty",
      "twitch",
      "twitter",
      "tycoon",
      "tying",
      "tyke",
      "udder",
      "ultimate",
      "ultimatum",
      "ultra",
      "umbilical",
      "umbrella",
      "umpire",
      "unabashed",
      "unable",
      "unadorned",
      "unadvised",
      "unafraid",
      "unaired",
      "unaligned",
      "unaltered",
      "unarmored",
      "unashamed",
      "unaudited",
      "unawake",
      "unaware",
      "unbaked",
      "unbalance",
      "unbeaten",
      "unbend",
      "unbent",
      "unbiased",
      "unbitten",
      "unblended",
      "unblessed",
      "unblock",
      "unbolted",
      "unbounded",
      "unboxed",
      "unbraided",
      "unbridle",
      "unbroken",
      "unbuckled",
      "unbundle",
      "unburned",
      "unbutton",
      "uncanny",
      "uncapped",
      "uncaring",
      "uncertain",
      "unchain",
      "unchanged",
      "uncharted",
      "uncheck",
      "uncivil",
      "unclad",
      "unclaimed",
      "unclamped",
      "unclasp",
      "uncle",
      "unclip",
      "uncloak",
      "unclog",
      "unclothed",
      "uncoated",
      "uncoiled",
      "uncolored",
      "uncombed",
      "uncommon",
      "uncooked",
      "uncork",
      "uncorrupt",
      "uncounted",
      "uncouple",
      "uncouth",
      "uncover",
      "uncross",
      "uncrown",
      "uncrushed",
      "uncured",
      "uncurious",
      "uncurled",
      "uncut",
      "undamaged",
      "undated",
      "undaunted",
      "undead",
      "undecided",
      "undefined",
      "underage",
      "underarm",
      "undercoat",
      "undercook",
      "undercut",
      "underdog",
      "underdone",
      "underfed",
      "underfeed",
      "underfoot",
      "undergo",
      "undergrad",
      "underhand",
      "underline",
      "underling",
      "undermine",
      "undermost",
      "underpaid",
      "underpass",
      "underpay",
      "underrate",
      "undertake",
      "undertone",
      "undertook",
      "undertow",
      "underuse",
      "underwear",
      "underwent",
      "underwire",
      "undesired",
      "undiluted",
      "undivided",
      "undocked",
      "undoing",
      "undone",
      "undrafted",
      "undress",
      "undrilled",
      "undusted",
      "undying",
      "unearned",
      "unearth",
      "unease",
      "uneasily",
      "uneasy",
      "uneatable",
      "uneaten",
      "unedited",
      "unelected",
      "unending",
      "unengaged",
      "unenvied",
      "unequal",
      "unethical",
      "uneven",
      "unexpired",
      "unexposed",
      "unfailing",
      "unfair",
      "unfasten",
      "unfazed",
      "unfeeling",
      "unfiled",
      "unfilled",
      "unfitted",
      "unfitting",
      "unfixable",
      "unfixed",
      "unflawed",
      "unfocused",
      "unfold",
      "unfounded",
      "unframed",
      "unfreeze",
      "unfrosted",
      "unfrozen",
      "unfunded",
      "unglazed",
      "ungloved",
      "unglue",
      "ungodly",
      "ungraded",
      "ungreased",
      "unguarded",
      "unguided",
      "unhappily",
      "unhappy",
      "unharmed",
      "unhealthy",
      "unheard",
      "unhearing",
      "unheated",
      "unhelpful",
      "unhidden",
      "unhinge",
      "unhitched",
      "unholy",
      "unhook",
      "unicorn",
      "unicycle",
      "unified",
      "unifier",
      "uniformed",
      "uniformly",
      "unify",
      "unimpeded",
      "uninjured",
      "uninstall",
      "uninsured",
      "uninvited",
      "union",
      "uniquely",
      "unisexual",
      "unison",
      "unissued",
      "unit",
      "universal",
      "universe",
      "unjustly",
      "unkempt",
      "unkind",
      "unknotted",
      "unknowing",
      "unknown",
      "unlaced",
      "unlatch",
      "unlawful",
      "unleaded",
      "unlearned",
      "unleash",
      "unless",
      "unleveled",
      "unlighted",
      "unlikable",
      "unlimited",
      "unlined",
      "unlinked",
      "unlisted",
      "unlit",
      "unlivable",
      "unloaded",
      "unloader",
      "unlocked",
      "unlocking",
      "unlovable",
      "unloved",
      "unlovely",
      "unloving",
      "unluckily",
      "unlucky",
      "unmade",
      "unmanaged",
      "unmanned",
      "unmapped",
      "unmarked",
      "unmasked",
      "unmasking",
      "unmatched",
      "unmindful",
      "unmixable",
      "unmixed",
      "unmolded",
      "unmoral",
      "unmovable",
      "unmoved",
      "unmoving",
      "unnamable",
      "unnamed",
      "unnatural",
      "unneeded",
      "unnerve",
      "unnerving",
      "unnoticed",
      "unopened",
      "unopposed",
      "unpack",
      "unpadded",
      "unpaid",
      "unpainted",
      "unpaired",
      "unpaved",
      "unpeeled",
      "unpicked",
      "unpiloted",
      "unpinned",
      "unplanned",
      "unplanted",
      "unpleased",
      "unpledged",
      "unplowed",
      "unplug",
      "unpopular",
      "unproven",
      "unquote",
      "unranked",
      "unrated",
      "unraveled",
      "unreached",
      "unread",
      "unreal",
      "unreeling",
      "unrefined",
      "unrelated",
      "unrented",
      "unrest",
      "unretired",
      "unrevised",
      "unrigged",
      "unripe",
      "unrivaled",
      "unroasted",
      "unrobed",
      "unroll",
      "unruffled",
      "unruly",
      "unrushed",
      "unsaddle",
      "unsafe",
      "unsaid",
      "unsalted",
      "unsaved",
      "unsavory",
      "unscathed",
      "unscented",
      "unscrew",
      "unsealed",
      "unseated",
      "unsecured",
      "unseeing",
      "unseemly",
      "unseen",
      "unselect",
      "unselfish",
      "unsent",
      "unsettled",
      "unshackle",
      "unshaken",
      "unshaved",
      "unshaven",
      "unsheathe",
      "unshipped",
      "unsightly",
      "unsigned",
      "unskilled",
      "unsliced",
      "unsmooth",
      "unsnap",
      "unsocial",
      "unsoiled",
      "unsold",
      "unsolved",
      "unsorted",
      "unspoiled",
      "unspoken",
      "unstable",
      "unstaffed",
      "unstamped",
      "unsteady",
      "unsterile",
      "unstirred",
      "unstitch",
      "unstopped",
      "unstuck",
      "unstuffed",
      "unstylish",
      "unsubtle",
      "unsubtly",
      "unsuited",
      "unsure",
      "unsworn",
      "untagged",
      "untainted",
      "untaken",
      "untamed",
      "untangled",
      "untapped",
      "untaxed",
      "unthawed",
      "unthread",
      "untidy",
      "untie",
      "until",
      "untimed",
      "untimely",
      "untitled",
      "untoasted",
      "untold",
      "untouched",
      "untracked",
      "untrained",
      "untreated",
      "untried",
      "untrimmed",
      "untrue",
      "untruth",
      "unturned",
      "untwist",
      "untying",
      "unusable",
      "unused",
      "unusual",
      "unvalued",
      "unvaried",
      "unvarying",
      "unveiled",
      "unveiling",
      "unvented",
      "unviable",
      "unvisited",
      "unvocal",
      "unwanted",
      "unwarlike",
      "unwary",
      "unwashed",
      "unwatched",
      "unweave",
      "unwed",
      "unwelcome",
      "unwell",
      "unwieldy",
      "unwilling",
      "unwind",
      "unwired",
      "unwitting",
      "unwomanly",
      "unworldly",
      "unworn",
      "unworried",
      "unworthy",
      "unwound",
      "unwoven",
      "unwrapped",
      "unwritten",
      "unzip",
      "upbeat",
      "upchuck",
      "upcoming",
      "upcountry",
      "update",
      "upfront",
      "upgrade",
      "upheaval",
      "upheld",
      "uphill",
      "uphold",
      "uplifted",
      "uplifting",
      "upload",
      "upon",
      "upper",
      "upright",
      "uprising",
      "upriver",
      "uproar",
      "uproot",
      "upscale",
      "upside",
      "upstage",
      "upstairs",
      "upstart",
      "upstate",
      "upstream",
      "upstroke",
      "upswing",
      "uptake",
      "uptight",
      "uptown",
      "upturned",
      "upward",
      "upwind",
      "uranium",
      "urban",
      "urchin",
      "urethane",
      "urgency",
      "urgent",
      "urging",
      "urologist",
      "urology",
      "usable",
      "usage",
      "useable",
      "used",
      "uselessly",
      "user",
      "usher",
      "usual",
      "utensil",
      "utility",
      "utilize",
      "utmost",
      "utopia",
      "utter",
      "vacancy",
      "vacant",
      "vacate",
      "vacation",
      "vagabond",
      "vagrancy",
      "vagrantly",
      "vaguely",
      "vagueness",
      "valiant",
      "valid",
      "valium",
      "valley",
      "valuables",
      "value",
      "vanilla",
      "vanish",
      "vanity",
      "vanquish",
      "vantage",
      "vaporizer",
      "variable",
      "variably",
      "varied",
      "variety",
      "various",
      "varmint",
      "varnish",
      "varsity",
      "varying",
      "vascular",
      "vaseline",
      "vastly",
      "vastness",
      "veal",
      "vegan",
      "veggie",
      "vehicular",
      "velcro",
      "velocity",
      "velvet",
      "vendetta",
      "vending",
      "vendor",
      "veneering",
      "vengeful",
      "venomous",
      "ventricle",
      "venture",
      "venue",
      "venus",
      "verbalize",
      "verbally",
      "verbose",
      "verdict",
      "verify",
      "verse",
      "version",
      "versus",
      "vertebrae",
      "vertical",
      "vertigo",
      "very",
      "vessel",
      "vest",
      "veteran",
      "veto",
      "vexingly",
      "viability",
      "viable",
      "vibes",
      "vice",
      "vicinity",
      "victory",
      "video",
      "viewable",
      "viewer",
      "viewing",
      "viewless",
      "viewpoint",
      "vigorous",
      "village",
      "villain",
      "vindicate",
      "vineyard",
      "vintage",
      "violate",
      "violation",
      "violator",
      "violet",
      "violin",
      "viper",
      "viral",
      "virtual",
      "virtuous",
      "virus",
      "visa",
      "viscosity",
      "viscous",
      "viselike",
      "visible",
      "visibly",
      "vision",
      "visiting",
      "visitor",
      "visor",
      "vista",
      "vitality",
      "vitalize",
      "vitally",
      "vitamins",
      "vivacious",
      "vividly",
      "vividness",
      "vixen",
      "vocalist",
      "vocalize",
      "vocally",
      "vocation",
      "voice",
      "voicing",
      "void",
      "volatile",
      "volley",
      "voltage",
      "volumes",
      "voter",
      "voting",
      "voucher",
      "vowed",
      "vowel",
      "voyage",
      "wackiness",
      "wad",
      "wafer",
      "waffle",
      "waged",
      "wager",
      "wages",
      "waggle",
      "wagon",
      "wake",
      "waking",
      "walk",
      "walmart",
      "walnut",
      "walrus",
      "waltz",
      "wand",
      "wannabe",
      "wanted",
      "wanting",
      "wasabi",
      "washable",
      "washbasin",
      "washboard",
      "washbowl",
      "washcloth",
      "washday",
      "washed",
      "washer",
      "washhouse",
      "washing",
      "washout",
      "washroom",
      "washstand",
      "washtub",
      "wasp",
      "wasting",
      "watch",
      "water",
      "waviness",
      "waving",
      "wavy",
      "whacking",
      "whacky",
      "wham",
      "wharf",
      "wheat",
      "whenever",
      "whiff",
      "whimsical",
      "whinny",
      "whiny",
      "whisking",
      "whoever",
      "whole",
      "whomever",
      "whoopee",
      "whooping",
      "whoops",
      "why",
      "wick",
      "widely",
      "widen",
      "widget",
      "widow",
      "width",
      "wieldable",
      "wielder",
      "wife",
      "wifi",
      "wikipedia",
      "wildcard",
      "wildcat",
      "wilder",
      "wildfire",
      "wildfowl",
      "wildland",
      "wildlife",
      "wildly",
      "wildness",
      "willed",
      "willfully",
      "willing",
      "willow",
      "willpower",
      "wilt",
      "wimp",
      "wince",
      "wincing",
      "wind",
      "wing",
      "winking",
      "winner",
      "winnings",
      "winter",
      "wipe",
      "wired",
      "wireless",
      "wiring",
      "wiry",
      "wisdom",
      "wise",
      "wish",
      "wisplike",
      "wispy",
      "wistful",
      "wizard",
      "wobble",
      "wobbling",
      "wobbly",
      "wok",
      "wolf",
      "wolverine",
      "womanhood",
      "womankind",
      "womanless",
      "womanlike",
      "womanly",
      "womb",
      "woof",
      "wooing",
      "wool",
      "woozy",
      "word",
      "work",
      "worried",
      "worrier",
      "worrisome",
      "worry",
      "worsening",
      "worshiper",
      "worst",
      "wound",
      "woven",
      "wow",
      "wrangle",
      "wrath",
      "wreath",
      "wreckage",
      "wrecker",
      "wrecking",
      "wrench",
      "wriggle",
      "wriggly",
      "wrinkle",
      "wrinkly",
      "wrist",
      "writing",
      "written",
      "wrongdoer",
      "wronged",
      "wrongful",
      "wrongly",
      "wrongness",
      "wrought",
      "xbox",
      "xerox",
      "yahoo",
      "yam",
      "yanking",
      "yapping",
      "yard",
      "yarn",
      "yeah",
      "yearbook",
      "yearling",
      "yearly",
      "yearning",
      "yeast",
      "yelling",
      "yelp",
      "yen",
      "yesterday",
      "yiddish",
      "yield",
      "yin",
      "yippee",
      "yo-yo",
      "yodel",
      "yoga",
      "yogurt",
      "yonder",
      "yoyo",
      "yummy",
      "zap",
      "zealous",
      "zebra",
      "zen",
      "zeppelin",
      "zero",
      "zestfully",
      "zesty",
      "zigzagged",
      "zipfile",
      "zipping",
      "zippy",
      "zips",
      "zit",
      "zodiac",
      "zombie",
      "zone",
      "zoning",
      "zookeeper",
      "zoologist",
      "zoology",
      "zoom"
    ];
  }
});

// node_modules/@ton/crypto/dist/passwords/newSecureWords.js
var require_newSecureWords = __commonJS({
  "node_modules/@ton/crypto/dist/passwords/newSecureWords.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.newSecureWords = void 0;
    var getSecureRandom_1 = require_getSecureRandom2();
    var wordlist_1 = require_wordlist();
    async function newSecureWords(size = 6) {
      let words = [];
      for (let i = 0; i < size; i++) {
        words.push(wordlist_1.wordlist[await (0, getSecureRandom_1.getSecureRandomNumber)(0, wordlist_1.wordlist.length)]);
      }
      return words;
    }
    exports.newSecureWords = newSecureWords;
  }
});

// node_modules/@ton/crypto/dist/passwords/newSecurePassphrase.js
var require_newSecurePassphrase = __commonJS({
  "node_modules/@ton/crypto/dist/passwords/newSecurePassphrase.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.newSecurePassphrase = void 0;
    var __1 = require_dist();
    async function newSecurePassphrase(size = 6) {
      return (await (0, __1.newSecureWords)(size)).join("-");
    }
    exports.newSecurePassphrase = newSecurePassphrase;
  }
});

// (disabled):crypto
var require_crypto = __commonJS({
  "(disabled):crypto"() {
  }
});

// node_modules/tweetnacl/nacl-fast.js
var require_nacl_fast = __commonJS({
  "node_modules/tweetnacl/nacl-fast.js"(exports, module) {
    (function(nacl) {
      "use strict";
      var gf = function(init) {
        var i, r = new Float64Array(16);
        if (init) for (i = 0; i < init.length; i++) r[i] = init[i];
        return r;
      };
      var randombytes = function() {
        throw new Error("no PRNG");
      };
      var _0 = new Uint8Array(16);
      var _9 = new Uint8Array(32);
      _9[0] = 9;
      var gf0 = gf(), gf1 = gf([1]), _121665 = gf([56129, 1]), D = gf([30883, 4953, 19914, 30187, 55467, 16705, 2637, 112, 59544, 30585, 16505, 36039, 65139, 11119, 27886, 20995]), D2 = gf([61785, 9906, 39828, 60374, 45398, 33411, 5274, 224, 53552, 61171, 33010, 6542, 64743, 22239, 55772, 9222]), X = gf([54554, 36645, 11616, 51542, 42930, 38181, 51040, 26924, 56412, 64982, 57905, 49316, 21502, 52590, 14035, 8553]), Y = gf([26200, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214]), I = gf([41136, 18958, 6951, 50414, 58488, 44335, 6150, 12099, 55207, 15867, 153, 11085, 57099, 20417, 9344, 11139]);
      function ts64(x, i, h, l) {
        x[i] = h >> 24 & 255;
        x[i + 1] = h >> 16 & 255;
        x[i + 2] = h >> 8 & 255;
        x[i + 3] = h & 255;
        x[i + 4] = l >> 24 & 255;
        x[i + 5] = l >> 16 & 255;
        x[i + 6] = l >> 8 & 255;
        x[i + 7] = l & 255;
      }
      function vn(x, xi, y, yi, n) {
        var i, d = 0;
        for (i = 0; i < n; i++) d |= x[xi + i] ^ y[yi + i];
        return (1 & d - 1 >>> 8) - 1;
      }
      function crypto_verify_16(x, xi, y, yi) {
        return vn(x, xi, y, yi, 16);
      }
      function crypto_verify_32(x, xi, y, yi) {
        return vn(x, xi, y, yi, 32);
      }
      function core_salsa20(o, p, k, c) {
        var j0 = c[0] & 255 | (c[1] & 255) << 8 | (c[2] & 255) << 16 | (c[3] & 255) << 24, j1 = k[0] & 255 | (k[1] & 255) << 8 | (k[2] & 255) << 16 | (k[3] & 255) << 24, j2 = k[4] & 255 | (k[5] & 255) << 8 | (k[6] & 255) << 16 | (k[7] & 255) << 24, j3 = k[8] & 255 | (k[9] & 255) << 8 | (k[10] & 255) << 16 | (k[11] & 255) << 24, j4 = k[12] & 255 | (k[13] & 255) << 8 | (k[14] & 255) << 16 | (k[15] & 255) << 24, j5 = c[4] & 255 | (c[5] & 255) << 8 | (c[6] & 255) << 16 | (c[7] & 255) << 24, j6 = p[0] & 255 | (p[1] & 255) << 8 | (p[2] & 255) << 16 | (p[3] & 255) << 24, j7 = p[4] & 255 | (p[5] & 255) << 8 | (p[6] & 255) << 16 | (p[7] & 255) << 24, j8 = p[8] & 255 | (p[9] & 255) << 8 | (p[10] & 255) << 16 | (p[11] & 255) << 24, j9 = p[12] & 255 | (p[13] & 255) << 8 | (p[14] & 255) << 16 | (p[15] & 255) << 24, j10 = c[8] & 255 | (c[9] & 255) << 8 | (c[10] & 255) << 16 | (c[11] & 255) << 24, j11 = k[16] & 255 | (k[17] & 255) << 8 | (k[18] & 255) << 16 | (k[19] & 255) << 24, j12 = k[20] & 255 | (k[21] & 255) << 8 | (k[22] & 255) << 16 | (k[23] & 255) << 24, j13 = k[24] & 255 | (k[25] & 255) << 8 | (k[26] & 255) << 16 | (k[27] & 255) << 24, j14 = k[28] & 255 | (k[29] & 255) << 8 | (k[30] & 255) << 16 | (k[31] & 255) << 24, j15 = c[12] & 255 | (c[13] & 255) << 8 | (c[14] & 255) << 16 | (c[15] & 255) << 24;
        var x0 = j0, x1 = j1, x2 = j2, x3 = j3, x4 = j4, x5 = j5, x6 = j6, x7 = j7, x8 = j8, x9 = j9, x10 = j10, x11 = j11, x12 = j12, x13 = j13, x14 = j14, x15 = j15, u;
        for (var i = 0; i < 20; i += 2) {
          u = x0 + x12 | 0;
          x4 ^= u << 7 | u >>> 32 - 7;
          u = x4 + x0 | 0;
          x8 ^= u << 9 | u >>> 32 - 9;
          u = x8 + x4 | 0;
          x12 ^= u << 13 | u >>> 32 - 13;
          u = x12 + x8 | 0;
          x0 ^= u << 18 | u >>> 32 - 18;
          u = x5 + x1 | 0;
          x9 ^= u << 7 | u >>> 32 - 7;
          u = x9 + x5 | 0;
          x13 ^= u << 9 | u >>> 32 - 9;
          u = x13 + x9 | 0;
          x1 ^= u << 13 | u >>> 32 - 13;
          u = x1 + x13 | 0;
          x5 ^= u << 18 | u >>> 32 - 18;
          u = x10 + x6 | 0;
          x14 ^= u << 7 | u >>> 32 - 7;
          u = x14 + x10 | 0;
          x2 ^= u << 9 | u >>> 32 - 9;
          u = x2 + x14 | 0;
          x6 ^= u << 13 | u >>> 32 - 13;
          u = x6 + x2 | 0;
          x10 ^= u << 18 | u >>> 32 - 18;
          u = x15 + x11 | 0;
          x3 ^= u << 7 | u >>> 32 - 7;
          u = x3 + x15 | 0;
          x7 ^= u << 9 | u >>> 32 - 9;
          u = x7 + x3 | 0;
          x11 ^= u << 13 | u >>> 32 - 13;
          u = x11 + x7 | 0;
          x15 ^= u << 18 | u >>> 32 - 18;
          u = x0 + x3 | 0;
          x1 ^= u << 7 | u >>> 32 - 7;
          u = x1 + x0 | 0;
          x2 ^= u << 9 | u >>> 32 - 9;
          u = x2 + x1 | 0;
          x3 ^= u << 13 | u >>> 32 - 13;
          u = x3 + x2 | 0;
          x0 ^= u << 18 | u >>> 32 - 18;
          u = x5 + x4 | 0;
          x6 ^= u << 7 | u >>> 32 - 7;
          u = x6 + x5 | 0;
          x7 ^= u << 9 | u >>> 32 - 9;
          u = x7 + x6 | 0;
          x4 ^= u << 13 | u >>> 32 - 13;
          u = x4 + x7 | 0;
          x5 ^= u << 18 | u >>> 32 - 18;
          u = x10 + x9 | 0;
          x11 ^= u << 7 | u >>> 32 - 7;
          u = x11 + x10 | 0;
          x8 ^= u << 9 | u >>> 32 - 9;
          u = x8 + x11 | 0;
          x9 ^= u << 13 | u >>> 32 - 13;
          u = x9 + x8 | 0;
          x10 ^= u << 18 | u >>> 32 - 18;
          u = x15 + x14 | 0;
          x12 ^= u << 7 | u >>> 32 - 7;
          u = x12 + x15 | 0;
          x13 ^= u << 9 | u >>> 32 - 9;
          u = x13 + x12 | 0;
          x14 ^= u << 13 | u >>> 32 - 13;
          u = x14 + x13 | 0;
          x15 ^= u << 18 | u >>> 32 - 18;
        }
        x0 = x0 + j0 | 0;
        x1 = x1 + j1 | 0;
        x2 = x2 + j2 | 0;
        x3 = x3 + j3 | 0;
        x4 = x4 + j4 | 0;
        x5 = x5 + j5 | 0;
        x6 = x6 + j6 | 0;
        x7 = x7 + j7 | 0;
        x8 = x8 + j8 | 0;
        x9 = x9 + j9 | 0;
        x10 = x10 + j10 | 0;
        x11 = x11 + j11 | 0;
        x12 = x12 + j12 | 0;
        x13 = x13 + j13 | 0;
        x14 = x14 + j14 | 0;
        x15 = x15 + j15 | 0;
        o[0] = x0 >>> 0 & 255;
        o[1] = x0 >>> 8 & 255;
        o[2] = x0 >>> 16 & 255;
        o[3] = x0 >>> 24 & 255;
        o[4] = x1 >>> 0 & 255;
        o[5] = x1 >>> 8 & 255;
        o[6] = x1 >>> 16 & 255;
        o[7] = x1 >>> 24 & 255;
        o[8] = x2 >>> 0 & 255;
        o[9] = x2 >>> 8 & 255;
        o[10] = x2 >>> 16 & 255;
        o[11] = x2 >>> 24 & 255;
        o[12] = x3 >>> 0 & 255;
        o[13] = x3 >>> 8 & 255;
        o[14] = x3 >>> 16 & 255;
        o[15] = x3 >>> 24 & 255;
        o[16] = x4 >>> 0 & 255;
        o[17] = x4 >>> 8 & 255;
        o[18] = x4 >>> 16 & 255;
        o[19] = x4 >>> 24 & 255;
        o[20] = x5 >>> 0 & 255;
        o[21] = x5 >>> 8 & 255;
        o[22] = x5 >>> 16 & 255;
        o[23] = x5 >>> 24 & 255;
        o[24] = x6 >>> 0 & 255;
        o[25] = x6 >>> 8 & 255;
        o[26] = x6 >>> 16 & 255;
        o[27] = x6 >>> 24 & 255;
        o[28] = x7 >>> 0 & 255;
        o[29] = x7 >>> 8 & 255;
        o[30] = x7 >>> 16 & 255;
        o[31] = x7 >>> 24 & 255;
        o[32] = x8 >>> 0 & 255;
        o[33] = x8 >>> 8 & 255;
        o[34] = x8 >>> 16 & 255;
        o[35] = x8 >>> 24 & 255;
        o[36] = x9 >>> 0 & 255;
        o[37] = x9 >>> 8 & 255;
        o[38] = x9 >>> 16 & 255;
        o[39] = x9 >>> 24 & 255;
        o[40] = x10 >>> 0 & 255;
        o[41] = x10 >>> 8 & 255;
        o[42] = x10 >>> 16 & 255;
        o[43] = x10 >>> 24 & 255;
        o[44] = x11 >>> 0 & 255;
        o[45] = x11 >>> 8 & 255;
        o[46] = x11 >>> 16 & 255;
        o[47] = x11 >>> 24 & 255;
        o[48] = x12 >>> 0 & 255;
        o[49] = x12 >>> 8 & 255;
        o[50] = x12 >>> 16 & 255;
        o[51] = x12 >>> 24 & 255;
        o[52] = x13 >>> 0 & 255;
        o[53] = x13 >>> 8 & 255;
        o[54] = x13 >>> 16 & 255;
        o[55] = x13 >>> 24 & 255;
        o[56] = x14 >>> 0 & 255;
        o[57] = x14 >>> 8 & 255;
        o[58] = x14 >>> 16 & 255;
        o[59] = x14 >>> 24 & 255;
        o[60] = x15 >>> 0 & 255;
        o[61] = x15 >>> 8 & 255;
        o[62] = x15 >>> 16 & 255;
        o[63] = x15 >>> 24 & 255;
      }
      function core_hsalsa20(o, p, k, c) {
        var j0 = c[0] & 255 | (c[1] & 255) << 8 | (c[2] & 255) << 16 | (c[3] & 255) << 24, j1 = k[0] & 255 | (k[1] & 255) << 8 | (k[2] & 255) << 16 | (k[3] & 255) << 24, j2 = k[4] & 255 | (k[5] & 255) << 8 | (k[6] & 255) << 16 | (k[7] & 255) << 24, j3 = k[8] & 255 | (k[9] & 255) << 8 | (k[10] & 255) << 16 | (k[11] & 255) << 24, j4 = k[12] & 255 | (k[13] & 255) << 8 | (k[14] & 255) << 16 | (k[15] & 255) << 24, j5 = c[4] & 255 | (c[5] & 255) << 8 | (c[6] & 255) << 16 | (c[7] & 255) << 24, j6 = p[0] & 255 | (p[1] & 255) << 8 | (p[2] & 255) << 16 | (p[3] & 255) << 24, j7 = p[4] & 255 | (p[5] & 255) << 8 | (p[6] & 255) << 16 | (p[7] & 255) << 24, j8 = p[8] & 255 | (p[9] & 255) << 8 | (p[10] & 255) << 16 | (p[11] & 255) << 24, j9 = p[12] & 255 | (p[13] & 255) << 8 | (p[14] & 255) << 16 | (p[15] & 255) << 24, j10 = c[8] & 255 | (c[9] & 255) << 8 | (c[10] & 255) << 16 | (c[11] & 255) << 24, j11 = k[16] & 255 | (k[17] & 255) << 8 | (k[18] & 255) << 16 | (k[19] & 255) << 24, j12 = k[20] & 255 | (k[21] & 255) << 8 | (k[22] & 255) << 16 | (k[23] & 255) << 24, j13 = k[24] & 255 | (k[25] & 255) << 8 | (k[26] & 255) << 16 | (k[27] & 255) << 24, j14 = k[28] & 255 | (k[29] & 255) << 8 | (k[30] & 255) << 16 | (k[31] & 255) << 24, j15 = c[12] & 255 | (c[13] & 255) << 8 | (c[14] & 255) << 16 | (c[15] & 255) << 24;
        var x0 = j0, x1 = j1, x2 = j2, x3 = j3, x4 = j4, x5 = j5, x6 = j6, x7 = j7, x8 = j8, x9 = j9, x10 = j10, x11 = j11, x12 = j12, x13 = j13, x14 = j14, x15 = j15, u;
        for (var i = 0; i < 20; i += 2) {
          u = x0 + x12 | 0;
          x4 ^= u << 7 | u >>> 32 - 7;
          u = x4 + x0 | 0;
          x8 ^= u << 9 | u >>> 32 - 9;
          u = x8 + x4 | 0;
          x12 ^= u << 13 | u >>> 32 - 13;
          u = x12 + x8 | 0;
          x0 ^= u << 18 | u >>> 32 - 18;
          u = x5 + x1 | 0;
          x9 ^= u << 7 | u >>> 32 - 7;
          u = x9 + x5 | 0;
          x13 ^= u << 9 | u >>> 32 - 9;
          u = x13 + x9 | 0;
          x1 ^= u << 13 | u >>> 32 - 13;
          u = x1 + x13 | 0;
          x5 ^= u << 18 | u >>> 32 - 18;
          u = x10 + x6 | 0;
          x14 ^= u << 7 | u >>> 32 - 7;
          u = x14 + x10 | 0;
          x2 ^= u << 9 | u >>> 32 - 9;
          u = x2 + x14 | 0;
          x6 ^= u << 13 | u >>> 32 - 13;
          u = x6 + x2 | 0;
          x10 ^= u << 18 | u >>> 32 - 18;
          u = x15 + x11 | 0;
          x3 ^= u << 7 | u >>> 32 - 7;
          u = x3 + x15 | 0;
          x7 ^= u << 9 | u >>> 32 - 9;
          u = x7 + x3 | 0;
          x11 ^= u << 13 | u >>> 32 - 13;
          u = x11 + x7 | 0;
          x15 ^= u << 18 | u >>> 32 - 18;
          u = x0 + x3 | 0;
          x1 ^= u << 7 | u >>> 32 - 7;
          u = x1 + x0 | 0;
          x2 ^= u << 9 | u >>> 32 - 9;
          u = x2 + x1 | 0;
          x3 ^= u << 13 | u >>> 32 - 13;
          u = x3 + x2 | 0;
          x0 ^= u << 18 | u >>> 32 - 18;
          u = x5 + x4 | 0;
          x6 ^= u << 7 | u >>> 32 - 7;
          u = x6 + x5 | 0;
          x7 ^= u << 9 | u >>> 32 - 9;
          u = x7 + x6 | 0;
          x4 ^= u << 13 | u >>> 32 - 13;
          u = x4 + x7 | 0;
          x5 ^= u << 18 | u >>> 32 - 18;
          u = x10 + x9 | 0;
          x11 ^= u << 7 | u >>> 32 - 7;
          u = x11 + x10 | 0;
          x8 ^= u << 9 | u >>> 32 - 9;
          u = x8 + x11 | 0;
          x9 ^= u << 13 | u >>> 32 - 13;
          u = x9 + x8 | 0;
          x10 ^= u << 18 | u >>> 32 - 18;
          u = x15 + x14 | 0;
          x12 ^= u << 7 | u >>> 32 - 7;
          u = x12 + x15 | 0;
          x13 ^= u << 9 | u >>> 32 - 9;
          u = x13 + x12 | 0;
          x14 ^= u << 13 | u >>> 32 - 13;
          u = x14 + x13 | 0;
          x15 ^= u << 18 | u >>> 32 - 18;
        }
        o[0] = x0 >>> 0 & 255;
        o[1] = x0 >>> 8 & 255;
        o[2] = x0 >>> 16 & 255;
        o[3] = x0 >>> 24 & 255;
        o[4] = x5 >>> 0 & 255;
        o[5] = x5 >>> 8 & 255;
        o[6] = x5 >>> 16 & 255;
        o[7] = x5 >>> 24 & 255;
        o[8] = x10 >>> 0 & 255;
        o[9] = x10 >>> 8 & 255;
        o[10] = x10 >>> 16 & 255;
        o[11] = x10 >>> 24 & 255;
        o[12] = x15 >>> 0 & 255;
        o[13] = x15 >>> 8 & 255;
        o[14] = x15 >>> 16 & 255;
        o[15] = x15 >>> 24 & 255;
        o[16] = x6 >>> 0 & 255;
        o[17] = x6 >>> 8 & 255;
        o[18] = x6 >>> 16 & 255;
        o[19] = x6 >>> 24 & 255;
        o[20] = x7 >>> 0 & 255;
        o[21] = x7 >>> 8 & 255;
        o[22] = x7 >>> 16 & 255;
        o[23] = x7 >>> 24 & 255;
        o[24] = x8 >>> 0 & 255;
        o[25] = x8 >>> 8 & 255;
        o[26] = x8 >>> 16 & 255;
        o[27] = x8 >>> 24 & 255;
        o[28] = x9 >>> 0 & 255;
        o[29] = x9 >>> 8 & 255;
        o[30] = x9 >>> 16 & 255;
        o[31] = x9 >>> 24 & 255;
      }
      function crypto_core_salsa20(out, inp, k, c) {
        core_salsa20(out, inp, k, c);
      }
      function crypto_core_hsalsa20(out, inp, k, c) {
        core_hsalsa20(out, inp, k, c);
      }
      var sigma = new Uint8Array([101, 120, 112, 97, 110, 100, 32, 51, 50, 45, 98, 121, 116, 101, 32, 107]);
      function crypto_stream_salsa20_xor(c, cpos, m, mpos, b, n, k) {
        var z = new Uint8Array(16), x = new Uint8Array(64);
        var u, i;
        for (i = 0; i < 16; i++) z[i] = 0;
        for (i = 0; i < 8; i++) z[i] = n[i];
        while (b >= 64) {
          crypto_core_salsa20(x, z, k, sigma);
          for (i = 0; i < 64; i++) c[cpos + i] = m[mpos + i] ^ x[i];
          u = 1;
          for (i = 8; i < 16; i++) {
            u = u + (z[i] & 255) | 0;
            z[i] = u & 255;
            u >>>= 8;
          }
          b -= 64;
          cpos += 64;
          mpos += 64;
        }
        if (b > 0) {
          crypto_core_salsa20(x, z, k, sigma);
          for (i = 0; i < b; i++) c[cpos + i] = m[mpos + i] ^ x[i];
        }
        return 0;
      }
      function crypto_stream_salsa20(c, cpos, b, n, k) {
        var z = new Uint8Array(16), x = new Uint8Array(64);
        var u, i;
        for (i = 0; i < 16; i++) z[i] = 0;
        for (i = 0; i < 8; i++) z[i] = n[i];
        while (b >= 64) {
          crypto_core_salsa20(x, z, k, sigma);
          for (i = 0; i < 64; i++) c[cpos + i] = x[i];
          u = 1;
          for (i = 8; i < 16; i++) {
            u = u + (z[i] & 255) | 0;
            z[i] = u & 255;
            u >>>= 8;
          }
          b -= 64;
          cpos += 64;
        }
        if (b > 0) {
          crypto_core_salsa20(x, z, k, sigma);
          for (i = 0; i < b; i++) c[cpos + i] = x[i];
        }
        return 0;
      }
      function crypto_stream(c, cpos, d, n, k) {
        var s = new Uint8Array(32);
        crypto_core_hsalsa20(s, n, k, sigma);
        var sn = new Uint8Array(8);
        for (var i = 0; i < 8; i++) sn[i] = n[i + 16];
        return crypto_stream_salsa20(c, cpos, d, sn, s);
      }
      function crypto_stream_xor(c, cpos, m, mpos, d, n, k) {
        var s = new Uint8Array(32);
        crypto_core_hsalsa20(s, n, k, sigma);
        var sn = new Uint8Array(8);
        for (var i = 0; i < 8; i++) sn[i] = n[i + 16];
        return crypto_stream_salsa20_xor(c, cpos, m, mpos, d, sn, s);
      }
      var poly1305 = function(key) {
        this.buffer = new Uint8Array(16);
        this.r = new Uint16Array(10);
        this.h = new Uint16Array(10);
        this.pad = new Uint16Array(8);
        this.leftover = 0;
        this.fin = 0;
        var t0, t1, t2, t3, t4, t5, t6, t7;
        t0 = key[0] & 255 | (key[1] & 255) << 8;
        this.r[0] = t0 & 8191;
        t1 = key[2] & 255 | (key[3] & 255) << 8;
        this.r[1] = (t0 >>> 13 | t1 << 3) & 8191;
        t2 = key[4] & 255 | (key[5] & 255) << 8;
        this.r[2] = (t1 >>> 10 | t2 << 6) & 7939;
        t3 = key[6] & 255 | (key[7] & 255) << 8;
        this.r[3] = (t2 >>> 7 | t3 << 9) & 8191;
        t4 = key[8] & 255 | (key[9] & 255) << 8;
        this.r[4] = (t3 >>> 4 | t4 << 12) & 255;
        this.r[5] = t4 >>> 1 & 8190;
        t5 = key[10] & 255 | (key[11] & 255) << 8;
        this.r[6] = (t4 >>> 14 | t5 << 2) & 8191;
        t6 = key[12] & 255 | (key[13] & 255) << 8;
        this.r[7] = (t5 >>> 11 | t6 << 5) & 8065;
        t7 = key[14] & 255 | (key[15] & 255) << 8;
        this.r[8] = (t6 >>> 8 | t7 << 8) & 8191;
        this.r[9] = t7 >>> 5 & 127;
        this.pad[0] = key[16] & 255 | (key[17] & 255) << 8;
        this.pad[1] = key[18] & 255 | (key[19] & 255) << 8;
        this.pad[2] = key[20] & 255 | (key[21] & 255) << 8;
        this.pad[3] = key[22] & 255 | (key[23] & 255) << 8;
        this.pad[4] = key[24] & 255 | (key[25] & 255) << 8;
        this.pad[5] = key[26] & 255 | (key[27] & 255) << 8;
        this.pad[6] = key[28] & 255 | (key[29] & 255) << 8;
        this.pad[7] = key[30] & 255 | (key[31] & 255) << 8;
      };
      poly1305.prototype.blocks = function(m, mpos, bytes) {
        var hibit = this.fin ? 0 : 1 << 11;
        var t0, t1, t2, t3, t4, t5, t6, t7, c;
        var d0, d1, d2, d3, d4, d5, d6, d7, d8, d9;
        var h0 = this.h[0], h1 = this.h[1], h2 = this.h[2], h3 = this.h[3], h4 = this.h[4], h5 = this.h[5], h6 = this.h[6], h7 = this.h[7], h8 = this.h[8], h9 = this.h[9];
        var r0 = this.r[0], r1 = this.r[1], r2 = this.r[2], r3 = this.r[3], r4 = this.r[4], r5 = this.r[5], r6 = this.r[6], r7 = this.r[7], r8 = this.r[8], r9 = this.r[9];
        while (bytes >= 16) {
          t0 = m[mpos + 0] & 255 | (m[mpos + 1] & 255) << 8;
          h0 += t0 & 8191;
          t1 = m[mpos + 2] & 255 | (m[mpos + 3] & 255) << 8;
          h1 += (t0 >>> 13 | t1 << 3) & 8191;
          t2 = m[mpos + 4] & 255 | (m[mpos + 5] & 255) << 8;
          h2 += (t1 >>> 10 | t2 << 6) & 8191;
          t3 = m[mpos + 6] & 255 | (m[mpos + 7] & 255) << 8;
          h3 += (t2 >>> 7 | t3 << 9) & 8191;
          t4 = m[mpos + 8] & 255 | (m[mpos + 9] & 255) << 8;
          h4 += (t3 >>> 4 | t4 << 12) & 8191;
          h5 += t4 >>> 1 & 8191;
          t5 = m[mpos + 10] & 255 | (m[mpos + 11] & 255) << 8;
          h6 += (t4 >>> 14 | t5 << 2) & 8191;
          t6 = m[mpos + 12] & 255 | (m[mpos + 13] & 255) << 8;
          h7 += (t5 >>> 11 | t6 << 5) & 8191;
          t7 = m[mpos + 14] & 255 | (m[mpos + 15] & 255) << 8;
          h8 += (t6 >>> 8 | t7 << 8) & 8191;
          h9 += t7 >>> 5 | hibit;
          c = 0;
          d0 = c;
          d0 += h0 * r0;
          d0 += h1 * (5 * r9);
          d0 += h2 * (5 * r8);
          d0 += h3 * (5 * r7);
          d0 += h4 * (5 * r6);
          c = d0 >>> 13;
          d0 &= 8191;
          d0 += h5 * (5 * r5);
          d0 += h6 * (5 * r4);
          d0 += h7 * (5 * r3);
          d0 += h8 * (5 * r2);
          d0 += h9 * (5 * r1);
          c += d0 >>> 13;
          d0 &= 8191;
          d1 = c;
          d1 += h0 * r1;
          d1 += h1 * r0;
          d1 += h2 * (5 * r9);
          d1 += h3 * (5 * r8);
          d1 += h4 * (5 * r7);
          c = d1 >>> 13;
          d1 &= 8191;
          d1 += h5 * (5 * r6);
          d1 += h6 * (5 * r5);
          d1 += h7 * (5 * r4);
          d1 += h8 * (5 * r3);
          d1 += h9 * (5 * r2);
          c += d1 >>> 13;
          d1 &= 8191;
          d2 = c;
          d2 += h0 * r2;
          d2 += h1 * r1;
          d2 += h2 * r0;
          d2 += h3 * (5 * r9);
          d2 += h4 * (5 * r8);
          c = d2 >>> 13;
          d2 &= 8191;
          d2 += h5 * (5 * r7);
          d2 += h6 * (5 * r6);
          d2 += h7 * (5 * r5);
          d2 += h8 * (5 * r4);
          d2 += h9 * (5 * r3);
          c += d2 >>> 13;
          d2 &= 8191;
          d3 = c;
          d3 += h0 * r3;
          d3 += h1 * r2;
          d3 += h2 * r1;
          d3 += h3 * r0;
          d3 += h4 * (5 * r9);
          c = d3 >>> 13;
          d3 &= 8191;
          d3 += h5 * (5 * r8);
          d3 += h6 * (5 * r7);
          d3 += h7 * (5 * r6);
          d3 += h8 * (5 * r5);
          d3 += h9 * (5 * r4);
          c += d3 >>> 13;
          d3 &= 8191;
          d4 = c;
          d4 += h0 * r4;
          d4 += h1 * r3;
          d4 += h2 * r2;
          d4 += h3 * r1;
          d4 += h4 * r0;
          c = d4 >>> 13;
          d4 &= 8191;
          d4 += h5 * (5 * r9);
          d4 += h6 * (5 * r8);
          d4 += h7 * (5 * r7);
          d4 += h8 * (5 * r6);
          d4 += h9 * (5 * r5);
          c += d4 >>> 13;
          d4 &= 8191;
          d5 = c;
          d5 += h0 * r5;
          d5 += h1 * r4;
          d5 += h2 * r3;
          d5 += h3 * r2;
          d5 += h4 * r1;
          c = d5 >>> 13;
          d5 &= 8191;
          d5 += h5 * r0;
          d5 += h6 * (5 * r9);
          d5 += h7 * (5 * r8);
          d5 += h8 * (5 * r7);
          d5 += h9 * (5 * r6);
          c += d5 >>> 13;
          d5 &= 8191;
          d6 = c;
          d6 += h0 * r6;
          d6 += h1 * r5;
          d6 += h2 * r4;
          d6 += h3 * r3;
          d6 += h4 * r2;
          c = d6 >>> 13;
          d6 &= 8191;
          d6 += h5 * r1;
          d6 += h6 * r0;
          d6 += h7 * (5 * r9);
          d6 += h8 * (5 * r8);
          d6 += h9 * (5 * r7);
          c += d6 >>> 13;
          d6 &= 8191;
          d7 = c;
          d7 += h0 * r7;
          d7 += h1 * r6;
          d7 += h2 * r5;
          d7 += h3 * r4;
          d7 += h4 * r3;
          c = d7 >>> 13;
          d7 &= 8191;
          d7 += h5 * r2;
          d7 += h6 * r1;
          d7 += h7 * r0;
          d7 += h8 * (5 * r9);
          d7 += h9 * (5 * r8);
          c += d7 >>> 13;
          d7 &= 8191;
          d8 = c;
          d8 += h0 * r8;
          d8 += h1 * r7;
          d8 += h2 * r6;
          d8 += h3 * r5;
          d8 += h4 * r4;
          c = d8 >>> 13;
          d8 &= 8191;
          d8 += h5 * r3;
          d8 += h6 * r2;
          d8 += h7 * r1;
          d8 += h8 * r0;
          d8 += h9 * (5 * r9);
          c += d8 >>> 13;
          d8 &= 8191;
          d9 = c;
          d9 += h0 * r9;
          d9 += h1 * r8;
          d9 += h2 * r7;
          d9 += h3 * r6;
          d9 += h4 * r5;
          c = d9 >>> 13;
          d9 &= 8191;
          d9 += h5 * r4;
          d9 += h6 * r3;
          d9 += h7 * r2;
          d9 += h8 * r1;
          d9 += h9 * r0;
          c += d9 >>> 13;
          d9 &= 8191;
          c = (c << 2) + c | 0;
          c = c + d0 | 0;
          d0 = c & 8191;
          c = c >>> 13;
          d1 += c;
          h0 = d0;
          h1 = d1;
          h2 = d2;
          h3 = d3;
          h4 = d4;
          h5 = d5;
          h6 = d6;
          h7 = d7;
          h8 = d8;
          h9 = d9;
          mpos += 16;
          bytes -= 16;
        }
        this.h[0] = h0;
        this.h[1] = h1;
        this.h[2] = h2;
        this.h[3] = h3;
        this.h[4] = h4;
        this.h[5] = h5;
        this.h[6] = h6;
        this.h[7] = h7;
        this.h[8] = h8;
        this.h[9] = h9;
      };
      poly1305.prototype.finish = function(mac, macpos) {
        var g = new Uint16Array(10);
        var c, mask, f, i;
        if (this.leftover) {
          i = this.leftover;
          this.buffer[i++] = 1;
          for (; i < 16; i++) this.buffer[i] = 0;
          this.fin = 1;
          this.blocks(this.buffer, 0, 16);
        }
        c = this.h[1] >>> 13;
        this.h[1] &= 8191;
        for (i = 2; i < 10; i++) {
          this.h[i] += c;
          c = this.h[i] >>> 13;
          this.h[i] &= 8191;
        }
        this.h[0] += c * 5;
        c = this.h[0] >>> 13;
        this.h[0] &= 8191;
        this.h[1] += c;
        c = this.h[1] >>> 13;
        this.h[1] &= 8191;
        this.h[2] += c;
        g[0] = this.h[0] + 5;
        c = g[0] >>> 13;
        g[0] &= 8191;
        for (i = 1; i < 10; i++) {
          g[i] = this.h[i] + c;
          c = g[i] >>> 13;
          g[i] &= 8191;
        }
        g[9] -= 1 << 13;
        mask = (c ^ 1) - 1;
        for (i = 0; i < 10; i++) g[i] &= mask;
        mask = ~mask;
        for (i = 0; i < 10; i++) this.h[i] = this.h[i] & mask | g[i];
        this.h[0] = (this.h[0] | this.h[1] << 13) & 65535;
        this.h[1] = (this.h[1] >>> 3 | this.h[2] << 10) & 65535;
        this.h[2] = (this.h[2] >>> 6 | this.h[3] << 7) & 65535;
        this.h[3] = (this.h[3] >>> 9 | this.h[4] << 4) & 65535;
        this.h[4] = (this.h[4] >>> 12 | this.h[5] << 1 | this.h[6] << 14) & 65535;
        this.h[5] = (this.h[6] >>> 2 | this.h[7] << 11) & 65535;
        this.h[6] = (this.h[7] >>> 5 | this.h[8] << 8) & 65535;
        this.h[7] = (this.h[8] >>> 8 | this.h[9] << 5) & 65535;
        f = this.h[0] + this.pad[0];
        this.h[0] = f & 65535;
        for (i = 1; i < 8; i++) {
          f = (this.h[i] + this.pad[i] | 0) + (f >>> 16) | 0;
          this.h[i] = f & 65535;
        }
        mac[macpos + 0] = this.h[0] >>> 0 & 255;
        mac[macpos + 1] = this.h[0] >>> 8 & 255;
        mac[macpos + 2] = this.h[1] >>> 0 & 255;
        mac[macpos + 3] = this.h[1] >>> 8 & 255;
        mac[macpos + 4] = this.h[2] >>> 0 & 255;
        mac[macpos + 5] = this.h[2] >>> 8 & 255;
        mac[macpos + 6] = this.h[3] >>> 0 & 255;
        mac[macpos + 7] = this.h[3] >>> 8 & 255;
        mac[macpos + 8] = this.h[4] >>> 0 & 255;
        mac[macpos + 9] = this.h[4] >>> 8 & 255;
        mac[macpos + 10] = this.h[5] >>> 0 & 255;
        mac[macpos + 11] = this.h[5] >>> 8 & 255;
        mac[macpos + 12] = this.h[6] >>> 0 & 255;
        mac[macpos + 13] = this.h[6] >>> 8 & 255;
        mac[macpos + 14] = this.h[7] >>> 0 & 255;
        mac[macpos + 15] = this.h[7] >>> 8 & 255;
      };
      poly1305.prototype.update = function(m, mpos, bytes) {
        var i, want;
        if (this.leftover) {
          want = 16 - this.leftover;
          if (want > bytes)
            want = bytes;
          for (i = 0; i < want; i++)
            this.buffer[this.leftover + i] = m[mpos + i];
          bytes -= want;
          mpos += want;
          this.leftover += want;
          if (this.leftover < 16)
            return;
          this.blocks(this.buffer, 0, 16);
          this.leftover = 0;
        }
        if (bytes >= 16) {
          want = bytes - bytes % 16;
          this.blocks(m, mpos, want);
          mpos += want;
          bytes -= want;
        }
        if (bytes) {
          for (i = 0; i < bytes; i++)
            this.buffer[this.leftover + i] = m[mpos + i];
          this.leftover += bytes;
        }
      };
      function crypto_onetimeauth(out, outpos, m, mpos, n, k) {
        var s = new poly1305(k);
        s.update(m, mpos, n);
        s.finish(out, outpos);
        return 0;
      }
      function crypto_onetimeauth_verify(h, hpos, m, mpos, n, k) {
        var x = new Uint8Array(16);
        crypto_onetimeauth(x, 0, m, mpos, n, k);
        return crypto_verify_16(h, hpos, x, 0);
      }
      function crypto_secretbox(c, m, d, n, k) {
        var i;
        if (d < 32) return -1;
        crypto_stream_xor(c, 0, m, 0, d, n, k);
        crypto_onetimeauth(c, 16, c, 32, d - 32, c);
        for (i = 0; i < 16; i++) c[i] = 0;
        return 0;
      }
      function crypto_secretbox_open(m, c, d, n, k) {
        var i;
        var x = new Uint8Array(32);
        if (d < 32) return -1;
        crypto_stream(x, 0, 32, n, k);
        if (crypto_onetimeauth_verify(c, 16, c, 32, d - 32, x) !== 0) return -1;
        crypto_stream_xor(m, 0, c, 0, d, n, k);
        for (i = 0; i < 32; i++) m[i] = 0;
        return 0;
      }
      function set25519(r, a) {
        var i;
        for (i = 0; i < 16; i++) r[i] = a[i] | 0;
      }
      function car25519(o) {
        var i, v, c = 1;
        for (i = 0; i < 16; i++) {
          v = o[i] + c + 65535;
          c = Math.floor(v / 65536);
          o[i] = v - c * 65536;
        }
        o[0] += c - 1 + 37 * (c - 1);
      }
      function sel25519(p, q, b) {
        var t, c = ~(b - 1);
        for (var i = 0; i < 16; i++) {
          t = c & (p[i] ^ q[i]);
          p[i] ^= t;
          q[i] ^= t;
        }
      }
      function pack25519(o, n) {
        var i, j, b;
        var m = gf(), t = gf();
        for (i = 0; i < 16; i++) t[i] = n[i];
        car25519(t);
        car25519(t);
        car25519(t);
        for (j = 0; j < 2; j++) {
          m[0] = t[0] - 65517;
          for (i = 1; i < 15; i++) {
            m[i] = t[i] - 65535 - (m[i - 1] >> 16 & 1);
            m[i - 1] &= 65535;
          }
          m[15] = t[15] - 32767 - (m[14] >> 16 & 1);
          b = m[15] >> 16 & 1;
          m[14] &= 65535;
          sel25519(t, m, 1 - b);
        }
        for (i = 0; i < 16; i++) {
          o[2 * i] = t[i] & 255;
          o[2 * i + 1] = t[i] >> 8;
        }
      }
      function neq25519(a, b) {
        var c = new Uint8Array(32), d = new Uint8Array(32);
        pack25519(c, a);
        pack25519(d, b);
        return crypto_verify_32(c, 0, d, 0);
      }
      function par25519(a) {
        var d = new Uint8Array(32);
        pack25519(d, a);
        return d[0] & 1;
      }
      function unpack25519(o, n) {
        var i;
        for (i = 0; i < 16; i++) o[i] = n[2 * i] + (n[2 * i + 1] << 8);
        o[15] &= 32767;
      }
      function A(o, a, b) {
        for (var i = 0; i < 16; i++) o[i] = a[i] + b[i];
      }
      function Z(o, a, b) {
        for (var i = 0; i < 16; i++) o[i] = a[i] - b[i];
      }
      function M(o, a, b) {
        var v, c, t0 = 0, t1 = 0, t2 = 0, t3 = 0, t4 = 0, t5 = 0, t6 = 0, t7 = 0, t8 = 0, t9 = 0, t10 = 0, t11 = 0, t12 = 0, t13 = 0, t14 = 0, t15 = 0, t16 = 0, t17 = 0, t18 = 0, t19 = 0, t20 = 0, t21 = 0, t22 = 0, t23 = 0, t24 = 0, t25 = 0, t26 = 0, t27 = 0, t28 = 0, t29 = 0, t30 = 0, b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7], b8 = b[8], b9 = b[9], b10 = b[10], b11 = b[11], b12 = b[12], b13 = b[13], b14 = b[14], b15 = b[15];
        v = a[0];
        t0 += v * b0;
        t1 += v * b1;
        t2 += v * b2;
        t3 += v * b3;
        t4 += v * b4;
        t5 += v * b5;
        t6 += v * b6;
        t7 += v * b7;
        t8 += v * b8;
        t9 += v * b9;
        t10 += v * b10;
        t11 += v * b11;
        t12 += v * b12;
        t13 += v * b13;
        t14 += v * b14;
        t15 += v * b15;
        v = a[1];
        t1 += v * b0;
        t2 += v * b1;
        t3 += v * b2;
        t4 += v * b3;
        t5 += v * b4;
        t6 += v * b5;
        t7 += v * b6;
        t8 += v * b7;
        t9 += v * b8;
        t10 += v * b9;
        t11 += v * b10;
        t12 += v * b11;
        t13 += v * b12;
        t14 += v * b13;
        t15 += v * b14;
        t16 += v * b15;
        v = a[2];
        t2 += v * b0;
        t3 += v * b1;
        t4 += v * b2;
        t5 += v * b3;
        t6 += v * b4;
        t7 += v * b5;
        t8 += v * b6;
        t9 += v * b7;
        t10 += v * b8;
        t11 += v * b9;
        t12 += v * b10;
        t13 += v * b11;
        t14 += v * b12;
        t15 += v * b13;
        t16 += v * b14;
        t17 += v * b15;
        v = a[3];
        t3 += v * b0;
        t4 += v * b1;
        t5 += v * b2;
        t6 += v * b3;
        t7 += v * b4;
        t8 += v * b5;
        t9 += v * b6;
        t10 += v * b7;
        t11 += v * b8;
        t12 += v * b9;
        t13 += v * b10;
        t14 += v * b11;
        t15 += v * b12;
        t16 += v * b13;
        t17 += v * b14;
        t18 += v * b15;
        v = a[4];
        t4 += v * b0;
        t5 += v * b1;
        t6 += v * b2;
        t7 += v * b3;
        t8 += v * b4;
        t9 += v * b5;
        t10 += v * b6;
        t11 += v * b7;
        t12 += v * b8;
        t13 += v * b9;
        t14 += v * b10;
        t15 += v * b11;
        t16 += v * b12;
        t17 += v * b13;
        t18 += v * b14;
        t19 += v * b15;
        v = a[5];
        t5 += v * b0;
        t6 += v * b1;
        t7 += v * b2;
        t8 += v * b3;
        t9 += v * b4;
        t10 += v * b5;
        t11 += v * b6;
        t12 += v * b7;
        t13 += v * b8;
        t14 += v * b9;
        t15 += v * b10;
        t16 += v * b11;
        t17 += v * b12;
        t18 += v * b13;
        t19 += v * b14;
        t20 += v * b15;
        v = a[6];
        t6 += v * b0;
        t7 += v * b1;
        t8 += v * b2;
        t9 += v * b3;
        t10 += v * b4;
        t11 += v * b5;
        t12 += v * b6;
        t13 += v * b7;
        t14 += v * b8;
        t15 += v * b9;
        t16 += v * b10;
        t17 += v * b11;
        t18 += v * b12;
        t19 += v * b13;
        t20 += v * b14;
        t21 += v * b15;
        v = a[7];
        t7 += v * b0;
        t8 += v * b1;
        t9 += v * b2;
        t10 += v * b3;
        t11 += v * b4;
        t12 += v * b5;
        t13 += v * b6;
        t14 += v * b7;
        t15 += v * b8;
        t16 += v * b9;
        t17 += v * b10;
        t18 += v * b11;
        t19 += v * b12;
        t20 += v * b13;
        t21 += v * b14;
        t22 += v * b15;
        v = a[8];
        t8 += v * b0;
        t9 += v * b1;
        t10 += v * b2;
        t11 += v * b3;
        t12 += v * b4;
        t13 += v * b5;
        t14 += v * b6;
        t15 += v * b7;
        t16 += v * b8;
        t17 += v * b9;
        t18 += v * b10;
        t19 += v * b11;
        t20 += v * b12;
        t21 += v * b13;
        t22 += v * b14;
        t23 += v * b15;
        v = a[9];
        t9 += v * b0;
        t10 += v * b1;
        t11 += v * b2;
        t12 += v * b3;
        t13 += v * b4;
        t14 += v * b5;
        t15 += v * b6;
        t16 += v * b7;
        t17 += v * b8;
        t18 += v * b9;
        t19 += v * b10;
        t20 += v * b11;
        t21 += v * b12;
        t22 += v * b13;
        t23 += v * b14;
        t24 += v * b15;
        v = a[10];
        t10 += v * b0;
        t11 += v * b1;
        t12 += v * b2;
        t13 += v * b3;
        t14 += v * b4;
        t15 += v * b5;
        t16 += v * b6;
        t17 += v * b7;
        t18 += v * b8;
        t19 += v * b9;
        t20 += v * b10;
        t21 += v * b11;
        t22 += v * b12;
        t23 += v * b13;
        t24 += v * b14;
        t25 += v * b15;
        v = a[11];
        t11 += v * b0;
        t12 += v * b1;
        t13 += v * b2;
        t14 += v * b3;
        t15 += v * b4;
        t16 += v * b5;
        t17 += v * b6;
        t18 += v * b7;
        t19 += v * b8;
        t20 += v * b9;
        t21 += v * b10;
        t22 += v * b11;
        t23 += v * b12;
        t24 += v * b13;
        t25 += v * b14;
        t26 += v * b15;
        v = a[12];
        t12 += v * b0;
        t13 += v * b1;
        t14 += v * b2;
        t15 += v * b3;
        t16 += v * b4;
        t17 += v * b5;
        t18 += v * b6;
        t19 += v * b7;
        t20 += v * b8;
        t21 += v * b9;
        t22 += v * b10;
        t23 += v * b11;
        t24 += v * b12;
        t25 += v * b13;
        t26 += v * b14;
        t27 += v * b15;
        v = a[13];
        t13 += v * b0;
        t14 += v * b1;
        t15 += v * b2;
        t16 += v * b3;
        t17 += v * b4;
        t18 += v * b5;
        t19 += v * b6;
        t20 += v * b7;
        t21 += v * b8;
        t22 += v * b9;
        t23 += v * b10;
        t24 += v * b11;
        t25 += v * b12;
        t26 += v * b13;
        t27 += v * b14;
        t28 += v * b15;
        v = a[14];
        t14 += v * b0;
        t15 += v * b1;
        t16 += v * b2;
        t17 += v * b3;
        t18 += v * b4;
        t19 += v * b5;
        t20 += v * b6;
        t21 += v * b7;
        t22 += v * b8;
        t23 += v * b9;
        t24 += v * b10;
        t25 += v * b11;
        t26 += v * b12;
        t27 += v * b13;
        t28 += v * b14;
        t29 += v * b15;
        v = a[15];
        t15 += v * b0;
        t16 += v * b1;
        t17 += v * b2;
        t18 += v * b3;
        t19 += v * b4;
        t20 += v * b5;
        t21 += v * b6;
        t22 += v * b7;
        t23 += v * b8;
        t24 += v * b9;
        t25 += v * b10;
        t26 += v * b11;
        t27 += v * b12;
        t28 += v * b13;
        t29 += v * b14;
        t30 += v * b15;
        t0 += 38 * t16;
        t1 += 38 * t17;
        t2 += 38 * t18;
        t3 += 38 * t19;
        t4 += 38 * t20;
        t5 += 38 * t21;
        t6 += 38 * t22;
        t7 += 38 * t23;
        t8 += 38 * t24;
        t9 += 38 * t25;
        t10 += 38 * t26;
        t11 += 38 * t27;
        t12 += 38 * t28;
        t13 += 38 * t29;
        t14 += 38 * t30;
        c = 1;
        v = t0 + c + 65535;
        c = Math.floor(v / 65536);
        t0 = v - c * 65536;
        v = t1 + c + 65535;
        c = Math.floor(v / 65536);
        t1 = v - c * 65536;
        v = t2 + c + 65535;
        c = Math.floor(v / 65536);
        t2 = v - c * 65536;
        v = t3 + c + 65535;
        c = Math.floor(v / 65536);
        t3 = v - c * 65536;
        v = t4 + c + 65535;
        c = Math.floor(v / 65536);
        t4 = v - c * 65536;
        v = t5 + c + 65535;
        c = Math.floor(v / 65536);
        t5 = v - c * 65536;
        v = t6 + c + 65535;
        c = Math.floor(v / 65536);
        t6 = v - c * 65536;
        v = t7 + c + 65535;
        c = Math.floor(v / 65536);
        t7 = v - c * 65536;
        v = t8 + c + 65535;
        c = Math.floor(v / 65536);
        t8 = v - c * 65536;
        v = t9 + c + 65535;
        c = Math.floor(v / 65536);
        t9 = v - c * 65536;
        v = t10 + c + 65535;
        c = Math.floor(v / 65536);
        t10 = v - c * 65536;
        v = t11 + c + 65535;
        c = Math.floor(v / 65536);
        t11 = v - c * 65536;
        v = t12 + c + 65535;
        c = Math.floor(v / 65536);
        t12 = v - c * 65536;
        v = t13 + c + 65535;
        c = Math.floor(v / 65536);
        t13 = v - c * 65536;
        v = t14 + c + 65535;
        c = Math.floor(v / 65536);
        t14 = v - c * 65536;
        v = t15 + c + 65535;
        c = Math.floor(v / 65536);
        t15 = v - c * 65536;
        t0 += c - 1 + 37 * (c - 1);
        c = 1;
        v = t0 + c + 65535;
        c = Math.floor(v / 65536);
        t0 = v - c * 65536;
        v = t1 + c + 65535;
        c = Math.floor(v / 65536);
        t1 = v - c * 65536;
        v = t2 + c + 65535;
        c = Math.floor(v / 65536);
        t2 = v - c * 65536;
        v = t3 + c + 65535;
        c = Math.floor(v / 65536);
        t3 = v - c * 65536;
        v = t4 + c + 65535;
        c = Math.floor(v / 65536);
        t4 = v - c * 65536;
        v = t5 + c + 65535;
        c = Math.floor(v / 65536);
        t5 = v - c * 65536;
        v = t6 + c + 65535;
        c = Math.floor(v / 65536);
        t6 = v - c * 65536;
        v = t7 + c + 65535;
        c = Math.floor(v / 65536);
        t7 = v - c * 65536;
        v = t8 + c + 65535;
        c = Math.floor(v / 65536);
        t8 = v - c * 65536;
        v = t9 + c + 65535;
        c = Math.floor(v / 65536);
        t9 = v - c * 65536;
        v = t10 + c + 65535;
        c = Math.floor(v / 65536);
        t10 = v - c * 65536;
        v = t11 + c + 65535;
        c = Math.floor(v / 65536);
        t11 = v - c * 65536;
        v = t12 + c + 65535;
        c = Math.floor(v / 65536);
        t12 = v - c * 65536;
        v = t13 + c + 65535;
        c = Math.floor(v / 65536);
        t13 = v - c * 65536;
        v = t14 + c + 65535;
        c = Math.floor(v / 65536);
        t14 = v - c * 65536;
        v = t15 + c + 65535;
        c = Math.floor(v / 65536);
        t15 = v - c * 65536;
        t0 += c - 1 + 37 * (c - 1);
        o[0] = t0;
        o[1] = t1;
        o[2] = t2;
        o[3] = t3;
        o[4] = t4;
        o[5] = t5;
        o[6] = t6;
        o[7] = t7;
        o[8] = t8;
        o[9] = t9;
        o[10] = t10;
        o[11] = t11;
        o[12] = t12;
        o[13] = t13;
        o[14] = t14;
        o[15] = t15;
      }
      function S(o, a) {
        M(o, a, a);
      }
      function inv25519(o, i) {
        var c = gf();
        var a;
        for (a = 0; a < 16; a++) c[a] = i[a];
        for (a = 253; a >= 0; a--) {
          S(c, c);
          if (a !== 2 && a !== 4) M(c, c, i);
        }
        for (a = 0; a < 16; a++) o[a] = c[a];
      }
      function pow2523(o, i) {
        var c = gf();
        var a;
        for (a = 0; a < 16; a++) c[a] = i[a];
        for (a = 250; a >= 0; a--) {
          S(c, c);
          if (a !== 1) M(c, c, i);
        }
        for (a = 0; a < 16; a++) o[a] = c[a];
      }
      function crypto_scalarmult(q, n, p) {
        var z = new Uint8Array(32);
        var x = new Float64Array(80), r, i;
        var a = gf(), b = gf(), c = gf(), d = gf(), e = gf(), f = gf();
        for (i = 0; i < 31; i++) z[i] = n[i];
        z[31] = n[31] & 127 | 64;
        z[0] &= 248;
        unpack25519(x, p);
        for (i = 0; i < 16; i++) {
          b[i] = x[i];
          d[i] = a[i] = c[i] = 0;
        }
        a[0] = d[0] = 1;
        for (i = 254; i >= 0; --i) {
          r = z[i >>> 3] >>> (i & 7) & 1;
          sel25519(a, b, r);
          sel25519(c, d, r);
          A(e, a, c);
          Z(a, a, c);
          A(c, b, d);
          Z(b, b, d);
          S(d, e);
          S(f, a);
          M(a, c, a);
          M(c, b, e);
          A(e, a, c);
          Z(a, a, c);
          S(b, a);
          Z(c, d, f);
          M(a, c, _121665);
          A(a, a, d);
          M(c, c, a);
          M(a, d, f);
          M(d, b, x);
          S(b, e);
          sel25519(a, b, r);
          sel25519(c, d, r);
        }
        for (i = 0; i < 16; i++) {
          x[i + 16] = a[i];
          x[i + 32] = c[i];
          x[i + 48] = b[i];
          x[i + 64] = d[i];
        }
        var x32 = x.subarray(32);
        var x16 = x.subarray(16);
        inv25519(x32, x32);
        M(x16, x16, x32);
        pack25519(q, x16);
        return 0;
      }
      function crypto_scalarmult_base(q, n) {
        return crypto_scalarmult(q, n, _9);
      }
      function crypto_box_keypair(y, x) {
        randombytes(x, 32);
        return crypto_scalarmult_base(y, x);
      }
      function crypto_box_beforenm(k, y, x) {
        var s = new Uint8Array(32);
        crypto_scalarmult(s, x, y);
        return crypto_core_hsalsa20(k, _0, s, sigma);
      }
      var crypto_box_afternm = crypto_secretbox;
      var crypto_box_open_afternm = crypto_secretbox_open;
      function crypto_box(c, m, d, n, y, x) {
        var k = new Uint8Array(32);
        crypto_box_beforenm(k, y, x);
        return crypto_box_afternm(c, m, d, n, k);
      }
      function crypto_box_open(m, c, d, n, y, x) {
        var k = new Uint8Array(32);
        crypto_box_beforenm(k, y, x);
        return crypto_box_open_afternm(m, c, d, n, k);
      }
      var K = [
        1116352408,
        3609767458,
        1899447441,
        602891725,
        3049323471,
        3964484399,
        3921009573,
        2173295548,
        961987163,
        4081628472,
        1508970993,
        3053834265,
        2453635748,
        2937671579,
        2870763221,
        3664609560,
        3624381080,
        2734883394,
        310598401,
        1164996542,
        607225278,
        1323610764,
        1426881987,
        3590304994,
        1925078388,
        4068182383,
        2162078206,
        991336113,
        2614888103,
        633803317,
        3248222580,
        3479774868,
        3835390401,
        2666613458,
        4022224774,
        944711139,
        264347078,
        2341262773,
        604807628,
        2007800933,
        770255983,
        1495990901,
        1249150122,
        1856431235,
        1555081692,
        3175218132,
        1996064986,
        2198950837,
        2554220882,
        3999719339,
        2821834349,
        766784016,
        2952996808,
        2566594879,
        3210313671,
        3203337956,
        3336571891,
        1034457026,
        3584528711,
        2466948901,
        113926993,
        3758326383,
        338241895,
        168717936,
        666307205,
        1188179964,
        773529912,
        1546045734,
        1294757372,
        1522805485,
        1396182291,
        2643833823,
        1695183700,
        2343527390,
        1986661051,
        1014477480,
        2177026350,
        1206759142,
        2456956037,
        344077627,
        2730485921,
        1290863460,
        2820302411,
        3158454273,
        3259730800,
        3505952657,
        3345764771,
        106217008,
        3516065817,
        3606008344,
        3600352804,
        1432725776,
        4094571909,
        1467031594,
        275423344,
        851169720,
        430227734,
        3100823752,
        506948616,
        1363258195,
        659060556,
        3750685593,
        883997877,
        3785050280,
        958139571,
        3318307427,
        1322822218,
        3812723403,
        1537002063,
        2003034995,
        1747873779,
        3602036899,
        1955562222,
        1575990012,
        2024104815,
        1125592928,
        2227730452,
        2716904306,
        2361852424,
        442776044,
        2428436474,
        593698344,
        2756734187,
        3733110249,
        3204031479,
        2999351573,
        3329325298,
        3815920427,
        3391569614,
        3928383900,
        3515267271,
        566280711,
        3940187606,
        3454069534,
        4118630271,
        4000239992,
        116418474,
        1914138554,
        174292421,
        2731055270,
        289380356,
        3203993006,
        460393269,
        320620315,
        685471733,
        587496836,
        852142971,
        1086792851,
        1017036298,
        365543100,
        1126000580,
        2618297676,
        1288033470,
        3409855158,
        1501505948,
        4234509866,
        1607167915,
        987167468,
        1816402316,
        1246189591
      ];
      function crypto_hashblocks_hl(hh, hl, m, n) {
        var wh = new Int32Array(16), wl = new Int32Array(16), bh0, bh1, bh2, bh3, bh4, bh5, bh6, bh7, bl0, bl1, bl2, bl3, bl4, bl5, bl6, bl7, th, tl, i, j, h, l, a, b, c, d;
        var ah0 = hh[0], ah1 = hh[1], ah2 = hh[2], ah3 = hh[3], ah4 = hh[4], ah5 = hh[5], ah6 = hh[6], ah7 = hh[7], al0 = hl[0], al1 = hl[1], al2 = hl[2], al3 = hl[3], al4 = hl[4], al5 = hl[5], al6 = hl[6], al7 = hl[7];
        var pos = 0;
        while (n >= 128) {
          for (i = 0; i < 16; i++) {
            j = 8 * i + pos;
            wh[i] = m[j + 0] << 24 | m[j + 1] << 16 | m[j + 2] << 8 | m[j + 3];
            wl[i] = m[j + 4] << 24 | m[j + 5] << 16 | m[j + 6] << 8 | m[j + 7];
          }
          for (i = 0; i < 80; i++) {
            bh0 = ah0;
            bh1 = ah1;
            bh2 = ah2;
            bh3 = ah3;
            bh4 = ah4;
            bh5 = ah5;
            bh6 = ah6;
            bh7 = ah7;
            bl0 = al0;
            bl1 = al1;
            bl2 = al2;
            bl3 = al3;
            bl4 = al4;
            bl5 = al5;
            bl6 = al6;
            bl7 = al7;
            h = ah7;
            l = al7;
            a = l & 65535;
            b = l >>> 16;
            c = h & 65535;
            d = h >>> 16;
            h = (ah4 >>> 14 | al4 << 32 - 14) ^ (ah4 >>> 18 | al4 << 32 - 18) ^ (al4 >>> 41 - 32 | ah4 << 32 - (41 - 32));
            l = (al4 >>> 14 | ah4 << 32 - 14) ^ (al4 >>> 18 | ah4 << 32 - 18) ^ (ah4 >>> 41 - 32 | al4 << 32 - (41 - 32));
            a += l & 65535;
            b += l >>> 16;
            c += h & 65535;
            d += h >>> 16;
            h = ah4 & ah5 ^ ~ah4 & ah6;
            l = al4 & al5 ^ ~al4 & al6;
            a += l & 65535;
            b += l >>> 16;
            c += h & 65535;
            d += h >>> 16;
            h = K[i * 2];
            l = K[i * 2 + 1];
            a += l & 65535;
            b += l >>> 16;
            c += h & 65535;
            d += h >>> 16;
            h = wh[i % 16];
            l = wl[i % 16];
            a += l & 65535;
            b += l >>> 16;
            c += h & 65535;
            d += h >>> 16;
            b += a >>> 16;
            c += b >>> 16;
            d += c >>> 16;
            th = c & 65535 | d << 16;
            tl = a & 65535 | b << 16;
            h = th;
            l = tl;
            a = l & 65535;
            b = l >>> 16;
            c = h & 65535;
            d = h >>> 16;
            h = (ah0 >>> 28 | al0 << 32 - 28) ^ (al0 >>> 34 - 32 | ah0 << 32 - (34 - 32)) ^ (al0 >>> 39 - 32 | ah0 << 32 - (39 - 32));
            l = (al0 >>> 28 | ah0 << 32 - 28) ^ (ah0 >>> 34 - 32 | al0 << 32 - (34 - 32)) ^ (ah0 >>> 39 - 32 | al0 << 32 - (39 - 32));
            a += l & 65535;
            b += l >>> 16;
            c += h & 65535;
            d += h >>> 16;
            h = ah0 & ah1 ^ ah0 & ah2 ^ ah1 & ah2;
            l = al0 & al1 ^ al0 & al2 ^ al1 & al2;
            a += l & 65535;
            b += l >>> 16;
            c += h & 65535;
            d += h >>> 16;
            b += a >>> 16;
            c += b >>> 16;
            d += c >>> 16;
            bh7 = c & 65535 | d << 16;
            bl7 = a & 65535 | b << 16;
            h = bh3;
            l = bl3;
            a = l & 65535;
            b = l >>> 16;
            c = h & 65535;
            d = h >>> 16;
            h = th;
            l = tl;
            a += l & 65535;
            b += l >>> 16;
            c += h & 65535;
            d += h >>> 16;
            b += a >>> 16;
            c += b >>> 16;
            d += c >>> 16;
            bh3 = c & 65535 | d << 16;
            bl3 = a & 65535 | b << 16;
            ah1 = bh0;
            ah2 = bh1;
            ah3 = bh2;
            ah4 = bh3;
            ah5 = bh4;
            ah6 = bh5;
            ah7 = bh6;
            ah0 = bh7;
            al1 = bl0;
            al2 = bl1;
            al3 = bl2;
            al4 = bl3;
            al5 = bl4;
            al6 = bl5;
            al7 = bl6;
            al0 = bl7;
            if (i % 16 === 15) {
              for (j = 0; j < 16; j++) {
                h = wh[j];
                l = wl[j];
                a = l & 65535;
                b = l >>> 16;
                c = h & 65535;
                d = h >>> 16;
                h = wh[(j + 9) % 16];
                l = wl[(j + 9) % 16];
                a += l & 65535;
                b += l >>> 16;
                c += h & 65535;
                d += h >>> 16;
                th = wh[(j + 1) % 16];
                tl = wl[(j + 1) % 16];
                h = (th >>> 1 | tl << 32 - 1) ^ (th >>> 8 | tl << 32 - 8) ^ th >>> 7;
                l = (tl >>> 1 | th << 32 - 1) ^ (tl >>> 8 | th << 32 - 8) ^ (tl >>> 7 | th << 32 - 7);
                a += l & 65535;
                b += l >>> 16;
                c += h & 65535;
                d += h >>> 16;
                th = wh[(j + 14) % 16];
                tl = wl[(j + 14) % 16];
                h = (th >>> 19 | tl << 32 - 19) ^ (tl >>> 61 - 32 | th << 32 - (61 - 32)) ^ th >>> 6;
                l = (tl >>> 19 | th << 32 - 19) ^ (th >>> 61 - 32 | tl << 32 - (61 - 32)) ^ (tl >>> 6 | th << 32 - 6);
                a += l & 65535;
                b += l >>> 16;
                c += h & 65535;
                d += h >>> 16;
                b += a >>> 16;
                c += b >>> 16;
                d += c >>> 16;
                wh[j] = c & 65535 | d << 16;
                wl[j] = a & 65535 | b << 16;
              }
            }
          }
          h = ah0;
          l = al0;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[0];
          l = hl[0];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[0] = ah0 = c & 65535 | d << 16;
          hl[0] = al0 = a & 65535 | b << 16;
          h = ah1;
          l = al1;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[1];
          l = hl[1];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[1] = ah1 = c & 65535 | d << 16;
          hl[1] = al1 = a & 65535 | b << 16;
          h = ah2;
          l = al2;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[2];
          l = hl[2];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[2] = ah2 = c & 65535 | d << 16;
          hl[2] = al2 = a & 65535 | b << 16;
          h = ah3;
          l = al3;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[3];
          l = hl[3];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[3] = ah3 = c & 65535 | d << 16;
          hl[3] = al3 = a & 65535 | b << 16;
          h = ah4;
          l = al4;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[4];
          l = hl[4];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[4] = ah4 = c & 65535 | d << 16;
          hl[4] = al4 = a & 65535 | b << 16;
          h = ah5;
          l = al5;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[5];
          l = hl[5];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[5] = ah5 = c & 65535 | d << 16;
          hl[5] = al5 = a & 65535 | b << 16;
          h = ah6;
          l = al6;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[6];
          l = hl[6];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[6] = ah6 = c & 65535 | d << 16;
          hl[6] = al6 = a & 65535 | b << 16;
          h = ah7;
          l = al7;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[7];
          l = hl[7];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[7] = ah7 = c & 65535 | d << 16;
          hl[7] = al7 = a & 65535 | b << 16;
          pos += 128;
          n -= 128;
        }
        return n;
      }
      function crypto_hash(out, m, n) {
        var hh = new Int32Array(8), hl = new Int32Array(8), x = new Uint8Array(256), i, b = n;
        hh[0] = 1779033703;
        hh[1] = 3144134277;
        hh[2] = 1013904242;
        hh[3] = 2773480762;
        hh[4] = 1359893119;
        hh[5] = 2600822924;
        hh[6] = 528734635;
        hh[7] = 1541459225;
        hl[0] = 4089235720;
        hl[1] = 2227873595;
        hl[2] = 4271175723;
        hl[3] = 1595750129;
        hl[4] = 2917565137;
        hl[5] = 725511199;
        hl[6] = 4215389547;
        hl[7] = 327033209;
        crypto_hashblocks_hl(hh, hl, m, n);
        n %= 128;
        for (i = 0; i < n; i++) x[i] = m[b - n + i];
        x[n] = 128;
        n = 256 - 128 * (n < 112 ? 1 : 0);
        x[n - 9] = 0;
        ts64(x, n - 8, b / 536870912 | 0, b << 3);
        crypto_hashblocks_hl(hh, hl, x, n);
        for (i = 0; i < 8; i++) ts64(out, 8 * i, hh[i], hl[i]);
        return 0;
      }
      function add(p, q) {
        var a = gf(), b = gf(), c = gf(), d = gf(), e = gf(), f = gf(), g = gf(), h = gf(), t = gf();
        Z(a, p[1], p[0]);
        Z(t, q[1], q[0]);
        M(a, a, t);
        A(b, p[0], p[1]);
        A(t, q[0], q[1]);
        M(b, b, t);
        M(c, p[3], q[3]);
        M(c, c, D2);
        M(d, p[2], q[2]);
        A(d, d, d);
        Z(e, b, a);
        Z(f, d, c);
        A(g, d, c);
        A(h, b, a);
        M(p[0], e, f);
        M(p[1], h, g);
        M(p[2], g, f);
        M(p[3], e, h);
      }
      function cswap(p, q, b) {
        var i;
        for (i = 0; i < 4; i++) {
          sel25519(p[i], q[i], b);
        }
      }
      function pack(r, p) {
        var tx = gf(), ty = gf(), zi = gf();
        inv25519(zi, p[2]);
        M(tx, p[0], zi);
        M(ty, p[1], zi);
        pack25519(r, ty);
        r[31] ^= par25519(tx) << 7;
      }
      function scalarmult(p, q, s) {
        var b, i;
        set25519(p[0], gf0);
        set25519(p[1], gf1);
        set25519(p[2], gf1);
        set25519(p[3], gf0);
        for (i = 255; i >= 0; --i) {
          b = s[i / 8 | 0] >> (i & 7) & 1;
          cswap(p, q, b);
          add(q, p);
          add(p, p);
          cswap(p, q, b);
        }
      }
      function scalarbase(p, s) {
        var q = [gf(), gf(), gf(), gf()];
        set25519(q[0], X);
        set25519(q[1], Y);
        set25519(q[2], gf1);
        M(q[3], X, Y);
        scalarmult(p, q, s);
      }
      function crypto_sign_keypair(pk, sk, seeded) {
        var d = new Uint8Array(64);
        var p = [gf(), gf(), gf(), gf()];
        var i;
        if (!seeded) randombytes(sk, 32);
        crypto_hash(d, sk, 32);
        d[0] &= 248;
        d[31] &= 127;
        d[31] |= 64;
        scalarbase(p, d);
        pack(pk, p);
        for (i = 0; i < 32; i++) sk[i + 32] = pk[i];
        return 0;
      }
      var L = new Float64Array([237, 211, 245, 92, 26, 99, 18, 88, 214, 156, 247, 162, 222, 249, 222, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16]);
      function modL(r, x) {
        var carry, i, j, k;
        for (i = 63; i >= 32; --i) {
          carry = 0;
          for (j = i - 32, k = i - 12; j < k; ++j) {
            x[j] += carry - 16 * x[i] * L[j - (i - 32)];
            carry = Math.floor((x[j] + 128) / 256);
            x[j] -= carry * 256;
          }
          x[j] += carry;
          x[i] = 0;
        }
        carry = 0;
        for (j = 0; j < 32; j++) {
          x[j] += carry - (x[31] >> 4) * L[j];
          carry = x[j] >> 8;
          x[j] &= 255;
        }
        for (j = 0; j < 32; j++) x[j] -= carry * L[j];
        for (i = 0; i < 32; i++) {
          x[i + 1] += x[i] >> 8;
          r[i] = x[i] & 255;
        }
      }
      function reduce(r) {
        var x = new Float64Array(64), i;
        for (i = 0; i < 64; i++) x[i] = r[i];
        for (i = 0; i < 64; i++) r[i] = 0;
        modL(r, x);
      }
      function crypto_sign(sm, m, n, sk) {
        var d = new Uint8Array(64), h = new Uint8Array(64), r = new Uint8Array(64);
        var i, j, x = new Float64Array(64);
        var p = [gf(), gf(), gf(), gf()];
        crypto_hash(d, sk, 32);
        d[0] &= 248;
        d[31] &= 127;
        d[31] |= 64;
        var smlen = n + 64;
        for (i = 0; i < n; i++) sm[64 + i] = m[i];
        for (i = 0; i < 32; i++) sm[32 + i] = d[32 + i];
        crypto_hash(r, sm.subarray(32), n + 32);
        reduce(r);
        scalarbase(p, r);
        pack(sm, p);
        for (i = 32; i < 64; i++) sm[i] = sk[i];
        crypto_hash(h, sm, n + 64);
        reduce(h);
        for (i = 0; i < 64; i++) x[i] = 0;
        for (i = 0; i < 32; i++) x[i] = r[i];
        for (i = 0; i < 32; i++) {
          for (j = 0; j < 32; j++) {
            x[i + j] += h[i] * d[j];
          }
        }
        modL(sm.subarray(32), x);
        return smlen;
      }
      function unpackneg(r, p) {
        var t = gf(), chk = gf(), num = gf(), den = gf(), den2 = gf(), den4 = gf(), den6 = gf();
        set25519(r[2], gf1);
        unpack25519(r[1], p);
        S(num, r[1]);
        M(den, num, D);
        Z(num, num, r[2]);
        A(den, r[2], den);
        S(den2, den);
        S(den4, den2);
        M(den6, den4, den2);
        M(t, den6, num);
        M(t, t, den);
        pow2523(t, t);
        M(t, t, num);
        M(t, t, den);
        M(t, t, den);
        M(r[0], t, den);
        S(chk, r[0]);
        M(chk, chk, den);
        if (neq25519(chk, num)) M(r[0], r[0], I);
        S(chk, r[0]);
        M(chk, chk, den);
        if (neq25519(chk, num)) return -1;
        if (par25519(r[0]) === p[31] >> 7) Z(r[0], gf0, r[0]);
        M(r[3], r[0], r[1]);
        return 0;
      }
      function crypto_sign_open(m, sm, n, pk) {
        var i;
        var t = new Uint8Array(32), h = new Uint8Array(64);
        var p = [gf(), gf(), gf(), gf()], q = [gf(), gf(), gf(), gf()];
        if (n < 64) return -1;
        if (unpackneg(q, pk)) return -1;
        for (i = 0; i < n; i++) m[i] = sm[i];
        for (i = 0; i < 32; i++) m[i + 32] = pk[i];
        crypto_hash(h, m, n);
        reduce(h);
        scalarmult(p, q, h);
        scalarbase(q, sm.subarray(32));
        add(p, q);
        pack(t, p);
        n -= 64;
        if (crypto_verify_32(sm, 0, t, 0)) {
          for (i = 0; i < n; i++) m[i] = 0;
          return -1;
        }
        for (i = 0; i < n; i++) m[i] = sm[i + 64];
        return n;
      }
      var crypto_secretbox_KEYBYTES = 32, crypto_secretbox_NONCEBYTES = 24, crypto_secretbox_ZEROBYTES = 32, crypto_secretbox_BOXZEROBYTES = 16, crypto_scalarmult_BYTES = 32, crypto_scalarmult_SCALARBYTES = 32, crypto_box_PUBLICKEYBYTES = 32, crypto_box_SECRETKEYBYTES = 32, crypto_box_BEFORENMBYTES = 32, crypto_box_NONCEBYTES = crypto_secretbox_NONCEBYTES, crypto_box_ZEROBYTES = crypto_secretbox_ZEROBYTES, crypto_box_BOXZEROBYTES = crypto_secretbox_BOXZEROBYTES, crypto_sign_BYTES = 64, crypto_sign_PUBLICKEYBYTES = 32, crypto_sign_SECRETKEYBYTES = 64, crypto_sign_SEEDBYTES = 32, crypto_hash_BYTES = 64;
      nacl.lowlevel = {
        crypto_core_hsalsa20,
        crypto_stream_xor,
        crypto_stream,
        crypto_stream_salsa20_xor,
        crypto_stream_salsa20,
        crypto_onetimeauth,
        crypto_onetimeauth_verify,
        crypto_verify_16,
        crypto_verify_32,
        crypto_secretbox,
        crypto_secretbox_open,
        crypto_scalarmult,
        crypto_scalarmult_base,
        crypto_box_beforenm,
        crypto_box_afternm,
        crypto_box,
        crypto_box_open,
        crypto_box_keypair,
        crypto_hash,
        crypto_sign,
        crypto_sign_keypair,
        crypto_sign_open,
        crypto_secretbox_KEYBYTES,
        crypto_secretbox_NONCEBYTES,
        crypto_secretbox_ZEROBYTES,
        crypto_secretbox_BOXZEROBYTES,
        crypto_scalarmult_BYTES,
        crypto_scalarmult_SCALARBYTES,
        crypto_box_PUBLICKEYBYTES,
        crypto_box_SECRETKEYBYTES,
        crypto_box_BEFORENMBYTES,
        crypto_box_NONCEBYTES,
        crypto_box_ZEROBYTES,
        crypto_box_BOXZEROBYTES,
        crypto_sign_BYTES,
        crypto_sign_PUBLICKEYBYTES,
        crypto_sign_SECRETKEYBYTES,
        crypto_sign_SEEDBYTES,
        crypto_hash_BYTES,
        gf,
        D,
        L,
        pack25519,
        unpack25519,
        M,
        A,
        S,
        Z,
        pow2523,
        add,
        set25519,
        modL,
        scalarmult,
        scalarbase
      };
      function checkLengths(k, n) {
        if (k.length !== crypto_secretbox_KEYBYTES) throw new Error("bad key size");
        if (n.length !== crypto_secretbox_NONCEBYTES) throw new Error("bad nonce size");
      }
      function checkBoxLengths(pk, sk) {
        if (pk.length !== crypto_box_PUBLICKEYBYTES) throw new Error("bad public key size");
        if (sk.length !== crypto_box_SECRETKEYBYTES) throw new Error("bad secret key size");
      }
      function checkArrayTypes() {
        for (var i = 0; i < arguments.length; i++) {
          if (!(arguments[i] instanceof Uint8Array))
            throw new TypeError("unexpected type, use Uint8Array");
        }
      }
      function cleanup(arr) {
        for (var i = 0; i < arr.length; i++) arr[i] = 0;
      }
      nacl.randomBytes = function(n) {
        var b = new Uint8Array(n);
        randombytes(b, n);
        return b;
      };
      nacl.secretbox = function(msg, nonce, key) {
        checkArrayTypes(msg, nonce, key);
        checkLengths(key, nonce);
        var m = new Uint8Array(crypto_secretbox_ZEROBYTES + msg.length);
        var c = new Uint8Array(m.length);
        for (var i = 0; i < msg.length; i++) m[i + crypto_secretbox_ZEROBYTES] = msg[i];
        crypto_secretbox(c, m, m.length, nonce, key);
        return c.subarray(crypto_secretbox_BOXZEROBYTES);
      };
      nacl.secretbox.open = function(box, nonce, key) {
        checkArrayTypes(box, nonce, key);
        checkLengths(key, nonce);
        var c = new Uint8Array(crypto_secretbox_BOXZEROBYTES + box.length);
        var m = new Uint8Array(c.length);
        for (var i = 0; i < box.length; i++) c[i + crypto_secretbox_BOXZEROBYTES] = box[i];
        if (c.length < 32) return null;
        if (crypto_secretbox_open(m, c, c.length, nonce, key) !== 0) return null;
        return m.subarray(crypto_secretbox_ZEROBYTES);
      };
      nacl.secretbox.keyLength = crypto_secretbox_KEYBYTES;
      nacl.secretbox.nonceLength = crypto_secretbox_NONCEBYTES;
      nacl.secretbox.overheadLength = crypto_secretbox_BOXZEROBYTES;
      nacl.scalarMult = function(n, p) {
        checkArrayTypes(n, p);
        if (n.length !== crypto_scalarmult_SCALARBYTES) throw new Error("bad n size");
        if (p.length !== crypto_scalarmult_BYTES) throw new Error("bad p size");
        var q = new Uint8Array(crypto_scalarmult_BYTES);
        crypto_scalarmult(q, n, p);
        return q;
      };
      nacl.scalarMult.base = function(n) {
        checkArrayTypes(n);
        if (n.length !== crypto_scalarmult_SCALARBYTES) throw new Error("bad n size");
        var q = new Uint8Array(crypto_scalarmult_BYTES);
        crypto_scalarmult_base(q, n);
        return q;
      };
      nacl.scalarMult.scalarLength = crypto_scalarmult_SCALARBYTES;
      nacl.scalarMult.groupElementLength = crypto_scalarmult_BYTES;
      nacl.box = function(msg, nonce, publicKey, secretKey) {
        var k = nacl.box.before(publicKey, secretKey);
        return nacl.secretbox(msg, nonce, k);
      };
      nacl.box.before = function(publicKey, secretKey) {
        checkArrayTypes(publicKey, secretKey);
        checkBoxLengths(publicKey, secretKey);
        var k = new Uint8Array(crypto_box_BEFORENMBYTES);
        crypto_box_beforenm(k, publicKey, secretKey);
        return k;
      };
      nacl.box.after = nacl.secretbox;
      nacl.box.open = function(msg, nonce, publicKey, secretKey) {
        var k = nacl.box.before(publicKey, secretKey);
        return nacl.secretbox.open(msg, nonce, k);
      };
      nacl.box.open.after = nacl.secretbox.open;
      nacl.box.keyPair = function() {
        var pk = new Uint8Array(crypto_box_PUBLICKEYBYTES);
        var sk = new Uint8Array(crypto_box_SECRETKEYBYTES);
        crypto_box_keypair(pk, sk);
        return { publicKey: pk, secretKey: sk };
      };
      nacl.box.keyPair.fromSecretKey = function(secretKey) {
        checkArrayTypes(secretKey);
        if (secretKey.length !== crypto_box_SECRETKEYBYTES)
          throw new Error("bad secret key size");
        var pk = new Uint8Array(crypto_box_PUBLICKEYBYTES);
        crypto_scalarmult_base(pk, secretKey);
        return { publicKey: pk, secretKey: new Uint8Array(secretKey) };
      };
      nacl.box.publicKeyLength = crypto_box_PUBLICKEYBYTES;
      nacl.box.secretKeyLength = crypto_box_SECRETKEYBYTES;
      nacl.box.sharedKeyLength = crypto_box_BEFORENMBYTES;
      nacl.box.nonceLength = crypto_box_NONCEBYTES;
      nacl.box.overheadLength = nacl.secretbox.overheadLength;
      nacl.sign = function(msg, secretKey) {
        checkArrayTypes(msg, secretKey);
        if (secretKey.length !== crypto_sign_SECRETKEYBYTES)
          throw new Error("bad secret key size");
        var signedMsg = new Uint8Array(crypto_sign_BYTES + msg.length);
        crypto_sign(signedMsg, msg, msg.length, secretKey);
        return signedMsg;
      };
      nacl.sign.open = function(signedMsg, publicKey) {
        checkArrayTypes(signedMsg, publicKey);
        if (publicKey.length !== crypto_sign_PUBLICKEYBYTES)
          throw new Error("bad public key size");
        var tmp = new Uint8Array(signedMsg.length);
        var mlen = crypto_sign_open(tmp, signedMsg, signedMsg.length, publicKey);
        if (mlen < 0) return null;
        var m = new Uint8Array(mlen);
        for (var i = 0; i < m.length; i++) m[i] = tmp[i];
        return m;
      };
      nacl.sign.detached = function(msg, secretKey) {
        var signedMsg = nacl.sign(msg, secretKey);
        var sig = new Uint8Array(crypto_sign_BYTES);
        for (var i = 0; i < sig.length; i++) sig[i] = signedMsg[i];
        return sig;
      };
      nacl.sign.detached.verify = function(msg, sig, publicKey) {
        checkArrayTypes(msg, sig, publicKey);
        if (sig.length !== crypto_sign_BYTES)
          throw new Error("bad signature size");
        if (publicKey.length !== crypto_sign_PUBLICKEYBYTES)
          throw new Error("bad public key size");
        var sm = new Uint8Array(crypto_sign_BYTES + msg.length);
        var m = new Uint8Array(crypto_sign_BYTES + msg.length);
        var i;
        for (i = 0; i < crypto_sign_BYTES; i++) sm[i] = sig[i];
        for (i = 0; i < msg.length; i++) sm[i + crypto_sign_BYTES] = msg[i];
        return crypto_sign_open(m, sm, sm.length, publicKey) >= 0;
      };
      nacl.sign.keyPair = function() {
        var pk = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
        var sk = new Uint8Array(crypto_sign_SECRETKEYBYTES);
        crypto_sign_keypair(pk, sk);
        return { publicKey: pk, secretKey: sk };
      };
      nacl.sign.keyPair.fromSecretKey = function(secretKey) {
        checkArrayTypes(secretKey);
        if (secretKey.length !== crypto_sign_SECRETKEYBYTES)
          throw new Error("bad secret key size");
        var pk = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
        for (var i = 0; i < pk.length; i++) pk[i] = secretKey[32 + i];
        return { publicKey: pk, secretKey: new Uint8Array(secretKey) };
      };
      nacl.sign.keyPair.fromSeed = function(seed) {
        checkArrayTypes(seed);
        if (seed.length !== crypto_sign_SEEDBYTES)
          throw new Error("bad seed size");
        var pk = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
        var sk = new Uint8Array(crypto_sign_SECRETKEYBYTES);
        for (var i = 0; i < 32; i++) sk[i] = seed[i];
        crypto_sign_keypair(pk, sk, true);
        return { publicKey: pk, secretKey: sk };
      };
      nacl.sign.publicKeyLength = crypto_sign_PUBLICKEYBYTES;
      nacl.sign.secretKeyLength = crypto_sign_SECRETKEYBYTES;
      nacl.sign.seedLength = crypto_sign_SEEDBYTES;
      nacl.sign.signatureLength = crypto_sign_BYTES;
      nacl.hash = function(msg) {
        checkArrayTypes(msg);
        var h = new Uint8Array(crypto_hash_BYTES);
        crypto_hash(h, msg, msg.length);
        return h;
      };
      nacl.hash.hashLength = crypto_hash_BYTES;
      nacl.verify = function(x, y) {
        checkArrayTypes(x, y);
        if (x.length === 0 || y.length === 0) return false;
        if (x.length !== y.length) return false;
        return vn(x, 0, y, 0, x.length) === 0 ? true : false;
      };
      nacl.setPRNG = function(fn) {
        randombytes = fn;
      };
      (function() {
        var crypto2 = typeof self !== "undefined" ? self.crypto || self.msCrypto : null;
        if (crypto2 && crypto2.getRandomValues) {
          var QUOTA = 65536;
          nacl.setPRNG(function(x, n) {
            var i, v = new Uint8Array(n);
            for (i = 0; i < n; i += QUOTA) {
              crypto2.getRandomValues(v.subarray(i, i + Math.min(n - i, QUOTA)));
            }
            for (i = 0; i < n; i++) x[i] = v[i];
            cleanup(v);
          });
        } else if (typeof __require !== "undefined") {
          crypto2 = require_crypto();
          if (crypto2 && crypto2.randomBytes) {
            nacl.setPRNG(function(x, n) {
              var i, v = crypto2.randomBytes(n);
              for (i = 0; i < n; i++) x[i] = v[i];
              cleanup(v);
            });
          }
        }
      })();
    })(typeof module !== "undefined" && module.exports ? module.exports : self.nacl = self.nacl || {});
  }
});

// node_modules/@ton/crypto/dist/utils/binary.js
var require_binary = __commonJS({
  "node_modules/@ton/crypto/dist/utils/binary.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.bitsToBytes = exports.bytesToBits = exports.lpad = void 0;
    function lpad(str, padString, length) {
      while (str.length < length) {
        str = padString + str;
      }
      return str;
    }
    exports.lpad = lpad;
    function bytesToBits(bytes) {
      let res = "";
      for (let i = 0; i < bytes.length; i++) {
        let x = bytes.at(i);
        res += lpad(x.toString(2), "0", 8);
      }
      return res;
    }
    exports.bytesToBits = bytesToBits;
    function bitsToBytes(src) {
      if (src.length % 8 !== 0) {
        throw Error("Uneven bits");
      }
      let res = [];
      while (src.length > 0) {
        res.push(parseInt(src.slice(0, 8), 2));
        src = src.slice(8);
      }
      return Buffer.from(res);
    }
    exports.bitsToBytes = bitsToBytes;
  }
});

// node_modules/@ton/crypto/dist/mnemonic/wordlist.js
var require_wordlist2 = __commonJS({
  "node_modules/@ton/crypto/dist/mnemonic/wordlist.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.wordlist = void 0;
    var EN = [
      "abandon",
      "ability",
      "able",
      "about",
      "above",
      "absent",
      "absorb",
      "abstract",
      "absurd",
      "abuse",
      "access",
      "accident",
      "account",
      "accuse",
      "achieve",
      "acid",
      "acoustic",
      "acquire",
      "across",
      "act",
      "action",
      "actor",
      "actress",
      "actual",
      "adapt",
      "add",
      "addict",
      "address",
      "adjust",
      "admit",
      "adult",
      "advance",
      "advice",
      "aerobic",
      "affair",
      "afford",
      "afraid",
      "again",
      "age",
      "agent",
      "agree",
      "ahead",
      "aim",
      "air",
      "airport",
      "aisle",
      "alarm",
      "album",
      "alcohol",
      "alert",
      "alien",
      "all",
      "alley",
      "allow",
      "almost",
      "alone",
      "alpha",
      "already",
      "also",
      "alter",
      "always",
      "amateur",
      "amazing",
      "among",
      "amount",
      "amused",
      "analyst",
      "anchor",
      "ancient",
      "anger",
      "angle",
      "angry",
      "animal",
      "ankle",
      "announce",
      "annual",
      "another",
      "answer",
      "antenna",
      "antique",
      "anxiety",
      "any",
      "apart",
      "apology",
      "appear",
      "apple",
      "approve",
      "april",
      "arch",
      "arctic",
      "area",
      "arena",
      "argue",
      "arm",
      "armed",
      "armor",
      "army",
      "around",
      "arrange",
      "arrest",
      "arrive",
      "arrow",
      "art",
      "artefact",
      "artist",
      "artwork",
      "ask",
      "aspect",
      "assault",
      "asset",
      "assist",
      "assume",
      "asthma",
      "athlete",
      "atom",
      "attack",
      "attend",
      "attitude",
      "attract",
      "auction",
      "audit",
      "august",
      "aunt",
      "author",
      "auto",
      "autumn",
      "average",
      "avocado",
      "avoid",
      "awake",
      "aware",
      "away",
      "awesome",
      "awful",
      "awkward",
      "axis",
      "baby",
      "bachelor",
      "bacon",
      "badge",
      "bag",
      "balance",
      "balcony",
      "ball",
      "bamboo",
      "banana",
      "banner",
      "bar",
      "barely",
      "bargain",
      "barrel",
      "base",
      "basic",
      "basket",
      "battle",
      "beach",
      "bean",
      "beauty",
      "because",
      "become",
      "beef",
      "before",
      "begin",
      "behave",
      "behind",
      "believe",
      "below",
      "belt",
      "bench",
      "benefit",
      "best",
      "betray",
      "better",
      "between",
      "beyond",
      "bicycle",
      "bid",
      "bike",
      "bind",
      "biology",
      "bird",
      "birth",
      "bitter",
      "black",
      "blade",
      "blame",
      "blanket",
      "blast",
      "bleak",
      "bless",
      "blind",
      "blood",
      "blossom",
      "blouse",
      "blue",
      "blur",
      "blush",
      "board",
      "boat",
      "body",
      "boil",
      "bomb",
      "bone",
      "bonus",
      "book",
      "boost",
      "border",
      "boring",
      "borrow",
      "boss",
      "bottom",
      "bounce",
      "box",
      "boy",
      "bracket",
      "brain",
      "brand",
      "brass",
      "brave",
      "bread",
      "breeze",
      "brick",
      "bridge",
      "brief",
      "bright",
      "bring",
      "brisk",
      "broccoli",
      "broken",
      "bronze",
      "broom",
      "brother",
      "brown",
      "brush",
      "bubble",
      "buddy",
      "budget",
      "buffalo",
      "build",
      "bulb",
      "bulk",
      "bullet",
      "bundle",
      "bunker",
      "burden",
      "burger",
      "burst",
      "bus",
      "business",
      "busy",
      "butter",
      "buyer",
      "buzz",
      "cabbage",
      "cabin",
      "cable",
      "cactus",
      "cage",
      "cake",
      "call",
      "calm",
      "camera",
      "camp",
      "can",
      "canal",
      "cancel",
      "candy",
      "cannon",
      "canoe",
      "canvas",
      "canyon",
      "capable",
      "capital",
      "captain",
      "car",
      "carbon",
      "card",
      "cargo",
      "carpet",
      "carry",
      "cart",
      "case",
      "cash",
      "casino",
      "castle",
      "casual",
      "cat",
      "catalog",
      "catch",
      "category",
      "cattle",
      "caught",
      "cause",
      "caution",
      "cave",
      "ceiling",
      "celery",
      "cement",
      "census",
      "century",
      "cereal",
      "certain",
      "chair",
      "chalk",
      "champion",
      "change",
      "chaos",
      "chapter",
      "charge",
      "chase",
      "chat",
      "cheap",
      "check",
      "cheese",
      "chef",
      "cherry",
      "chest",
      "chicken",
      "chief",
      "child",
      "chimney",
      "choice",
      "choose",
      "chronic",
      "chuckle",
      "chunk",
      "churn",
      "cigar",
      "cinnamon",
      "circle",
      "citizen",
      "city",
      "civil",
      "claim",
      "clap",
      "clarify",
      "claw",
      "clay",
      "clean",
      "clerk",
      "clever",
      "click",
      "client",
      "cliff",
      "climb",
      "clinic",
      "clip",
      "clock",
      "clog",
      "close",
      "cloth",
      "cloud",
      "clown",
      "club",
      "clump",
      "cluster",
      "clutch",
      "coach",
      "coast",
      "coconut",
      "code",
      "coffee",
      "coil",
      "coin",
      "collect",
      "color",
      "column",
      "combine",
      "come",
      "comfort",
      "comic",
      "common",
      "company",
      "concert",
      "conduct",
      "confirm",
      "congress",
      "connect",
      "consider",
      "control",
      "convince",
      "cook",
      "cool",
      "copper",
      "copy",
      "coral",
      "core",
      "corn",
      "correct",
      "cost",
      "cotton",
      "couch",
      "country",
      "couple",
      "course",
      "cousin",
      "cover",
      "coyote",
      "crack",
      "cradle",
      "craft",
      "cram",
      "crane",
      "crash",
      "crater",
      "crawl",
      "crazy",
      "cream",
      "credit",
      "creek",
      "crew",
      "cricket",
      "crime",
      "crisp",
      "critic",
      "crop",
      "cross",
      "crouch",
      "crowd",
      "crucial",
      "cruel",
      "cruise",
      "crumble",
      "crunch",
      "crush",
      "cry",
      "crystal",
      "cube",
      "culture",
      "cup",
      "cupboard",
      "curious",
      "current",
      "curtain",
      "curve",
      "cushion",
      "custom",
      "cute",
      "cycle",
      "dad",
      "damage",
      "damp",
      "dance",
      "danger",
      "daring",
      "dash",
      "daughter",
      "dawn",
      "day",
      "deal",
      "debate",
      "debris",
      "decade",
      "december",
      "decide",
      "decline",
      "decorate",
      "decrease",
      "deer",
      "defense",
      "define",
      "defy",
      "degree",
      "delay",
      "deliver",
      "demand",
      "demise",
      "denial",
      "dentist",
      "deny",
      "depart",
      "depend",
      "deposit",
      "depth",
      "deputy",
      "derive",
      "describe",
      "desert",
      "design",
      "desk",
      "despair",
      "destroy",
      "detail",
      "detect",
      "develop",
      "device",
      "devote",
      "diagram",
      "dial",
      "diamond",
      "diary",
      "dice",
      "diesel",
      "diet",
      "differ",
      "digital",
      "dignity",
      "dilemma",
      "dinner",
      "dinosaur",
      "direct",
      "dirt",
      "disagree",
      "discover",
      "disease",
      "dish",
      "dismiss",
      "disorder",
      "display",
      "distance",
      "divert",
      "divide",
      "divorce",
      "dizzy",
      "doctor",
      "document",
      "dog",
      "doll",
      "dolphin",
      "domain",
      "donate",
      "donkey",
      "donor",
      "door",
      "dose",
      "double",
      "dove",
      "draft",
      "dragon",
      "drama",
      "drastic",
      "draw",
      "dream",
      "dress",
      "drift",
      "drill",
      "drink",
      "drip",
      "drive",
      "drop",
      "drum",
      "dry",
      "duck",
      "dumb",
      "dune",
      "during",
      "dust",
      "dutch",
      "duty",
      "dwarf",
      "dynamic",
      "eager",
      "eagle",
      "early",
      "earn",
      "earth",
      "easily",
      "east",
      "easy",
      "echo",
      "ecology",
      "economy",
      "edge",
      "edit",
      "educate",
      "effort",
      "egg",
      "eight",
      "either",
      "elbow",
      "elder",
      "electric",
      "elegant",
      "element",
      "elephant",
      "elevator",
      "elite",
      "else",
      "embark",
      "embody",
      "embrace",
      "emerge",
      "emotion",
      "employ",
      "empower",
      "empty",
      "enable",
      "enact",
      "end",
      "endless",
      "endorse",
      "enemy",
      "energy",
      "enforce",
      "engage",
      "engine",
      "enhance",
      "enjoy",
      "enlist",
      "enough",
      "enrich",
      "enroll",
      "ensure",
      "enter",
      "entire",
      "entry",
      "envelope",
      "episode",
      "equal",
      "equip",
      "era",
      "erase",
      "erode",
      "erosion",
      "error",
      "erupt",
      "escape",
      "essay",
      "essence",
      "estate",
      "eternal",
      "ethics",
      "evidence",
      "evil",
      "evoke",
      "evolve",
      "exact",
      "example",
      "excess",
      "exchange",
      "excite",
      "exclude",
      "excuse",
      "execute",
      "exercise",
      "exhaust",
      "exhibit",
      "exile",
      "exist",
      "exit",
      "exotic",
      "expand",
      "expect",
      "expire",
      "explain",
      "expose",
      "express",
      "extend",
      "extra",
      "eye",
      "eyebrow",
      "fabric",
      "face",
      "faculty",
      "fade",
      "faint",
      "faith",
      "fall",
      "false",
      "fame",
      "family",
      "famous",
      "fan",
      "fancy",
      "fantasy",
      "farm",
      "fashion",
      "fat",
      "fatal",
      "father",
      "fatigue",
      "fault",
      "favorite",
      "feature",
      "february",
      "federal",
      "fee",
      "feed",
      "feel",
      "female",
      "fence",
      "festival",
      "fetch",
      "fever",
      "few",
      "fiber",
      "fiction",
      "field",
      "figure",
      "file",
      "film",
      "filter",
      "final",
      "find",
      "fine",
      "finger",
      "finish",
      "fire",
      "firm",
      "first",
      "fiscal",
      "fish",
      "fit",
      "fitness",
      "fix",
      "flag",
      "flame",
      "flash",
      "flat",
      "flavor",
      "flee",
      "flight",
      "flip",
      "float",
      "flock",
      "floor",
      "flower",
      "fluid",
      "flush",
      "fly",
      "foam",
      "focus",
      "fog",
      "foil",
      "fold",
      "follow",
      "food",
      "foot",
      "force",
      "forest",
      "forget",
      "fork",
      "fortune",
      "forum",
      "forward",
      "fossil",
      "foster",
      "found",
      "fox",
      "fragile",
      "frame",
      "frequent",
      "fresh",
      "friend",
      "fringe",
      "frog",
      "front",
      "frost",
      "frown",
      "frozen",
      "fruit",
      "fuel",
      "fun",
      "funny",
      "furnace",
      "fury",
      "future",
      "gadget",
      "gain",
      "galaxy",
      "gallery",
      "game",
      "gap",
      "garage",
      "garbage",
      "garden",
      "garlic",
      "garment",
      "gas",
      "gasp",
      "gate",
      "gather",
      "gauge",
      "gaze",
      "general",
      "genius",
      "genre",
      "gentle",
      "genuine",
      "gesture",
      "ghost",
      "giant",
      "gift",
      "giggle",
      "ginger",
      "giraffe",
      "girl",
      "give",
      "glad",
      "glance",
      "glare",
      "glass",
      "glide",
      "glimpse",
      "globe",
      "gloom",
      "glory",
      "glove",
      "glow",
      "glue",
      "goat",
      "goddess",
      "gold",
      "good",
      "goose",
      "gorilla",
      "gospel",
      "gossip",
      "govern",
      "gown",
      "grab",
      "grace",
      "grain",
      "grant",
      "grape",
      "grass",
      "gravity",
      "great",
      "green",
      "grid",
      "grief",
      "grit",
      "grocery",
      "group",
      "grow",
      "grunt",
      "guard",
      "guess",
      "guide",
      "guilt",
      "guitar",
      "gun",
      "gym",
      "habit",
      "hair",
      "half",
      "hammer",
      "hamster",
      "hand",
      "happy",
      "harbor",
      "hard",
      "harsh",
      "harvest",
      "hat",
      "have",
      "hawk",
      "hazard",
      "head",
      "health",
      "heart",
      "heavy",
      "hedgehog",
      "height",
      "hello",
      "helmet",
      "help",
      "hen",
      "hero",
      "hidden",
      "high",
      "hill",
      "hint",
      "hip",
      "hire",
      "history",
      "hobby",
      "hockey",
      "hold",
      "hole",
      "holiday",
      "hollow",
      "home",
      "honey",
      "hood",
      "hope",
      "horn",
      "horror",
      "horse",
      "hospital",
      "host",
      "hotel",
      "hour",
      "hover",
      "hub",
      "huge",
      "human",
      "humble",
      "humor",
      "hundred",
      "hungry",
      "hunt",
      "hurdle",
      "hurry",
      "hurt",
      "husband",
      "hybrid",
      "ice",
      "icon",
      "idea",
      "identify",
      "idle",
      "ignore",
      "ill",
      "illegal",
      "illness",
      "image",
      "imitate",
      "immense",
      "immune",
      "impact",
      "impose",
      "improve",
      "impulse",
      "inch",
      "include",
      "income",
      "increase",
      "index",
      "indicate",
      "indoor",
      "industry",
      "infant",
      "inflict",
      "inform",
      "inhale",
      "inherit",
      "initial",
      "inject",
      "injury",
      "inmate",
      "inner",
      "innocent",
      "input",
      "inquiry",
      "insane",
      "insect",
      "inside",
      "inspire",
      "install",
      "intact",
      "interest",
      "into",
      "invest",
      "invite",
      "involve",
      "iron",
      "island",
      "isolate",
      "issue",
      "item",
      "ivory",
      "jacket",
      "jaguar",
      "jar",
      "jazz",
      "jealous",
      "jeans",
      "jelly",
      "jewel",
      "job",
      "join",
      "joke",
      "journey",
      "joy",
      "judge",
      "juice",
      "jump",
      "jungle",
      "junior",
      "junk",
      "just",
      "kangaroo",
      "keen",
      "keep",
      "ketchup",
      "key",
      "kick",
      "kid",
      "kidney",
      "kind",
      "kingdom",
      "kiss",
      "kit",
      "kitchen",
      "kite",
      "kitten",
      "kiwi",
      "knee",
      "knife",
      "knock",
      "know",
      "lab",
      "label",
      "labor",
      "ladder",
      "lady",
      "lake",
      "lamp",
      "language",
      "laptop",
      "large",
      "later",
      "latin",
      "laugh",
      "laundry",
      "lava",
      "law",
      "lawn",
      "lawsuit",
      "layer",
      "lazy",
      "leader",
      "leaf",
      "learn",
      "leave",
      "lecture",
      "left",
      "leg",
      "legal",
      "legend",
      "leisure",
      "lemon",
      "lend",
      "length",
      "lens",
      "leopard",
      "lesson",
      "letter",
      "level",
      "liar",
      "liberty",
      "library",
      "license",
      "life",
      "lift",
      "light",
      "like",
      "limb",
      "limit",
      "link",
      "lion",
      "liquid",
      "list",
      "little",
      "live",
      "lizard",
      "load",
      "loan",
      "lobster",
      "local",
      "lock",
      "logic",
      "lonely",
      "long",
      "loop",
      "lottery",
      "loud",
      "lounge",
      "love",
      "loyal",
      "lucky",
      "luggage",
      "lumber",
      "lunar",
      "lunch",
      "luxury",
      "lyrics",
      "machine",
      "mad",
      "magic",
      "magnet",
      "maid",
      "mail",
      "main",
      "major",
      "make",
      "mammal",
      "man",
      "manage",
      "mandate",
      "mango",
      "mansion",
      "manual",
      "maple",
      "marble",
      "march",
      "margin",
      "marine",
      "market",
      "marriage",
      "mask",
      "mass",
      "master",
      "match",
      "material",
      "math",
      "matrix",
      "matter",
      "maximum",
      "maze",
      "meadow",
      "mean",
      "measure",
      "meat",
      "mechanic",
      "medal",
      "media",
      "melody",
      "melt",
      "member",
      "memory",
      "mention",
      "menu",
      "mercy",
      "merge",
      "merit",
      "merry",
      "mesh",
      "message",
      "metal",
      "method",
      "middle",
      "midnight",
      "milk",
      "million",
      "mimic",
      "mind",
      "minimum",
      "minor",
      "minute",
      "miracle",
      "mirror",
      "misery",
      "miss",
      "mistake",
      "mix",
      "mixed",
      "mixture",
      "mobile",
      "model",
      "modify",
      "mom",
      "moment",
      "monitor",
      "monkey",
      "monster",
      "month",
      "moon",
      "moral",
      "more",
      "morning",
      "mosquito",
      "mother",
      "motion",
      "motor",
      "mountain",
      "mouse",
      "move",
      "movie",
      "much",
      "muffin",
      "mule",
      "multiply",
      "muscle",
      "museum",
      "mushroom",
      "music",
      "must",
      "mutual",
      "myself",
      "mystery",
      "myth",
      "naive",
      "name",
      "napkin",
      "narrow",
      "nasty",
      "nation",
      "nature",
      "near",
      "neck",
      "need",
      "negative",
      "neglect",
      "neither",
      "nephew",
      "nerve",
      "nest",
      "net",
      "network",
      "neutral",
      "never",
      "news",
      "next",
      "nice",
      "night",
      "noble",
      "noise",
      "nominee",
      "noodle",
      "normal",
      "north",
      "nose",
      "notable",
      "note",
      "nothing",
      "notice",
      "novel",
      "now",
      "nuclear",
      "number",
      "nurse",
      "nut",
      "oak",
      "obey",
      "object",
      "oblige",
      "obscure",
      "observe",
      "obtain",
      "obvious",
      "occur",
      "ocean",
      "october",
      "odor",
      "off",
      "offer",
      "office",
      "often",
      "oil",
      "okay",
      "old",
      "olive",
      "olympic",
      "omit",
      "once",
      "one",
      "onion",
      "online",
      "only",
      "open",
      "opera",
      "opinion",
      "oppose",
      "option",
      "orange",
      "orbit",
      "orchard",
      "order",
      "ordinary",
      "organ",
      "orient",
      "original",
      "orphan",
      "ostrich",
      "other",
      "outdoor",
      "outer",
      "output",
      "outside",
      "oval",
      "oven",
      "over",
      "own",
      "owner",
      "oxygen",
      "oyster",
      "ozone",
      "pact",
      "paddle",
      "page",
      "pair",
      "palace",
      "palm",
      "panda",
      "panel",
      "panic",
      "panther",
      "paper",
      "parade",
      "parent",
      "park",
      "parrot",
      "party",
      "pass",
      "patch",
      "path",
      "patient",
      "patrol",
      "pattern",
      "pause",
      "pave",
      "payment",
      "peace",
      "peanut",
      "pear",
      "peasant",
      "pelican",
      "pen",
      "penalty",
      "pencil",
      "people",
      "pepper",
      "perfect",
      "permit",
      "person",
      "pet",
      "phone",
      "photo",
      "phrase",
      "physical",
      "piano",
      "picnic",
      "picture",
      "piece",
      "pig",
      "pigeon",
      "pill",
      "pilot",
      "pink",
      "pioneer",
      "pipe",
      "pistol",
      "pitch",
      "pizza",
      "place",
      "planet",
      "plastic",
      "plate",
      "play",
      "please",
      "pledge",
      "pluck",
      "plug",
      "plunge",
      "poem",
      "poet",
      "point",
      "polar",
      "pole",
      "police",
      "pond",
      "pony",
      "pool",
      "popular",
      "portion",
      "position",
      "possible",
      "post",
      "potato",
      "pottery",
      "poverty",
      "powder",
      "power",
      "practice",
      "praise",
      "predict",
      "prefer",
      "prepare",
      "present",
      "pretty",
      "prevent",
      "price",
      "pride",
      "primary",
      "print",
      "priority",
      "prison",
      "private",
      "prize",
      "problem",
      "process",
      "produce",
      "profit",
      "program",
      "project",
      "promote",
      "proof",
      "property",
      "prosper",
      "protect",
      "proud",
      "provide",
      "public",
      "pudding",
      "pull",
      "pulp",
      "pulse",
      "pumpkin",
      "punch",
      "pupil",
      "puppy",
      "purchase",
      "purity",
      "purpose",
      "purse",
      "push",
      "put",
      "puzzle",
      "pyramid",
      "quality",
      "quantum",
      "quarter",
      "question",
      "quick",
      "quit",
      "quiz",
      "quote",
      "rabbit",
      "raccoon",
      "race",
      "rack",
      "radar",
      "radio",
      "rail",
      "rain",
      "raise",
      "rally",
      "ramp",
      "ranch",
      "random",
      "range",
      "rapid",
      "rare",
      "rate",
      "rather",
      "raven",
      "raw",
      "razor",
      "ready",
      "real",
      "reason",
      "rebel",
      "rebuild",
      "recall",
      "receive",
      "recipe",
      "record",
      "recycle",
      "reduce",
      "reflect",
      "reform",
      "refuse",
      "region",
      "regret",
      "regular",
      "reject",
      "relax",
      "release",
      "relief",
      "rely",
      "remain",
      "remember",
      "remind",
      "remove",
      "render",
      "renew",
      "rent",
      "reopen",
      "repair",
      "repeat",
      "replace",
      "report",
      "require",
      "rescue",
      "resemble",
      "resist",
      "resource",
      "response",
      "result",
      "retire",
      "retreat",
      "return",
      "reunion",
      "reveal",
      "review",
      "reward",
      "rhythm",
      "rib",
      "ribbon",
      "rice",
      "rich",
      "ride",
      "ridge",
      "rifle",
      "right",
      "rigid",
      "ring",
      "riot",
      "ripple",
      "risk",
      "ritual",
      "rival",
      "river",
      "road",
      "roast",
      "robot",
      "robust",
      "rocket",
      "romance",
      "roof",
      "rookie",
      "room",
      "rose",
      "rotate",
      "rough",
      "round",
      "route",
      "royal",
      "rubber",
      "rude",
      "rug",
      "rule",
      "run",
      "runway",
      "rural",
      "sad",
      "saddle",
      "sadness",
      "safe",
      "sail",
      "salad",
      "salmon",
      "salon",
      "salt",
      "salute",
      "same",
      "sample",
      "sand",
      "satisfy",
      "satoshi",
      "sauce",
      "sausage",
      "save",
      "say",
      "scale",
      "scan",
      "scare",
      "scatter",
      "scene",
      "scheme",
      "school",
      "science",
      "scissors",
      "scorpion",
      "scout",
      "scrap",
      "screen",
      "script",
      "scrub",
      "sea",
      "search",
      "season",
      "seat",
      "second",
      "secret",
      "section",
      "security",
      "seed",
      "seek",
      "segment",
      "select",
      "sell",
      "seminar",
      "senior",
      "sense",
      "sentence",
      "series",
      "service",
      "session",
      "settle",
      "setup",
      "seven",
      "shadow",
      "shaft",
      "shallow",
      "share",
      "shed",
      "shell",
      "sheriff",
      "shield",
      "shift",
      "shine",
      "ship",
      "shiver",
      "shock",
      "shoe",
      "shoot",
      "shop",
      "short",
      "shoulder",
      "shove",
      "shrimp",
      "shrug",
      "shuffle",
      "shy",
      "sibling",
      "sick",
      "side",
      "siege",
      "sight",
      "sign",
      "silent",
      "silk",
      "silly",
      "silver",
      "similar",
      "simple",
      "since",
      "sing",
      "siren",
      "sister",
      "situate",
      "six",
      "size",
      "skate",
      "sketch",
      "ski",
      "skill",
      "skin",
      "skirt",
      "skull",
      "slab",
      "slam",
      "sleep",
      "slender",
      "slice",
      "slide",
      "slight",
      "slim",
      "slogan",
      "slot",
      "slow",
      "slush",
      "small",
      "smart",
      "smile",
      "smoke",
      "smooth",
      "snack",
      "snake",
      "snap",
      "sniff",
      "snow",
      "soap",
      "soccer",
      "social",
      "sock",
      "soda",
      "soft",
      "solar",
      "soldier",
      "solid",
      "solution",
      "solve",
      "someone",
      "song",
      "soon",
      "sorry",
      "sort",
      "soul",
      "sound",
      "soup",
      "source",
      "south",
      "space",
      "spare",
      "spatial",
      "spawn",
      "speak",
      "special",
      "speed",
      "spell",
      "spend",
      "sphere",
      "spice",
      "spider",
      "spike",
      "spin",
      "spirit",
      "split",
      "spoil",
      "sponsor",
      "spoon",
      "sport",
      "spot",
      "spray",
      "spread",
      "spring",
      "spy",
      "square",
      "squeeze",
      "squirrel",
      "stable",
      "stadium",
      "staff",
      "stage",
      "stairs",
      "stamp",
      "stand",
      "start",
      "state",
      "stay",
      "steak",
      "steel",
      "stem",
      "step",
      "stereo",
      "stick",
      "still",
      "sting",
      "stock",
      "stomach",
      "stone",
      "stool",
      "story",
      "stove",
      "strategy",
      "street",
      "strike",
      "strong",
      "struggle",
      "student",
      "stuff",
      "stumble",
      "style",
      "subject",
      "submit",
      "subway",
      "success",
      "such",
      "sudden",
      "suffer",
      "sugar",
      "suggest",
      "suit",
      "summer",
      "sun",
      "sunny",
      "sunset",
      "super",
      "supply",
      "supreme",
      "sure",
      "surface",
      "surge",
      "surprise",
      "surround",
      "survey",
      "suspect",
      "sustain",
      "swallow",
      "swamp",
      "swap",
      "swarm",
      "swear",
      "sweet",
      "swift",
      "swim",
      "swing",
      "switch",
      "sword",
      "symbol",
      "symptom",
      "syrup",
      "system",
      "table",
      "tackle",
      "tag",
      "tail",
      "talent",
      "talk",
      "tank",
      "tape",
      "target",
      "task",
      "taste",
      "tattoo",
      "taxi",
      "teach",
      "team",
      "tell",
      "ten",
      "tenant",
      "tennis",
      "tent",
      "term",
      "test",
      "text",
      "thank",
      "that",
      "theme",
      "then",
      "theory",
      "there",
      "they",
      "thing",
      "this",
      "thought",
      "three",
      "thrive",
      "throw",
      "thumb",
      "thunder",
      "ticket",
      "tide",
      "tiger",
      "tilt",
      "timber",
      "time",
      "tiny",
      "tip",
      "tired",
      "tissue",
      "title",
      "toast",
      "tobacco",
      "today",
      "toddler",
      "toe",
      "together",
      "toilet",
      "token",
      "tomato",
      "tomorrow",
      "tone",
      "tongue",
      "tonight",
      "tool",
      "tooth",
      "top",
      "topic",
      "topple",
      "torch",
      "tornado",
      "tortoise",
      "toss",
      "total",
      "tourist",
      "toward",
      "tower",
      "town",
      "toy",
      "track",
      "trade",
      "traffic",
      "tragic",
      "train",
      "transfer",
      "trap",
      "trash",
      "travel",
      "tray",
      "treat",
      "tree",
      "trend",
      "trial",
      "tribe",
      "trick",
      "trigger",
      "trim",
      "trip",
      "trophy",
      "trouble",
      "truck",
      "true",
      "truly",
      "trumpet",
      "trust",
      "truth",
      "try",
      "tube",
      "tuition",
      "tumble",
      "tuna",
      "tunnel",
      "turkey",
      "turn",
      "turtle",
      "twelve",
      "twenty",
      "twice",
      "twin",
      "twist",
      "two",
      "type",
      "typical",
      "ugly",
      "umbrella",
      "unable",
      "unaware",
      "uncle",
      "uncover",
      "under",
      "undo",
      "unfair",
      "unfold",
      "unhappy",
      "uniform",
      "unique",
      "unit",
      "universe",
      "unknown",
      "unlock",
      "until",
      "unusual",
      "unveil",
      "update",
      "upgrade",
      "uphold",
      "upon",
      "upper",
      "upset",
      "urban",
      "urge",
      "usage",
      "use",
      "used",
      "useful",
      "useless",
      "usual",
      "utility",
      "vacant",
      "vacuum",
      "vague",
      "valid",
      "valley",
      "valve",
      "van",
      "vanish",
      "vapor",
      "various",
      "vast",
      "vault",
      "vehicle",
      "velvet",
      "vendor",
      "venture",
      "venue",
      "verb",
      "verify",
      "version",
      "very",
      "vessel",
      "veteran",
      "viable",
      "vibrant",
      "vicious",
      "victory",
      "video",
      "view",
      "village",
      "vintage",
      "violin",
      "virtual",
      "virus",
      "visa",
      "visit",
      "visual",
      "vital",
      "vivid",
      "vocal",
      "voice",
      "void",
      "volcano",
      "volume",
      "vote",
      "voyage",
      "wage",
      "wagon",
      "wait",
      "walk",
      "wall",
      "walnut",
      "want",
      "warfare",
      "warm",
      "warrior",
      "wash",
      "wasp",
      "waste",
      "water",
      "wave",
      "way",
      "wealth",
      "weapon",
      "wear",
      "weasel",
      "weather",
      "web",
      "wedding",
      "weekend",
      "weird",
      "welcome",
      "west",
      "wet",
      "whale",
      "what",
      "wheat",
      "wheel",
      "when",
      "where",
      "whip",
      "whisper",
      "wide",
      "width",
      "wife",
      "wild",
      "will",
      "win",
      "window",
      "wine",
      "wing",
      "wink",
      "winner",
      "winter",
      "wire",
      "wisdom",
      "wise",
      "wish",
      "witness",
      "wolf",
      "woman",
      "wonder",
      "wood",
      "wool",
      "word",
      "work",
      "world",
      "worry",
      "worth",
      "wrap",
      "wreck",
      "wrestle",
      "wrist",
      "write",
      "wrong",
      "yard",
      "year",
      "yellow",
      "you",
      "young",
      "youth",
      "zebra",
      "zero",
      "zone",
      "zoo"
    ];
    exports.wordlist = EN;
  }
});

// node_modules/@ton/crypto/dist/mnemonic/mnemonic.js
var require_mnemonic = __commonJS({
  "node_modules/@ton/crypto/dist/mnemonic/mnemonic.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.mnemonicFromRandomSeed = exports.mnemonicIndexesToBytes = exports.bytesToMnemonics = exports.bytesToMnemonicIndexes = exports.mnemonicNew = exports.mnemonicValidate = exports.mnemonicToHDSeed = exports.mnemonicToWalletKey = exports.mnemonicToPrivateKey = exports.mnemonicToSeed = exports.mnemonicToEntropy = void 0;
    var tweetnacl_1 = __importDefault(require_nacl_fast());
    var getSecureRandom_1 = require_getSecureRandom2();
    var hmac_sha512_1 = require_hmac_sha5122();
    var pbkdf2_sha512_1 = require_pbkdf2_sha5122();
    var binary_1 = require_binary();
    var wordlist_1 = require_wordlist2();
    var PBKDF_ITERATIONS = 1e5;
    async function isPasswordNeeded(mnemonicArray) {
      const passlessEntropy = await mnemonicToEntropy(mnemonicArray);
      return await isPasswordSeed(passlessEntropy) && !await isBasicSeed(passlessEntropy);
    }
    function normalizeMnemonic(src) {
      return src.map((v) => v.toLowerCase().trim());
    }
    async function isBasicSeed(entropy) {
      const seed = await (0, pbkdf2_sha512_1.pbkdf2_sha512)(entropy, "TON seed version", Math.max(1, Math.floor(PBKDF_ITERATIONS / 256)), 64);
      return seed[0] == 0;
    }
    async function isPasswordSeed(entropy) {
      const seed = await (0, pbkdf2_sha512_1.pbkdf2_sha512)(entropy, "TON fast seed version", 1, 64);
      return seed[0] == 1;
    }
    async function mnemonicToEntropy(mnemonicArray, password) {
      return await (0, hmac_sha512_1.hmac_sha512)(mnemonicArray.join(" "), password && password.length > 0 ? password : "");
    }
    exports.mnemonicToEntropy = mnemonicToEntropy;
    async function mnemonicToSeed(mnemonicArray, seed, password) {
      const entropy = await mnemonicToEntropy(mnemonicArray, password);
      return await (0, pbkdf2_sha512_1.pbkdf2_sha512)(entropy, seed, PBKDF_ITERATIONS, 64);
    }
    exports.mnemonicToSeed = mnemonicToSeed;
    async function mnemonicToPrivateKey(mnemonicArray, password) {
      mnemonicArray = normalizeMnemonic(mnemonicArray);
      const seed = await mnemonicToSeed(mnemonicArray, "TON default seed", password);
      let keyPair = tweetnacl_1.default.sign.keyPair.fromSeed(seed.slice(0, 32));
      return {
        publicKey: Buffer.from(keyPair.publicKey),
        secretKey: Buffer.from(keyPair.secretKey)
      };
    }
    exports.mnemonicToPrivateKey = mnemonicToPrivateKey;
    async function mnemonicToWalletKey(mnemonicArray, password) {
      let seedPk = await mnemonicToPrivateKey(mnemonicArray, password);
      let seedSecret = seedPk.secretKey.slice(0, 32);
      const keyPair = tweetnacl_1.default.sign.keyPair.fromSeed(seedSecret);
      return {
        publicKey: Buffer.from(keyPair.publicKey),
        secretKey: Buffer.from(keyPair.secretKey)
      };
    }
    exports.mnemonicToWalletKey = mnemonicToWalletKey;
    async function mnemonicToHDSeed(mnemonicArray, password) {
      mnemonicArray = normalizeMnemonic(mnemonicArray);
      return await mnemonicToSeed(mnemonicArray, "TON HD Keys seed", password);
    }
    exports.mnemonicToHDSeed = mnemonicToHDSeed;
    async function mnemonicValidate(mnemonicArray, password) {
      mnemonicArray = normalizeMnemonic(mnemonicArray);
      for (let word of mnemonicArray) {
        if (wordlist_1.wordlist.indexOf(word) < 0) {
          return false;
        }
      }
      if (password && password.length > 0) {
        if (!await isPasswordNeeded(mnemonicArray)) {
          return false;
        }
      }
      return await isBasicSeed(await mnemonicToEntropy(mnemonicArray, password));
    }
    exports.mnemonicValidate = mnemonicValidate;
    async function mnemonicNew(wordsCount = 24, password) {
      let mnemonicArray = [];
      while (true) {
        mnemonicArray = [];
        for (let i = 0; i < wordsCount; i++) {
          let ind = await (0, getSecureRandom_1.getSecureRandomNumber)(0, wordlist_1.wordlist.length);
          mnemonicArray.push(wordlist_1.wordlist[ind]);
        }
        if (password && password.length > 0) {
          if (!await isPasswordNeeded(mnemonicArray)) {
            continue;
          }
        }
        if (!await isBasicSeed(await mnemonicToEntropy(mnemonicArray, password))) {
          continue;
        }
        break;
      }
      return mnemonicArray;
    }
    exports.mnemonicNew = mnemonicNew;
    function bytesToMnemonicIndexes(src, wordsCount) {
      let bits = (0, binary_1.bytesToBits)(src);
      let indexes = [];
      for (let i = 0; i < wordsCount; i++) {
        let sl = bits.slice(i * 11, i * 11 + 11);
        indexes.push(parseInt(sl, 2));
      }
      return indexes;
    }
    exports.bytesToMnemonicIndexes = bytesToMnemonicIndexes;
    function bytesToMnemonics(src, wordsCount) {
      let mnemonics = bytesToMnemonicIndexes(src, wordsCount);
      let res = [];
      for (let m of mnemonics) {
        res.push(wordlist_1.wordlist[m]);
      }
      return res;
    }
    exports.bytesToMnemonics = bytesToMnemonics;
    function mnemonicIndexesToBytes(src) {
      let res = "";
      for (let s of src) {
        if (!Number.isSafeInteger(s)) {
          throw Error("Invalid input");
        }
        if (s < 0 || s >= 2028) {
          throw Error("Invalid input");
        }
        res += (0, binary_1.lpad)(s.toString(2), "0", 11);
      }
      while (res.length % 8 !== 0) {
        res = res + "0";
      }
      return (0, binary_1.bitsToBytes)(res);
    }
    exports.mnemonicIndexesToBytes = mnemonicIndexesToBytes;
    async function mnemonicFromRandomSeed(seed, wordsCount = 24, password) {
      const bytesLength = Math.ceil(wordsCount * 11 / 8);
      let currentSeed = seed;
      while (true) {
        let entropy = await (0, pbkdf2_sha512_1.pbkdf2_sha512)(currentSeed, "TON mnemonic seed", Math.max(1, Math.floor(PBKDF_ITERATIONS / 256)), bytesLength);
        let mnemonics = bytesToMnemonics(entropy, wordsCount);
        if (await mnemonicValidate(mnemonics, password)) {
          return mnemonics;
        }
        currentSeed = entropy;
      }
    }
    exports.mnemonicFromRandomSeed = mnemonicFromRandomSeed;
  }
});

// node_modules/@ton/crypto/dist/primitives/nacl.js
var require_nacl = __commonJS({
  "node_modules/@ton/crypto/dist/primitives/nacl.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.openBox = exports.sealBox = exports.signVerify = exports.sign = exports.keyPairFromSeed = exports.keyPairFromSecretKey = void 0;
    var tweetnacl_1 = __importDefault(require_nacl_fast());
    function keyPairFromSecretKey(secretKey) {
      let res = tweetnacl_1.default.sign.keyPair.fromSecretKey(new Uint8Array(secretKey));
      return {
        publicKey: Buffer.from(res.publicKey),
        secretKey: Buffer.from(res.secretKey)
      };
    }
    exports.keyPairFromSecretKey = keyPairFromSecretKey;
    function keyPairFromSeed(secretKey) {
      let res = tweetnacl_1.default.sign.keyPair.fromSeed(new Uint8Array(secretKey));
      return {
        publicKey: Buffer.from(res.publicKey),
        secretKey: Buffer.from(res.secretKey)
      };
    }
    exports.keyPairFromSeed = keyPairFromSeed;
    function sign(data, secretKey) {
      return Buffer.from(tweetnacl_1.default.sign.detached(new Uint8Array(data), new Uint8Array(secretKey)));
    }
    exports.sign = sign;
    function signVerify(data, signature, publicKey) {
      return tweetnacl_1.default.sign.detached.verify(new Uint8Array(data), new Uint8Array(signature), new Uint8Array(publicKey));
    }
    exports.signVerify = signVerify;
    function sealBox(data, nonce, key) {
      return Buffer.from(tweetnacl_1.default.secretbox(data, nonce, key));
    }
    exports.sealBox = sealBox;
    function openBox(data, nonce, key) {
      let res = tweetnacl_1.default.secretbox.open(data, nonce, key);
      if (!res) {
        return null;
      }
      return Buffer.from(res);
    }
    exports.openBox = openBox;
  }
});

// node_modules/@ton/crypto/dist/hd/ed25519.js
var require_ed25519 = __commonJS({
  "node_modules/@ton/crypto/dist/hd/ed25519.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.deriveEd25519Path = exports.deriveED25519HardenedKey = exports.getED25519MasterKeyFromSeed = void 0;
    var hmac_sha512_1 = require_hmac_sha5122();
    var ED25519_CURVE = "ed25519 seed";
    var HARDENED_OFFSET = 2147483648;
    async function getED25519MasterKeyFromSeed(seed) {
      const I = await (0, hmac_sha512_1.hmac_sha512)(ED25519_CURVE, seed);
      const IL = I.slice(0, 32);
      const IR = I.slice(32);
      return {
        key: IL,
        chainCode: IR
      };
    }
    exports.getED25519MasterKeyFromSeed = getED25519MasterKeyFromSeed;
    async function deriveED25519HardenedKey(parent, index) {
      if (index >= HARDENED_OFFSET) {
        throw Error("Key index must be less than offset");
      }
      const indexBuffer = Buffer.alloc(4);
      indexBuffer.writeUInt32BE(index + HARDENED_OFFSET, 0);
      const data = Buffer.concat([Buffer.alloc(1, 0), parent.key, indexBuffer]);
      const I = await (0, hmac_sha512_1.hmac_sha512)(parent.chainCode, data);
      const IL = I.slice(0, 32);
      const IR = I.slice(32);
      return {
        key: IL,
        chainCode: IR
      };
    }
    exports.deriveED25519HardenedKey = deriveED25519HardenedKey;
    async function deriveEd25519Path(seed, path) {
      let state = await getED25519MasterKeyFromSeed(seed);
      let remaining = [...path];
      while (remaining.length > 0) {
        let index = remaining[0];
        remaining = remaining.slice(1);
        state = await deriveED25519HardenedKey(state, index);
      }
      return state.key;
    }
    exports.deriveEd25519Path = deriveEd25519Path;
  }
});

// node_modules/@ton/crypto/dist/hd/symmetric.js
var require_symmetric = __commonJS({
  "node_modules/@ton/crypto/dist/hd/symmetric.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.deriveSymmetricPath = exports.deriveSymmetricHardenedKey = exports.getSymmetricMasterKeyFromSeed = void 0;
    var hmac_sha512_1 = require_hmac_sha5122();
    var SYMMETRIC_SEED = "Symmetric key seed";
    async function getSymmetricMasterKeyFromSeed(seed) {
      const I = await (0, hmac_sha512_1.hmac_sha512)(SYMMETRIC_SEED, seed);
      const IL = I.slice(32);
      const IR = I.slice(0, 32);
      return {
        key: IL,
        chainCode: IR
      };
    }
    exports.getSymmetricMasterKeyFromSeed = getSymmetricMasterKeyFromSeed;
    async function deriveSymmetricHardenedKey(parent, offset) {
      const data = Buffer.concat([Buffer.alloc(1, 0), Buffer.from(offset)]);
      const I = await (0, hmac_sha512_1.hmac_sha512)(parent.chainCode, data);
      const IL = I.slice(32);
      const IR = I.slice(0, 32);
      return {
        key: IL,
        chainCode: IR
      };
    }
    exports.deriveSymmetricHardenedKey = deriveSymmetricHardenedKey;
    async function deriveSymmetricPath(seed, path) {
      let state = await getSymmetricMasterKeyFromSeed(seed);
      let remaining = [...path];
      while (remaining.length > 0) {
        let index = remaining[0];
        remaining = remaining.slice(1);
        state = await deriveSymmetricHardenedKey(state, index);
      }
      return state.key;
    }
    exports.deriveSymmetricPath = deriveSymmetricPath;
  }
});

// node_modules/@ton/crypto/dist/hd/mnemonics.js
var require_mnemonics = __commonJS({
  "node_modules/@ton/crypto/dist/hd/mnemonics.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.deriveMnemonicsPath = exports.deriveMnemonicHardenedKey = exports.getMnemonicsMasterKeyFromSeed = void 0;
    var mnemonic_1 = require_mnemonic();
    var hmac_sha512_1 = require_hmac_sha5122();
    var HARDENED_OFFSET = 2147483648;
    var MNEMONICS_SEED = "TON Mnemonics HD seed";
    async function getMnemonicsMasterKeyFromSeed(seed) {
      const I = await (0, hmac_sha512_1.hmac_sha512)(MNEMONICS_SEED, seed);
      const IL = I.slice(0, 32);
      const IR = I.slice(32);
      return {
        key: IL,
        chainCode: IR
      };
    }
    exports.getMnemonicsMasterKeyFromSeed = getMnemonicsMasterKeyFromSeed;
    async function deriveMnemonicHardenedKey(parent, index) {
      if (index >= HARDENED_OFFSET) {
        throw Error("Key index must be less than offset");
      }
      const indexBuffer = Buffer.alloc(4);
      indexBuffer.writeUInt32BE(index + HARDENED_OFFSET, 0);
      const data = Buffer.concat([Buffer.alloc(1, 0), parent.key, indexBuffer]);
      const I = await (0, hmac_sha512_1.hmac_sha512)(parent.chainCode, data);
      const IL = I.slice(0, 32);
      const IR = I.slice(32);
      return {
        key: IL,
        chainCode: IR
      };
    }
    exports.deriveMnemonicHardenedKey = deriveMnemonicHardenedKey;
    async function deriveMnemonicsPath(seed, path, wordsCount = 24, password) {
      let state = await getMnemonicsMasterKeyFromSeed(seed);
      let remaining = [...path];
      while (remaining.length > 0) {
        let index = remaining[0];
        remaining = remaining.slice(1);
        state = await deriveMnemonicHardenedKey(state, index);
      }
      return await (0, mnemonic_1.mnemonicFromRandomSeed)(state.key, wordsCount, password);
    }
    exports.deriveMnemonicsPath = deriveMnemonicsPath;
  }
});

// node_modules/@ton/crypto/dist/index.js
var require_dist = __commonJS({
  "node_modules/@ton/crypto/dist/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getMnemonicsMasterKeyFromSeed = exports.deriveMnemonicHardenedKey = exports.deriveMnemonicsPath = exports.deriveSymmetricPath = exports.deriveSymmetricHardenedKey = exports.getSymmetricMasterKeyFromSeed = exports.deriveEd25519Path = exports.deriveED25519HardenedKey = exports.getED25519MasterKeyFromSeed = exports.signVerify = exports.sign = exports.keyPairFromSecretKey = exports.keyPairFromSeed = exports.openBox = exports.sealBox = exports.mnemonicWordList = exports.mnemonicToHDSeed = exports.mnemonicToSeed = exports.mnemonicToWalletKey = exports.mnemonicToPrivateKey = exports.mnemonicValidate = exports.mnemonicNew = exports.newSecurePassphrase = exports.newSecureWords = exports.getSecureRandomNumber = exports.getSecureRandomWords = exports.getSecureRandomBytes = exports.hmac_sha512 = exports.pbkdf2_sha512 = exports.sha512_sync = exports.sha512 = exports.sha256_sync = exports.sha256 = void 0;
    var sha256_1 = require_sha2562();
    Object.defineProperty(exports, "sha256", { enumerable: true, get: function() {
      return sha256_1.sha256;
    } });
    Object.defineProperty(exports, "sha256_sync", { enumerable: true, get: function() {
      return sha256_1.sha256_sync;
    } });
    var sha512_1 = require_sha5122();
    Object.defineProperty(exports, "sha512", { enumerable: true, get: function() {
      return sha512_1.sha512;
    } });
    Object.defineProperty(exports, "sha512_sync", { enumerable: true, get: function() {
      return sha512_1.sha512_sync;
    } });
    var pbkdf2_sha512_1 = require_pbkdf2_sha5122();
    Object.defineProperty(exports, "pbkdf2_sha512", { enumerable: true, get: function() {
      return pbkdf2_sha512_1.pbkdf2_sha512;
    } });
    var hmac_sha512_1 = require_hmac_sha5122();
    Object.defineProperty(exports, "hmac_sha512", { enumerable: true, get: function() {
      return hmac_sha512_1.hmac_sha512;
    } });
    var getSecureRandom_1 = require_getSecureRandom2();
    Object.defineProperty(exports, "getSecureRandomBytes", { enumerable: true, get: function() {
      return getSecureRandom_1.getSecureRandomBytes;
    } });
    Object.defineProperty(exports, "getSecureRandomWords", { enumerable: true, get: function() {
      return getSecureRandom_1.getSecureRandomWords;
    } });
    Object.defineProperty(exports, "getSecureRandomNumber", { enumerable: true, get: function() {
      return getSecureRandom_1.getSecureRandomNumber;
    } });
    var newSecureWords_1 = require_newSecureWords();
    Object.defineProperty(exports, "newSecureWords", { enumerable: true, get: function() {
      return newSecureWords_1.newSecureWords;
    } });
    var newSecurePassphrase_1 = require_newSecurePassphrase();
    Object.defineProperty(exports, "newSecurePassphrase", { enumerable: true, get: function() {
      return newSecurePassphrase_1.newSecurePassphrase;
    } });
    var mnemonic_1 = require_mnemonic();
    Object.defineProperty(exports, "mnemonicNew", { enumerable: true, get: function() {
      return mnemonic_1.mnemonicNew;
    } });
    Object.defineProperty(exports, "mnemonicValidate", { enumerable: true, get: function() {
      return mnemonic_1.mnemonicValidate;
    } });
    Object.defineProperty(exports, "mnemonicToPrivateKey", { enumerable: true, get: function() {
      return mnemonic_1.mnemonicToPrivateKey;
    } });
    Object.defineProperty(exports, "mnemonicToWalletKey", { enumerable: true, get: function() {
      return mnemonic_1.mnemonicToWalletKey;
    } });
    Object.defineProperty(exports, "mnemonicToSeed", { enumerable: true, get: function() {
      return mnemonic_1.mnemonicToSeed;
    } });
    Object.defineProperty(exports, "mnemonicToHDSeed", { enumerable: true, get: function() {
      return mnemonic_1.mnemonicToHDSeed;
    } });
    var wordlist_1 = require_wordlist2();
    Object.defineProperty(exports, "mnemonicWordList", { enumerable: true, get: function() {
      return wordlist_1.wordlist;
    } });
    var nacl_1 = require_nacl();
    Object.defineProperty(exports, "sealBox", { enumerable: true, get: function() {
      return nacl_1.sealBox;
    } });
    Object.defineProperty(exports, "openBox", { enumerable: true, get: function() {
      return nacl_1.openBox;
    } });
    var nacl_2 = require_nacl();
    Object.defineProperty(exports, "keyPairFromSeed", { enumerable: true, get: function() {
      return nacl_2.keyPairFromSeed;
    } });
    Object.defineProperty(exports, "keyPairFromSecretKey", { enumerable: true, get: function() {
      return nacl_2.keyPairFromSecretKey;
    } });
    Object.defineProperty(exports, "sign", { enumerable: true, get: function() {
      return nacl_2.sign;
    } });
    Object.defineProperty(exports, "signVerify", { enumerable: true, get: function() {
      return nacl_2.signVerify;
    } });
    var ed25519_1 = require_ed25519();
    Object.defineProperty(exports, "getED25519MasterKeyFromSeed", { enumerable: true, get: function() {
      return ed25519_1.getED25519MasterKeyFromSeed;
    } });
    Object.defineProperty(exports, "deriveED25519HardenedKey", { enumerable: true, get: function() {
      return ed25519_1.deriveED25519HardenedKey;
    } });
    Object.defineProperty(exports, "deriveEd25519Path", { enumerable: true, get: function() {
      return ed25519_1.deriveEd25519Path;
    } });
    var symmetric_1 = require_symmetric();
    Object.defineProperty(exports, "getSymmetricMasterKeyFromSeed", { enumerable: true, get: function() {
      return symmetric_1.getSymmetricMasterKeyFromSeed;
    } });
    Object.defineProperty(exports, "deriveSymmetricHardenedKey", { enumerable: true, get: function() {
      return symmetric_1.deriveSymmetricHardenedKey;
    } });
    Object.defineProperty(exports, "deriveSymmetricPath", { enumerable: true, get: function() {
      return symmetric_1.deriveSymmetricPath;
    } });
    var mnemonics_1 = require_mnemonics();
    Object.defineProperty(exports, "deriveMnemonicsPath", { enumerable: true, get: function() {
      return mnemonics_1.deriveMnemonicsPath;
    } });
    Object.defineProperty(exports, "deriveMnemonicHardenedKey", { enumerable: true, get: function() {
      return mnemonics_1.deriveMnemonicHardenedKey;
    } });
    Object.defineProperty(exports, "getMnemonicsMasterKeyFromSeed", { enumerable: true, get: function() {
      return mnemonics_1.getMnemonicsMasterKeyFromSeed;
    } });
  }
});

// node_modules/@ton/core/dist/boc/cell/wonderCalculator.js
var require_wonderCalculator = __commonJS({
  "node_modules/@ton/core/dist/boc/cell/wonderCalculator.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.wonderCalculator = void 0;
    var BitString_1 = require_BitString();
    var CellType_1 = require_CellType();
    var LevelMask_1 = require_LevelMask();
    var exoticPruned_1 = require_exoticPruned();
    var exoticMerkleProof_1 = require_exoticMerkleProof();
    var descriptor_1 = require_descriptor();
    var crypto_1 = require_dist();
    var exoticMerkleUpdate_1 = require_exoticMerkleUpdate();
    var exoticLibrary_1 = require_exoticLibrary();
    function wonderCalculator(type, bits, refs) {
      let levelMask;
      let pruned = null;
      if (type === CellType_1.CellType.Ordinary) {
        let mask = 0;
        for (let r of refs) {
          mask = mask | r.mask.value;
        }
        levelMask = new LevelMask_1.LevelMask(mask);
      } else if (type === CellType_1.CellType.PrunedBranch) {
        pruned = (0, exoticPruned_1.exoticPruned)(bits, refs);
        levelMask = new LevelMask_1.LevelMask(pruned.mask);
      } else if (type === CellType_1.CellType.MerkleProof) {
        let loaded = (0, exoticMerkleProof_1.exoticMerkleProof)(bits, refs);
        levelMask = new LevelMask_1.LevelMask(refs[0].mask.value >> 1);
      } else if (type === CellType_1.CellType.MerkleUpdate) {
        let loaded = (0, exoticMerkleUpdate_1.exoticMerkleUpdate)(bits, refs);
        levelMask = new LevelMask_1.LevelMask((refs[0].mask.value | refs[1].mask.value) >> 1);
      } else if (type === CellType_1.CellType.Library) {
        let loaded = (0, exoticLibrary_1.exoticLibrary)(bits, refs);
        levelMask = new LevelMask_1.LevelMask();
      } else {
        throw new Error("Unsupported exotic type");
      }
      let depths = [];
      let hashes = [];
      let hashCount = type === CellType_1.CellType.PrunedBranch ? 1 : levelMask.hashCount;
      let totalHashCount = levelMask.hashCount;
      let hashIOffset = totalHashCount - hashCount;
      for (let levelI = 0, hashI = 0; levelI <= levelMask.level; levelI++) {
        if (!levelMask.isSignificant(levelI)) {
          continue;
        }
        if (hashI < hashIOffset) {
          hashI++;
          continue;
        }
        let currentBits;
        if (hashI === hashIOffset) {
          if (!(levelI === 0 || type === CellType_1.CellType.PrunedBranch)) {
            throw Error("Invalid");
          }
          currentBits = bits;
        } else {
          if (!(levelI !== 0 && type !== CellType_1.CellType.PrunedBranch)) {
            throw Error("Invalid: " + levelI + ", " + type);
          }
          currentBits = new BitString_1.BitString(hashes[hashI - hashIOffset - 1], 0, 256);
        }
        let currentDepth = 0;
        for (let c of refs) {
          let childDepth;
          if (type == CellType_1.CellType.MerkleProof || type == CellType_1.CellType.MerkleUpdate) {
            childDepth = c.depth(levelI + 1);
          } else {
            childDepth = c.depth(levelI);
          }
          currentDepth = Math.max(currentDepth, childDepth);
        }
        if (refs.length > 0) {
          currentDepth++;
        }
        let repr = (0, descriptor_1.getRepr)(bits, currentBits, refs, levelI, levelMask.apply(levelI).value, type);
        let hash = (0, crypto_1.sha256_sync)(repr);
        let destI = hashI - hashIOffset;
        depths[destI] = currentDepth;
        hashes[destI] = hash;
        hashI++;
      }
      let resolvedHashes = [];
      let resolvedDepths = [];
      if (pruned) {
        for (let i = 0; i < 4; i++) {
          const { hashIndex } = levelMask.apply(i);
          const { hashIndex: thisHashIndex } = levelMask;
          if (hashIndex !== thisHashIndex) {
            resolvedHashes.push(pruned.pruned[hashIndex].hash);
            resolvedDepths.push(pruned.pruned[hashIndex].depth);
          } else {
            resolvedHashes.push(hashes[0]);
            resolvedDepths.push(depths[0]);
          }
        }
      } else {
        for (let i = 0; i < 4; i++) {
          resolvedHashes.push(hashes[levelMask.apply(i).hashIndex]);
          resolvedDepths.push(depths[levelMask.apply(i).hashIndex]);
        }
      }
      return {
        mask: levelMask,
        hashes: resolvedHashes,
        depths: resolvedDepths
      };
    }
    exports.wonderCalculator = wonderCalculator;
  }
});

// node_modules/@ton/core/dist/boc/cell/utils/topologicalSort.js
var require_topologicalSort = __commonJS({
  "node_modules/@ton/core/dist/boc/cell/utils/topologicalSort.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.topologicalSort = void 0;
    function topologicalSort(src) {
      let pending = [src];
      let allCells = /* @__PURE__ */ new Map();
      let notPermCells = /* @__PURE__ */ new Set();
      let sorted = [];
      while (pending.length > 0) {
        const cells = [...pending];
        pending = [];
        for (let cell of cells) {
          const hash = cell.hash().toString("hex");
          if (allCells.has(hash)) {
            continue;
          }
          notPermCells.add(hash);
          allCells.set(hash, { cell, refs: cell.refs.map((v) => v.hash().toString("hex")) });
          for (let r of cell.refs) {
            pending.push(r);
          }
        }
      }
      let tempMark = /* @__PURE__ */ new Set();
      function visit(hash) {
        if (!notPermCells.has(hash)) {
          return;
        }
        if (tempMark.has(hash)) {
          throw Error("Not a DAG");
        }
        tempMark.add(hash);
        let refs = allCells.get(hash).refs;
        for (let ci = refs.length - 1; ci >= 0; ci--) {
          visit(refs[ci]);
        }
        sorted.push(hash);
        tempMark.delete(hash);
        notPermCells.delete(hash);
      }
      while (notPermCells.size > 0) {
        const id = Array.from(notPermCells)[0];
        visit(id);
      }
      let indexes = /* @__PURE__ */ new Map();
      for (let i = 0; i < sorted.length; i++) {
        indexes.set(sorted[sorted.length - i - 1], i);
      }
      let result = [];
      for (let i = sorted.length - 1; i >= 0; i--) {
        let ent = sorted[i];
        const rrr = allCells.get(ent);
        result.push({ cell: rrr.cell, refs: rrr.refs.map((v) => indexes.get(v)) });
      }
      return result;
    }
    exports.topologicalSort = topologicalSort;
  }
});

// node_modules/@ton/core/dist/utils/bitsForNumber.js
var require_bitsForNumber = __commonJS({
  "node_modules/@ton/core/dist/utils/bitsForNumber.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.bitsForNumber = void 0;
    function bitsForNumber(src, mode) {
      let v = BigInt(src);
      if (mode === "int") {
        if (v === 0n || v === -1n) {
          return 1;
        }
        let v2 = v > 0 ? v : -v;
        return v2.toString(2).length + 1;
      } else if (mode === "uint") {
        if (v < 0) {
          throw Error(`value is negative. Got ${src}`);
        }
        return v.toString(2).length;
      } else {
        throw Error(`invalid mode. Got ${mode}`);
      }
    }
    exports.bitsForNumber = bitsForNumber;
  }
});

// node_modules/@ton/core/dist/utils/crc32c.js
var require_crc32c = __commonJS({
  "node_modules/@ton/core/dist/utils/crc32c.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.crc32c = void 0;
    var POLY = 2197175160;
    function crc32c(source) {
      let crc = 0 ^ 4294967295;
      for (let n = 0; n < source.length; n++) {
        crc ^= source[n];
        crc = crc & 1 ? crc >>> 1 ^ POLY : crc >>> 1;
        crc = crc & 1 ? crc >>> 1 ^ POLY : crc >>> 1;
        crc = crc & 1 ? crc >>> 1 ^ POLY : crc >>> 1;
        crc = crc & 1 ? crc >>> 1 ^ POLY : crc >>> 1;
        crc = crc & 1 ? crc >>> 1 ^ POLY : crc >>> 1;
        crc = crc & 1 ? crc >>> 1 ^ POLY : crc >>> 1;
        crc = crc & 1 ? crc >>> 1 ^ POLY : crc >>> 1;
        crc = crc & 1 ? crc >>> 1 ^ POLY : crc >>> 1;
      }
      crc = crc ^ 4294967295;
      let res = Buffer.alloc(4);
      res.writeInt32LE(crc);
      return res;
    }
    exports.crc32c = crc32c;
  }
});

// node_modules/@ton/core/dist/boc/cell/serialization.js
var require_serialization = __commonJS({
  "node_modules/@ton/core/dist/boc/cell/serialization.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.serializeBoc = exports.deserializeBoc = exports.parseBoc = void 0;
    var BitReader_1 = require_BitReader();
    var BitString_1 = require_BitString();
    var Cell_1 = require_Cell();
    var topologicalSort_1 = require_topologicalSort();
    var bitsForNumber_1 = require_bitsForNumber();
    var BitBuilder_1 = require_BitBuilder();
    var descriptor_1 = require_descriptor();
    var paddedBits_1 = require_paddedBits();
    var crc32c_1 = require_crc32c();
    function getHashesCount(levelMask) {
      return getHashesCountFromMask(levelMask & 7);
    }
    function getHashesCountFromMask(mask) {
      let n = 0;
      for (let i = 0; i < 3; i++) {
        n += mask & 1;
        mask = mask >> 1;
      }
      return n + 1;
    }
    function readCell(reader, sizeBytes) {
      const d1 = reader.loadUint(8);
      const refsCount = d1 % 8;
      const exotic = !!(d1 & 8);
      const d2 = reader.loadUint(8);
      const dataBytesize = Math.ceil(d2 / 2);
      const paddingAdded = !!(d2 % 2);
      const levelMask = d1 >> 5;
      const hasHashes = (d1 & 16) != 0;
      const hash_bytes = 32;
      const hashesSize = hasHashes ? getHashesCount(levelMask) * hash_bytes : 0;
      const depthSize = hasHashes ? getHashesCount(levelMask) * 2 : 0;
      reader.skip(hashesSize * 8);
      reader.skip(depthSize * 8);
      let bits = BitString_1.BitString.EMPTY;
      if (dataBytesize > 0) {
        if (paddingAdded) {
          bits = reader.loadPaddedBits(dataBytesize * 8);
        } else {
          bits = reader.loadBits(dataBytesize * 8);
        }
      }
      let refs = [];
      for (let i = 0; i < refsCount; i++) {
        refs.push(reader.loadUint(sizeBytes * 8));
      }
      return {
        bits,
        refs,
        exotic
      };
    }
    function calcCellSize(cell, sizeBytes) {
      return 2 + Math.ceil(cell.bits.length / 8) + cell.refs.length * sizeBytes;
    }
    function parseBoc(src) {
      let reader = new BitReader_1.BitReader(new BitString_1.BitString(src, 0, src.length * 8));
      let magic = reader.loadUint(32);
      if (magic === 1761568243) {
        let size = reader.loadUint(8);
        let offBytes = reader.loadUint(8);
        let cells = reader.loadUint(size * 8);
        let roots = reader.loadUint(size * 8);
        let absent = reader.loadUint(size * 8);
        let totalCellSize = reader.loadUint(offBytes * 8);
        let index = reader.loadBuffer(cells * offBytes);
        let cellData = reader.loadBuffer(totalCellSize);
        return {
          size,
          offBytes,
          cells,
          roots,
          absent,
          totalCellSize,
          index,
          cellData,
          root: [0]
        };
      } else if (magic === 2898503464) {
        let size = reader.loadUint(8);
        let offBytes = reader.loadUint(8);
        let cells = reader.loadUint(size * 8);
        let roots = reader.loadUint(size * 8);
        let absent = reader.loadUint(size * 8);
        let totalCellSize = reader.loadUint(offBytes * 8);
        let index = reader.loadBuffer(cells * offBytes);
        let cellData = reader.loadBuffer(totalCellSize);
        let crc32 = reader.loadBuffer(4);
        if (!(0, crc32c_1.crc32c)(src.subarray(0, src.length - 4)).equals(crc32)) {
          throw Error("Invalid CRC32C");
        }
        return {
          size,
          offBytes,
          cells,
          roots,
          absent,
          totalCellSize,
          index,
          cellData,
          root: [0]
        };
      } else if (magic === 3052313714) {
        let hasIdx = reader.loadUint(1);
        let hasCrc32c = reader.loadUint(1);
        let hasCacheBits = reader.loadUint(1);
        let flags = reader.loadUint(2);
        let size = reader.loadUint(3);
        let offBytes = reader.loadUint(8);
        let cells = reader.loadUint(size * 8);
        let roots = reader.loadUint(size * 8);
        let absent = reader.loadUint(size * 8);
        let totalCellSize = reader.loadUint(offBytes * 8);
        let root = [];
        for (let i = 0; i < roots; i++) {
          root.push(reader.loadUint(size * 8));
        }
        let index = null;
        if (hasIdx) {
          index = reader.loadBuffer(cells * offBytes);
        }
        let cellData = reader.loadBuffer(totalCellSize);
        if (hasCrc32c) {
          let crc32 = reader.loadBuffer(4);
          if (!(0, crc32c_1.crc32c)(src.subarray(0, src.length - 4)).equals(crc32)) {
            throw Error("Invalid CRC32C");
          }
        }
        return {
          size,
          offBytes,
          cells,
          roots,
          absent,
          totalCellSize,
          index,
          cellData,
          root
        };
      } else {
        throw Error("Invalid magic");
      }
    }
    exports.parseBoc = parseBoc;
    function deserializeBoc(src) {
      let boc = parseBoc(src);
      let reader = new BitReader_1.BitReader(new BitString_1.BitString(boc.cellData, 0, boc.cellData.length * 8));
      let cells = [];
      for (let i = 0; i < boc.cells; i++) {
        let cll = readCell(reader, boc.size);
        cells.push({ ...cll, result: null });
      }
      for (let i = cells.length - 1; i >= 0; i--) {
        if (cells[i].result) {
          throw Error("Impossible");
        }
        let refs = [];
        for (let r of cells[i].refs) {
          if (!cells[r].result) {
            throw Error("Invalid BOC file");
          }
          refs.push(cells[r].result);
        }
        cells[i].result = new Cell_1.Cell({ bits: cells[i].bits, refs, exotic: cells[i].exotic });
      }
      let roots = [];
      for (let i = 0; i < boc.root.length; i++) {
        roots.push(cells[boc.root[i]].result);
      }
      return roots;
    }
    exports.deserializeBoc = deserializeBoc;
    function writeCellToBuilder(cell, refs, sizeBytes, to) {
      let d1 = (0, descriptor_1.getRefsDescriptor)(cell.refs, cell.mask.value, cell.type);
      let d2 = (0, descriptor_1.getBitsDescriptor)(cell.bits);
      to.writeUint(d1, 8);
      to.writeUint(d2, 8);
      to.writeBuffer((0, paddedBits_1.bitsToPaddedBuffer)(cell.bits));
      for (let r of refs) {
        to.writeUint(r, sizeBytes * 8);
      }
    }
    function serializeBoc(root, opts) {
      let allCells = (0, topologicalSort_1.topologicalSort)(root);
      let cellsNum = allCells.length;
      let has_idx = opts.idx;
      let has_crc32c = opts.crc32;
      let has_cache_bits = false;
      let flags = 0;
      let sizeBytes = Math.max(Math.ceil((0, bitsForNumber_1.bitsForNumber)(cellsNum, "uint") / 8), 1);
      let totalCellSize = 0;
      let index = [];
      for (let c of allCells) {
        let sz = calcCellSize(c.cell, sizeBytes);
        totalCellSize += sz;
        index.push(totalCellSize);
      }
      let offsetBytes = Math.max(Math.ceil((0, bitsForNumber_1.bitsForNumber)(totalCellSize, "uint") / 8), 1);
      let totalSize = (4 + // magic
      1 + // flags and s_bytes
      1 + // offset_bytes
      3 * sizeBytes + // cells_num, roots, complete
      offsetBytes + // full_size
      1 * sizeBytes + // root_idx
      (has_idx ? cellsNum * offsetBytes : 0) + totalCellSize + (has_crc32c ? 4 : 0)) * 8;
      let builder = new BitBuilder_1.BitBuilder(totalSize);
      builder.writeUint(3052313714, 32);
      builder.writeBit(has_idx);
      builder.writeBit(has_crc32c);
      builder.writeBit(has_cache_bits);
      builder.writeUint(flags, 2);
      builder.writeUint(sizeBytes, 3);
      builder.writeUint(offsetBytes, 8);
      builder.writeUint(cellsNum, sizeBytes * 8);
      builder.writeUint(1, sizeBytes * 8);
      builder.writeUint(0, sizeBytes * 8);
      builder.writeUint(totalCellSize, offsetBytes * 8);
      builder.writeUint(0, sizeBytes * 8);
      if (has_idx) {
        for (let i = 0; i < cellsNum; i++) {
          builder.writeUint(index[i], offsetBytes * 8);
        }
      }
      for (let i = 0; i < cellsNum; i++) {
        writeCellToBuilder(allCells[i].cell, allCells[i].refs, sizeBytes, builder);
      }
      if (has_crc32c) {
        let crc32 = (0, crc32c_1.crc32c)(builder.buffer());
        builder.writeBuffer(crc32);
      }
      let res = builder.buffer();
      if (res.length !== totalSize / 8) {
        throw Error("Internal error");
      }
      return res;
    }
    exports.serializeBoc = serializeBoc;
  }
});

// node_modules/@ton/core/dist/boc/Cell.js
var require_Cell = __commonJS({
  "node_modules/@ton/core/dist/boc/Cell.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    var _a;
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Cell = void 0;
    var symbol_inspect_1 = __importDefault(require_symbol());
    var BitString_1 = require_BitString();
    var CellType_1 = require_CellType();
    var Slice_1 = require_Slice();
    var resolveExotic_1 = require_resolveExotic();
    var wonderCalculator_1 = require_wonderCalculator();
    var serialization_1 = require_serialization();
    var BitReader_1 = require_BitReader();
    var Builder_1 = require_Builder();
    var Cell2 = class _Cell {
      /**
       * Deserialize cells from BOC
       * @param src source buffer
       * @returns array of cells
       */
      static fromBoc(src) {
        return (0, serialization_1.deserializeBoc)(src);
      }
      /**
       * Helper function that deserializes a single cell from BOC in base64
       * @param src source string
       */
      static fromBase64(src) {
        let parsed = _Cell.fromBoc(Buffer.from(src, "base64"));
        if (parsed.length !== 1) {
          throw new Error("Deserialized more than one cell");
        }
        return parsed[0];
      }
      /**
       * Helper function that deserializes a single cell from BOC in hex
       * @param src source string
       */
      static fromHex(src) {
        let parsed = _Cell.fromBoc(Buffer.from(src, "hex"));
        if (parsed.length !== 1) {
          throw new Error("Deserialized more than one cell");
        }
        return parsed[0];
      }
      constructor(opts) {
        this._hashes = [];
        this._depths = [];
        this.beginParse = (allowExotic = false) => {
          if (this.isExotic && !allowExotic) {
            throw new Error("Exotic cells cannot be parsed");
          }
          return new Slice_1.Slice(new BitReader_1.BitReader(this.bits), this.refs);
        };
        this.hash = (level = 3) => {
          return this._hashes[Math.min(this._hashes.length - 1, level)];
        };
        this.depth = (level = 3) => {
          return this._depths[Math.min(this._depths.length - 1, level)];
        };
        this.level = () => {
          return this.mask.level;
        };
        this.equals = (other) => {
          return this.hash().equals(other.hash());
        };
        this[_a] = () => this.toString();
        let bits = BitString_1.BitString.EMPTY;
        if (opts && opts.bits) {
          bits = opts.bits;
        }
        let refs = [];
        if (opts && opts.refs) {
          refs = [...opts.refs];
        }
        let hashes;
        let depths;
        let mask;
        let type = CellType_1.CellType.Ordinary;
        if (opts && opts.exotic) {
          let resolved = (0, resolveExotic_1.resolveExotic)(bits, refs);
          let wonders = (0, wonderCalculator_1.wonderCalculator)(resolved.type, bits, refs);
          mask = wonders.mask;
          depths = wonders.depths;
          hashes = wonders.hashes;
          type = resolved.type;
        } else {
          if (refs.length > 4) {
            throw new Error("Invalid number of references");
          }
          if (bits.length > 1023) {
            throw new Error(`Bits overflow: ${bits.length} > 1023`);
          }
          let wonders = (0, wonderCalculator_1.wonderCalculator)(CellType_1.CellType.Ordinary, bits, refs);
          mask = wonders.mask;
          depths = wonders.depths;
          hashes = wonders.hashes;
          type = CellType_1.CellType.Ordinary;
        }
        this.type = type;
        this.bits = bits;
        this.refs = refs;
        this.mask = mask;
        this._depths = depths;
        this._hashes = hashes;
        Object.freeze(this);
        Object.freeze(this.refs);
        Object.freeze(this.bits);
        Object.freeze(this.mask);
        Object.freeze(this._depths);
        Object.freeze(this._hashes);
      }
      /**
       * Check if cell is exotic
       */
      get isExotic() {
        return this.type !== CellType_1.CellType.Ordinary;
      }
      /**
       * Serializes cell to BOC
       * @param opts options
       */
      toBoc(opts) {
        let idx = opts && opts.idx !== null && opts.idx !== void 0 ? opts.idx : false;
        let crc32 = opts && opts.crc32 !== null && opts.crc32 !== void 0 ? opts.crc32 : true;
        return (0, serialization_1.serializeBoc)(this, { idx, crc32 });
      }
      /**
       * Format cell to string
       * @param indent indentation
       * @returns string representation
       */
      toString(indent) {
        let id = indent || "";
        let t = "x";
        if (this.isExotic) {
          if (this.type === CellType_1.CellType.MerkleProof) {
            t = "p";
          } else if (this.type === CellType_1.CellType.MerkleUpdate) {
            t = "u";
          } else if (this.type === CellType_1.CellType.PrunedBranch) {
            t = "p";
          }
        }
        let s = id + (this.isExotic ? t : "x") + "{" + this.bits.toString() + "}";
        for (let k in this.refs) {
          const i = this.refs[k];
          s += "\n" + i.toString(id + " ");
        }
        return s;
      }
      /**
       * Covnert cell to slice
       * @returns slice
       */
      asSlice() {
        return this.beginParse();
      }
      /**
       * Convert cell to a builder that has this cell stored
       * @returns builder
       */
      asBuilder() {
        return (0, Builder_1.beginCell)().storeSlice(this.asSlice());
      }
    };
    exports.Cell = Cell2;
    _a = symbol_inspect_1.default;
    Cell2.EMPTY = new Cell2();
  }
});

// node_modules/@ton/core/dist/boc/Builder.js
var require_Builder = __commonJS({
  "node_modules/@ton/core/dist/boc/Builder.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Builder = exports.beginCell = void 0;
    var BitBuilder_1 = require_BitBuilder();
    var Cell_1 = require_Cell();
    var strings_1 = require_strings();
    function beginCell2() {
      return new Builder2();
    }
    exports.beginCell = beginCell2;
    var Builder2 = class _Builder {
      constructor() {
        this._bits = new BitBuilder_1.BitBuilder();
        this._refs = [];
      }
      /**
       * Bits written so far
       */
      get bits() {
        return this._bits.length;
      }
      /**
       * References written so far
       */
      get refs() {
        return this._refs.length;
      }
      /**
       * Available bits
       */
      get availableBits() {
        return 1023 - this.bits;
      }
      /**
       * Available references
       */
      get availableRefs() {
        return 4 - this.refs;
      }
      /**
       * Write a single bit
       * @param value bit to write, true or positive number for 1, false or zero or negative for 0
       * @returns this builder
       */
      storeBit(value) {
        this._bits.writeBit(value);
        return this;
      }
      /**
       * Write bits from BitString
       * @param src source bits
       * @returns this builder
       */
      storeBits(src) {
        this._bits.writeBits(src);
        return this;
      }
      /**
       * Store Buffer
       * @param src source buffer
       * @param bytes optional number of bytes to write
       * @returns this builder
       */
      storeBuffer(src, bytes) {
        if (bytes !== void 0 && bytes !== null) {
          if (src.length !== bytes) {
            throw Error(`Buffer length ${src.length} is not equal to ${bytes}`);
          }
        }
        this._bits.writeBuffer(src);
        return this;
      }
      /**
       * Store Maybe Buffer
       * @param src source buffer or null
       * @param bytes optional number of bytes to write
       * @returns this builder
       */
      storeMaybeBuffer(src, bytes) {
        if (src !== null) {
          this.storeBit(1);
          this.storeBuffer(src, bytes);
        } else {
          this.storeBit(0);
        }
        return this;
      }
      /**
       * Store uint value
       * @param value value as bigint or number
       * @param bits number of bits to write
       * @returns this builder
       */
      storeUint(value, bits) {
        this._bits.writeUint(value, bits);
        return this;
      }
      /**
       * Store maybe uint value
       * @param value value as bigint or number, null or undefined
       * @param bits number of bits to write
       * @returns this builder
       */
      storeMaybeUint(value, bits) {
        if (value !== null && value !== void 0) {
          this.storeBit(1);
          this.storeUint(value, bits);
        } else {
          this.storeBit(0);
        }
        return this;
      }
      /**
       * Store int value
       * @param value value as bigint or number
       * @param bits number of bits to write
       * @returns this builder
       */
      storeInt(value, bits) {
        this._bits.writeInt(value, bits);
        return this;
      }
      /**
       * Store maybe int value
       * @param value value as bigint or number, null or undefined
       * @param bits number of bits to write
       * @returns this builder
       */
      storeMaybeInt(value, bits) {
        if (value !== null && value !== void 0) {
          this.storeBit(1);
          this.storeInt(value, bits);
        } else {
          this.storeBit(0);
        }
        return this;
      }
      /**
       * Store varuint value
       * @param value value as bigint or number
       * @param bits number of bits to write to header
       * @returns this builder
       */
      storeVarUint(value, bits) {
        this._bits.writeVarUint(value, bits);
        return this;
      }
      /**
       * Store maybe varuint value
       * @param value value as bigint or number, null or undefined
       * @param bits number of bits to write to header
       * @returns this builder
       */
      storeMaybeVarUint(value, bits) {
        if (value !== null && value !== void 0) {
          this.storeBit(1);
          this.storeVarUint(value, bits);
        } else {
          this.storeBit(0);
        }
        return this;
      }
      /**
       * Store varint value
       * @param value value as bigint or number
       * @param bits number of bits to write to header
       * @returns this builder
       */
      storeVarInt(value, bits) {
        this._bits.writeVarInt(value, bits);
        return this;
      }
      /**
       * Store maybe varint value
       * @param value value as bigint or number, null or undefined
       * @param bits number of bits to write to header
       * @returns this builder
       */
      storeMaybeVarInt(value, bits) {
        if (value !== null && value !== void 0) {
          this.storeBit(1);
          this.storeVarInt(value, bits);
        } else {
          this.storeBit(0);
        }
        return this;
      }
      /**
       * Store coins value
       * @param amount amount of coins
       * @returns this builder
       */
      storeCoins(amount) {
        this._bits.writeCoins(amount);
        return this;
      }
      /**
       * Store maybe coins value
       * @param amount amount of coins, null or undefined
       * @returns this builder
       */
      storeMaybeCoins(amount) {
        if (amount !== null && amount !== void 0) {
          this.storeBit(1);
          this.storeCoins(amount);
        } else {
          this.storeBit(0);
        }
        return this;
      }
      /**
       * Store address
       * @param addres address to store
       * @returns this builder
       */
      storeAddress(address) {
        this._bits.writeAddress(address);
        return this;
      }
      /**
       * Store reference
       * @param cell cell or builder to store
       * @returns this builder
       */
      storeRef(cell) {
        if (this._refs.length >= 4) {
          throw new Error("Too many references");
        }
        if (cell instanceof Cell_1.Cell) {
          this._refs.push(cell);
        } else if (cell instanceof _Builder) {
          this._refs.push(cell.endCell());
        } else {
          throw new Error("Invalid argument");
        }
        return this;
      }
      /**
       * Store reference if not null
       * @param cell cell or builder to store
       * @returns this builder
       */
      storeMaybeRef(cell) {
        if (cell) {
          this.storeBit(1);
          this.storeRef(cell);
        } else {
          this.storeBit(0);
        }
        return this;
      }
      /**
       * Store slice it in this builder
       * @param src source slice
       */
      storeSlice(src) {
        let c = src.clone();
        if (c.remainingBits > 0) {
          this.storeBits(c.loadBits(c.remainingBits));
        }
        while (c.remainingRefs > 0) {
          this.storeRef(c.loadRef());
        }
        return this;
      }
      /**
       * Store slice in this builder if not null
       * @param src source slice
       */
      storeMaybeSlice(src) {
        if (src) {
          this.storeBit(1);
          this.storeSlice(src);
        } else {
          this.storeBit(0);
        }
        return this;
      }
      /**
       * Store builder
       * @param src builder to store
       * @returns this builder
       */
      storeBuilder(src) {
        return this.storeSlice(src.endCell().beginParse());
      }
      /**
       * Store builder if not null
       * @param src builder to store
       * @returns this builder
       */
      storeMaybeBuilder(src) {
        if (src) {
          this.storeBit(1);
          this.storeBuilder(src);
        } else {
          this.storeBit(0);
        }
        return this;
      }
      /**
       * Store writer or builder
       * @param writer writer or builder to store
       * @returns this builder
       */
      storeWritable(writer) {
        if (typeof writer === "object") {
          writer.writeTo(this);
        } else {
          writer(this);
        }
        return this;
      }
      /**
       * Store writer or builder if not null
       * @param writer writer or builder to store
       * @returns this builder
       */
      storeMaybeWritable(writer) {
        if (writer) {
          this.storeBit(1);
          this.storeWritable(writer);
        } else {
          this.storeBit(0);
        }
        return this;
      }
      /**
       * Store object in this builder
       * @param writer Writable or writer functuin
       */
      store(writer) {
        this.storeWritable(writer);
        return this;
      }
      /**
       * Store string tail
       * @param src source string
       * @returns this builder
       */
      storeStringTail(src) {
        (0, strings_1.writeString)(src, this);
        return this;
      }
      /**
       * Store string tail
       * @param src source string
       * @returns this builder
       */
      storeMaybeStringTail(src) {
        if (src !== null && src !== void 0) {
          this.storeBit(1);
          (0, strings_1.writeString)(src, this);
        } else {
          this.storeBit(0);
        }
        return this;
      }
      /**
       * Store string tail in ref
       * @param src source string
       * @returns this builder
       */
      storeStringRefTail(src) {
        this.storeRef(beginCell2().storeStringTail(src));
        return this;
      }
      /**
       * Store maybe string tail in ref
       * @param src source string
       * @returns this builder
       */
      storeMaybeStringRefTail(src) {
        if (src !== null && src !== void 0) {
          this.storeBit(1);
          this.storeStringRefTail(src);
        } else {
          this.storeBit(0);
        }
        return this;
      }
      /**
       * Store dictionary in this builder
       * @param dict dictionary to store
       * @returns this builder
       */
      storeDict(dict, key, value) {
        if (dict) {
          dict.store(this, key, value);
        } else {
          this.storeBit(0);
        }
        return this;
      }
      /**
       * Store dictionary in this builder directly
       * @param dict dictionary to store
       * @returns this builder
       */
      storeDictDirect(dict, key, value) {
        dict.storeDirect(this, key, value);
        return this;
      }
      /**
       * Complete cell
       * @param opts options
       * @returns cell
       */
      endCell(opts) {
        return new Cell_1.Cell({
          bits: this._bits.build(),
          refs: this._refs,
          exotic: opts?.exotic
        });
      }
      /**
       * Convert to cell
       * @returns cell
       */
      asCell() {
        return this.endCell();
      }
      /**
       * Convert to slice
       * @returns slice
       */
      asSlice() {
        return this.endCell().beginParse();
      }
    };
    exports.Builder = Builder2;
  }
});

// node_modules/@ton/core/dist/types/SimpleLibrary.js
var require_SimpleLibrary = __commonJS({
  "node_modules/@ton/core/dist/types/SimpleLibrary.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SimpleLibraryValue = exports.storeSimpleLibrary = exports.loadSimpleLibrary = void 0;
    function loadSimpleLibrary(slice) {
      return {
        public: slice.loadBit(),
        root: slice.loadRef()
      };
    }
    exports.loadSimpleLibrary = loadSimpleLibrary;
    function storeSimpleLibrary(src) {
      return (builder) => {
        builder.storeBit(src.public);
        builder.storeRef(src.root);
      };
    }
    exports.storeSimpleLibrary = storeSimpleLibrary;
    exports.SimpleLibraryValue = {
      serialize(src, builder) {
        storeSimpleLibrary(src)(builder);
      },
      parse(src) {
        return loadSimpleLibrary(src);
      }
    };
  }
});

// node_modules/@ton/core/dist/types/TickTock.js
var require_TickTock = __commonJS({
  "node_modules/@ton/core/dist/types/TickTock.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeTickTock = exports.loadTickTock = void 0;
    function loadTickTock(slice) {
      return {
        tick: slice.loadBit(),
        tock: slice.loadBit()
      };
    }
    exports.loadTickTock = loadTickTock;
    function storeTickTock(src) {
      return (builder) => {
        builder.storeBit(src.tick);
        builder.storeBit(src.tock);
      };
    }
    exports.storeTickTock = storeTickTock;
  }
});

// node_modules/@ton/core/dist/types/StateInit.js
var require_StateInit = __commonJS({
  "node_modules/@ton/core/dist/types/StateInit.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeStateInit = exports.loadStateInit = void 0;
    var Dictionary_1 = require_Dictionary();
    var SimpleLibrary_1 = require_SimpleLibrary();
    var TickTock_1 = require_TickTock();
    function loadStateInit2(slice) {
      let splitDepth;
      if (slice.loadBit()) {
        splitDepth = slice.loadUint(5);
      }
      let special;
      if (slice.loadBit()) {
        special = (0, TickTock_1.loadTickTock)(slice);
      }
      let code = slice.loadMaybeRef();
      let data = slice.loadMaybeRef();
      let libraries = slice.loadDict(Dictionary_1.Dictionary.Keys.BigUint(256), SimpleLibrary_1.SimpleLibraryValue);
      if (libraries.size === 0) {
        libraries = void 0;
      }
      return {
        splitDepth,
        special,
        code,
        data,
        libraries
      };
    }
    exports.loadStateInit = loadStateInit2;
    function storeStateInit2(src) {
      return (builder) => {
        if (src.splitDepth !== null && src.splitDepth !== void 0) {
          builder.storeBit(true);
          builder.storeUint(src.splitDepth, 5);
        } else {
          builder.storeBit(false);
        }
        if (src.special !== null && src.special !== void 0) {
          builder.storeBit(true);
          builder.store((0, TickTock_1.storeTickTock)(src.special));
        } else {
          builder.storeBit(false);
        }
        builder.storeMaybeRef(src.code);
        builder.storeMaybeRef(src.data);
        builder.storeDict(src.libraries);
      };
    }
    exports.storeStateInit = storeStateInit2;
  }
});

// node_modules/@ton/core/dist/address/contractAddress.js
var require_contractAddress = __commonJS({
  "node_modules/@ton/core/dist/address/contractAddress.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.contractAddress = void 0;
    var Builder_1 = require_Builder();
    var StateInit_1 = require_StateInit();
    var Address_1 = require_Address();
    function contractAddress2(workchain, init) {
      let hash = (0, Builder_1.beginCell)().store((0, StateInit_1.storeStateInit)(init)).endCell().hash();
      return new Address_1.Address(workchain, hash);
    }
    exports.contractAddress = contractAddress2;
  }
});

// node_modules/@ton/core/dist/tuple/tuple.js
var require_tuple = __commonJS({
  "node_modules/@ton/core/dist/tuple/tuple.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.parseTuple = exports.serializeTuple = void 0;
    var Builder_1 = require_Builder();
    var INT64_MIN = BigInt("-9223372036854775808");
    var INT64_MAX = BigInt("9223372036854775807");
    function serializeTupleItem(src, builder) {
      if (src.type === "null") {
        builder.storeUint(0, 8);
      } else if (src.type === "int") {
        if (src.value <= INT64_MAX && src.value >= INT64_MIN) {
          builder.storeUint(1, 8);
          builder.storeInt(src.value, 64);
        } else {
          builder.storeUint(256, 15);
          builder.storeInt(src.value, 257);
        }
      } else if (src.type === "nan") {
        builder.storeInt(767, 16);
      } else if (src.type === "cell") {
        builder.storeUint(3, 8);
        builder.storeRef(src.cell);
      } else if (src.type === "slice") {
        builder.storeUint(4, 8);
        builder.storeUint(0, 10);
        builder.storeUint(src.cell.bits.length, 10);
        builder.storeUint(0, 3);
        builder.storeUint(src.cell.refs.length, 3);
        builder.storeRef(src.cell);
      } else if (src.type === "builder") {
        builder.storeUint(5, 8);
        builder.storeRef(src.cell);
      } else if (src.type === "tuple") {
        let head = null;
        let tail = null;
        for (let i = 0; i < src.items.length; i++) {
          let s = head;
          head = tail;
          tail = s;
          if (i > 1) {
            head = (0, Builder_1.beginCell)().storeRef(tail).storeRef(head).endCell();
          }
          let bc = (0, Builder_1.beginCell)();
          serializeTupleItem(src.items[i], bc);
          tail = bc.endCell();
        }
        builder.storeUint(7, 8);
        builder.storeUint(src.items.length, 16);
        if (head) {
          builder.storeRef(head);
        }
        if (tail) {
          builder.storeRef(tail);
        }
      } else {
        throw Error("Invalid value");
      }
    }
    function parseStackItem(cs) {
      let kind = cs.loadUint(8);
      if (kind === 0) {
        return { type: "null" };
      } else if (kind === 1) {
        return { type: "int", value: cs.loadIntBig(64) };
      } else if (kind === 2) {
        if (cs.loadUint(7) === 0) {
          return { type: "int", value: cs.loadIntBig(257) };
        } else {
          cs.loadBit();
          return { type: "nan" };
        }
      } else if (kind === 3) {
        return { type: "cell", cell: cs.loadRef() };
      } else if (kind === 4) {
        let startBits = cs.loadUint(10);
        let endBits = cs.loadUint(10);
        let startRefs = cs.loadUint(3);
        let endRefs = cs.loadUint(3);
        let rs = cs.loadRef().beginParse();
        rs.skip(startBits);
        let dt = rs.loadBits(endBits - startBits);
        let builder = (0, Builder_1.beginCell)().storeBits(dt);
        if (startRefs < endRefs) {
          for (let i = 0; i < startRefs; i++) {
            rs.loadRef();
          }
          for (let i = 0; i < endRefs - startRefs; i++) {
            builder.storeRef(rs.loadRef());
          }
        }
        return { type: "slice", cell: builder.endCell() };
      } else if (kind === 5) {
        return { type: "builder", cell: cs.loadRef() };
      } else if (kind === 7) {
        let length = cs.loadUint(16);
        let items = [];
        if (length > 1) {
          let head = cs.loadRef().beginParse();
          let tail = cs.loadRef().beginParse();
          items.unshift(parseStackItem(tail));
          for (let i = 0; i < length - 2; i++) {
            let ohead = head;
            head = ohead.loadRef().beginParse();
            tail = ohead.loadRef().beginParse();
            items.unshift(parseStackItem(tail));
          }
          items.unshift(parseStackItem(head));
        } else if (length === 1) {
          items.push(parseStackItem(cs.loadRef().beginParse()));
        }
        return { type: "tuple", items };
      } else {
        throw Error("Unsupported stack item");
      }
    }
    function serializeTupleTail(src, builder) {
      if (src.length > 0) {
        let tail = (0, Builder_1.beginCell)();
        serializeTupleTail(src.slice(0, src.length - 1), tail);
        builder.storeRef(tail.endCell());
        serializeTupleItem(src[src.length - 1], builder);
      }
    }
    function serializeTuple(src) {
      let builder = (0, Builder_1.beginCell)();
      builder.storeUint(src.length, 24);
      let r = [...src];
      serializeTupleTail(r, builder);
      return builder.endCell();
    }
    exports.serializeTuple = serializeTuple;
    function parseTuple(src) {
      let res = [];
      let cs = src.beginParse();
      let size = cs.loadUint(24);
      for (let i = 0; i < size; i++) {
        let next = cs.loadRef();
        res.unshift(parseStackItem(cs));
        cs = next.beginParse();
      }
      return res;
    }
    exports.parseTuple = parseTuple;
  }
});

// node_modules/@ton/core/dist/tuple/reader.js
var require_reader = __commonJS({
  "node_modules/@ton/core/dist/tuple/reader.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TupleReader = void 0;
    var TupleReader = class _TupleReader {
      constructor(items) {
        this.items = [...items];
      }
      get remaining() {
        return this.items.length;
      }
      peek() {
        if (this.items.length === 0) {
          throw Error("EOF");
        }
        return this.items[0];
      }
      pop() {
        if (this.items.length === 0) {
          throw Error("EOF");
        }
        let res = this.items[0];
        this.items.splice(0, 1);
        return res;
      }
      skip(num = 1) {
        for (let i = 0; i < num; i++) {
          this.pop();
        }
        return this;
      }
      readBigNumber() {
        let popped = this.pop();
        if (popped.type !== "int") {
          throw Error("Not a number");
        }
        return popped.value;
      }
      readBigNumberOpt() {
        let popped = this.pop();
        if (popped.type === "null") {
          return null;
        }
        if (popped.type !== "int") {
          throw Error("Not a number");
        }
        return popped.value;
      }
      readNumber() {
        return Number(this.readBigNumber());
      }
      readNumberOpt() {
        let r = this.readBigNumberOpt();
        if (r !== null) {
          return Number(r);
        } else {
          return null;
        }
      }
      readBoolean() {
        let res = this.readNumber();
        return res === 0 ? false : true;
      }
      readBooleanOpt() {
        let res = this.readNumberOpt();
        if (res !== null) {
          return res === 0 ? false : true;
        } else {
          return null;
        }
      }
      readAddress() {
        let r = this.readCell().beginParse().loadAddress();
        if (r !== null) {
          return r;
        } else {
          throw Error("Not an address");
        }
      }
      readAddressOpt() {
        let r = this.readCellOpt();
        if (r !== null) {
          return r.beginParse().loadMaybeAddress();
        } else {
          return null;
        }
      }
      readCell() {
        let popped = this.pop();
        if (popped.type !== "cell" && popped.type !== "slice" && popped.type !== "builder") {
          throw Error("Not a cell: " + popped.type);
        }
        return popped.cell;
      }
      readCellOpt() {
        let popped = this.pop();
        if (popped.type === "null") {
          return null;
        }
        if (popped.type !== "cell" && popped.type !== "slice" && popped.type !== "builder") {
          throw Error("Not a cell");
        }
        return popped.cell;
      }
      readTuple() {
        let popped = this.pop();
        if (popped.type !== "tuple") {
          throw Error("Not a tuple");
        }
        return new _TupleReader(popped.items);
      }
      readTupleOpt() {
        let popped = this.pop();
        if (popped.type === "null") {
          return null;
        }
        if (popped.type !== "tuple") {
          throw Error("Not a tuple");
        }
        return new _TupleReader(popped.items);
      }
      static readLispList(reader) {
        const result = [];
        let tail = reader;
        while (tail !== null) {
          var head = tail.pop();
          if (tail.items.length === 0 || tail.items[0].type !== "tuple" && tail.items[0].type !== "null") {
            throw Error("Lisp list consists only from (any, tuple) elements and ends with null");
          }
          tail = tail.readTupleOpt();
          result.push(head);
        }
        return result;
      }
      readLispListDirect() {
        if (this.items.length === 1 && this.items[0].type === "null") {
          return [];
        }
        return _TupleReader.readLispList(this);
      }
      readLispList() {
        return _TupleReader.readLispList(this.readTupleOpt());
      }
      readBuffer() {
        let s = this.readCell().beginParse();
        if (s.remainingRefs !== 0) {
          throw Error("Not a buffer");
        }
        if (s.remainingBits % 8 !== 0) {
          throw Error("Not a buffer");
        }
        return s.loadBuffer(s.remainingBits / 8);
      }
      readBufferOpt() {
        let r = this.readCellOpt();
        if (r !== null) {
          let s = r.beginParse();
          if (s.remainingRefs !== 0 || s.remainingBits % 8 !== 0) {
            throw Error("Not a buffer");
          }
          return s.loadBuffer(s.remainingBits / 8);
        } else {
          return null;
        }
      }
      readString() {
        let s = this.readCell().beginParse();
        return s.loadStringTail();
      }
      readStringOpt() {
        let r = this.readCellOpt();
        if (r !== null) {
          let s = r.beginParse();
          return s.loadStringTail();
        } else {
          return null;
        }
      }
    };
    exports.TupleReader = TupleReader;
  }
});

// node_modules/@ton/core/dist/tuple/builder.js
var require_builder = __commonJS({
  "node_modules/@ton/core/dist/tuple/builder.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TupleBuilder = void 0;
    var Builder_1 = require_Builder();
    var Cell_1 = require_Cell();
    var Slice_1 = require_Slice();
    var TupleBuilder = class {
      constructor() {
        this._tuple = [];
      }
      writeNumber(v) {
        if (v === null || v === void 0) {
          this._tuple.push({ type: "null" });
        } else {
          this._tuple.push({ type: "int", value: BigInt(v) });
        }
      }
      writeBoolean(v) {
        if (v === null || v === void 0) {
          this._tuple.push({ type: "null" });
        } else {
          this._tuple.push({ type: "int", value: v ? -1n : 0n });
        }
      }
      writeBuffer(v) {
        if (v === null || v === void 0) {
          this._tuple.push({ type: "null" });
        } else {
          this._tuple.push({ type: "slice", cell: (0, Builder_1.beginCell)().storeBuffer(v).endCell() });
        }
      }
      writeString(v) {
        if (v === null || v === void 0) {
          this._tuple.push({ type: "null" });
        } else {
          this._tuple.push({ type: "slice", cell: (0, Builder_1.beginCell)().storeStringTail(v).endCell() });
        }
      }
      writeCell(v) {
        if (v === null || v === void 0) {
          this._tuple.push({ type: "null" });
        } else {
          if (v instanceof Cell_1.Cell) {
            this._tuple.push({ type: "cell", cell: v });
          } else if (v instanceof Slice_1.Slice) {
            this._tuple.push({ type: "cell", cell: v.asCell() });
          }
        }
      }
      writeSlice(v) {
        if (v === null || v === void 0) {
          this._tuple.push({ type: "null" });
        } else {
          if (v instanceof Cell_1.Cell) {
            this._tuple.push({ type: "slice", cell: v });
          } else if (v instanceof Slice_1.Slice) {
            this._tuple.push({ type: "slice", cell: v.asCell() });
          }
        }
      }
      writeBuilder(v) {
        if (v === null || v === void 0) {
          this._tuple.push({ type: "null" });
        } else {
          if (v instanceof Cell_1.Cell) {
            this._tuple.push({ type: "builder", cell: v });
          } else if (v instanceof Slice_1.Slice) {
            this._tuple.push({ type: "builder", cell: v.asCell() });
          }
        }
      }
      writeTuple(v) {
        if (v === null || v === void 0) {
          this._tuple.push({ type: "null" });
        } else {
          this._tuple.push({ type: "tuple", items: v });
        }
      }
      writeAddress(v) {
        if (v === null || v === void 0) {
          this._tuple.push({ type: "null" });
        } else {
          this._tuple.push({ type: "slice", cell: (0, Builder_1.beginCell)().storeAddress(v).endCell() });
        }
      }
      build() {
        return [...this._tuple];
      }
    };
    exports.TupleBuilder = TupleBuilder;
  }
});

// node_modules/@ton/core/dist/utils/convert.js
var require_convert = __commonJS({
  "node_modules/@ton/core/dist/utils/convert.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.fromNano = exports.toNano = void 0;
    function toNano(src) {
      if (typeof src === "bigint") {
        return src * 1000000000n;
      } else {
        if (typeof src === "number") {
          if (!Number.isFinite(src)) {
            throw Error("Invalid number");
          }
          if (Math.log10(src) <= 6) {
            src = src.toLocaleString("en", { minimumFractionDigits: 9, useGrouping: false });
          } else if (src - Math.trunc(src) === 0) {
            src = src.toLocaleString("en", { maximumFractionDigits: 0, useGrouping: false });
          } else {
            throw Error("Not enough precision for a number value. Use string value instead");
          }
        }
        let neg = false;
        while (src.startsWith("-")) {
          neg = !neg;
          src = src.slice(1);
        }
        if (src === ".") {
          throw Error("Invalid number");
        }
        let parts = src.split(".");
        if (parts.length > 2) {
          throw Error("Invalid number");
        }
        let whole = parts[0];
        let frac = parts[1];
        if (!whole) {
          whole = "0";
        }
        if (!frac) {
          frac = "0";
        }
        if (frac.length > 9) {
          throw Error("Invalid number");
        }
        while (frac.length < 9) {
          frac += "0";
        }
        let r = BigInt(whole) * 1000000000n + BigInt(frac);
        if (neg) {
          r = -r;
        }
        return r;
      }
    }
    exports.toNano = toNano;
    function fromNano(src) {
      let v = BigInt(src);
      let neg = false;
      if (v < 0) {
        neg = true;
        v = -v;
      }
      let frac = v % 1000000000n;
      let facStr = frac.toString();
      while (facStr.length < 9) {
        facStr = "0" + facStr;
      }
      facStr = facStr.match(/^([0-9]*[1-9]|0)(0*)/)[1];
      let whole = v / 1000000000n;
      let wholeStr = whole.toString();
      let value = `${wholeStr}${facStr === "0" ? "" : `.${facStr}`}`;
      if (neg) {
        value = "-" + value;
      }
      return value;
    }
    exports.fromNano = fromNano;
  }
});

// node_modules/@ton/core/dist/types/_helpers.js
var require_helpers = __commonJS({
  "node_modules/@ton/core/dist/types/_helpers.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.comment = exports.external = exports.internal = void 0;
    var Address_1 = require_Address();
    var Cell_1 = require_Cell();
    var Builder_1 = require_Builder();
    var convert_1 = require_convert();
    function internal2(src) {
      let bounce = true;
      if (src.bounce !== null && src.bounce !== void 0) {
        bounce = src.bounce;
      }
      let to;
      if (typeof src.to === "string") {
        to = Address_1.Address.parse(src.to);
      } else if (Address_1.Address.isAddress(src.to)) {
        to = src.to;
      } else {
        throw new Error(`Invalid address ${src.to}`);
      }
      let value;
      if (typeof src.value === "string") {
        value = (0, convert_1.toNano)(src.value);
      } else {
        value = src.value;
      }
      let body = Cell_1.Cell.EMPTY;
      if (typeof src.body === "string") {
        body = (0, Builder_1.beginCell)().storeUint(0, 32).storeStringTail(src.body).endCell();
      } else if (src.body) {
        body = src.body;
      }
      return {
        info: {
          type: "internal",
          dest: to,
          value: { coins: value },
          bounce,
          ihrDisabled: true,
          bounced: false,
          ihrFee: 0n,
          forwardFee: 0n,
          createdAt: 0,
          createdLt: 0n
        },
        init: src.init ?? void 0,
        body
      };
    }
    exports.internal = internal2;
    function external2(src) {
      let to;
      if (typeof src.to === "string") {
        to = Address_1.Address.parse(src.to);
      } else if (Address_1.Address.isAddress(src.to)) {
        to = src.to;
      } else {
        throw new Error(`Invalid address ${src.to}`);
      }
      return {
        info: {
          type: "external-in",
          dest: to,
          importFee: 0n
        },
        init: src.init ?? void 0,
        body: src.body || Cell_1.Cell.EMPTY
      };
    }
    exports.external = external2;
    function comment2(src) {
      return (0, Builder_1.beginCell)().storeUint(0, 32).storeStringTail(src).endCell();
    }
    exports.comment = comment2;
  }
});

// node_modules/@ton/core/dist/types/AccountState.js
var require_AccountState = __commonJS({
  "node_modules/@ton/core/dist/types/AccountState.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeAccountState = exports.loadAccountState = void 0;
    var StateInit_1 = require_StateInit();
    function loadAccountState(cs) {
      if (cs.loadBit()) {
        return { type: "active", state: (0, StateInit_1.loadStateInit)(cs) };
      } else if (cs.loadBit()) {
        return { type: "frozen", stateHash: cs.loadUintBig(256) };
      } else {
        return { type: "uninit" };
      }
    }
    exports.loadAccountState = loadAccountState;
    function storeAccountState(src) {
      return (builder) => {
        if (src.type === "active") {
          builder.storeBit(true);
          builder.store((0, StateInit_1.storeStateInit)(src.state));
        } else if (src.type === "frozen") {
          builder.storeBit(false);
          builder.storeBit(true);
          builder.storeUint(src.stateHash, 256);
        } else if (src.type === "uninit") {
          builder.storeBit(false);
          builder.storeBit(false);
        }
      };
    }
    exports.storeAccountState = storeAccountState;
  }
});

// node_modules/@ton/core/dist/types/CurrencyCollection.js
var require_CurrencyCollection = __commonJS({
  "node_modules/@ton/core/dist/types/CurrencyCollection.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeCurrencyCollection = exports.loadCurrencyCollection = void 0;
    var Dictionary_1 = require_Dictionary();
    function loadCurrencyCollection(slice) {
      const coins = slice.loadCoins();
      const other = slice.loadDict(Dictionary_1.Dictionary.Keys.Uint(32), Dictionary_1.Dictionary.Values.BigVarUint(
        5
        /* log2(32) */
      ));
      if (other.size === 0) {
        return { coins };
      } else {
        return { other, coins };
      }
    }
    exports.loadCurrencyCollection = loadCurrencyCollection;
    function storeCurrencyCollection(collection) {
      return (builder) => {
        builder.storeCoins(collection.coins);
        if (collection.other) {
          builder.storeDict(collection.other);
        } else {
          builder.storeBit(0);
        }
      };
    }
    exports.storeCurrencyCollection = storeCurrencyCollection;
  }
});

// node_modules/@ton/core/dist/types/AccountStorage.js
var require_AccountStorage = __commonJS({
  "node_modules/@ton/core/dist/types/AccountStorage.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeAccountStorage = exports.loadAccountStorage = void 0;
    var AccountState_1 = require_AccountState();
    var CurrencyCollection_1 = require_CurrencyCollection();
    function loadAccountStorage(slice) {
      return {
        lastTransLt: slice.loadUintBig(64),
        balance: (0, CurrencyCollection_1.loadCurrencyCollection)(slice),
        state: (0, AccountState_1.loadAccountState)(slice)
      };
    }
    exports.loadAccountStorage = loadAccountStorage;
    function storeAccountStorage(src) {
      return (builder) => {
        builder.storeUint(src.lastTransLt, 64);
        builder.store((0, CurrencyCollection_1.storeCurrencyCollection)(src.balance));
        builder.store((0, AccountState_1.storeAccountState)(src.state));
      };
    }
    exports.storeAccountStorage = storeAccountStorage;
  }
});

// node_modules/@ton/core/dist/types/StorageUsed.js
var require_StorageUsed = __commonJS({
  "node_modules/@ton/core/dist/types/StorageUsed.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeStorageUsed = exports.loadStorageUsed = void 0;
    function loadStorageUsed(cs) {
      return {
        cells: cs.loadVarUintBig(3),
        bits: cs.loadVarUintBig(3),
        publicCells: cs.loadVarUintBig(3)
      };
    }
    exports.loadStorageUsed = loadStorageUsed;
    function storeStorageUsed(src) {
      return (builder) => {
        builder.storeVarUint(src.cells, 3);
        builder.storeVarUint(src.bits, 3);
        builder.storeVarUint(src.publicCells, 3);
      };
    }
    exports.storeStorageUsed = storeStorageUsed;
  }
});

// node_modules/@ton/core/dist/types/StorageInto.js
var require_StorageInto = __commonJS({
  "node_modules/@ton/core/dist/types/StorageInto.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeStorageInfo = exports.loadStorageInfo = void 0;
    var StorageUsed_1 = require_StorageUsed();
    function loadStorageInfo(slice) {
      return {
        used: (0, StorageUsed_1.loadStorageUsed)(slice),
        lastPaid: slice.loadUint(32),
        duePayment: slice.loadMaybeCoins()
      };
    }
    exports.loadStorageInfo = loadStorageInfo;
    function storeStorageInfo(src) {
      return (builder) => {
        builder.store((0, StorageUsed_1.storeStorageUsed)(src.used));
        builder.storeUint(src.lastPaid, 32);
        builder.storeMaybeCoins(src.duePayment);
      };
    }
    exports.storeStorageInfo = storeStorageInfo;
  }
});

// node_modules/@ton/core/dist/types/Account.js
var require_Account = __commonJS({
  "node_modules/@ton/core/dist/types/Account.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeAccount = exports.loadAccount = void 0;
    var AccountStorage_1 = require_AccountStorage();
    var StorageInto_1 = require_StorageInto();
    function loadAccount(slice) {
      return {
        addr: slice.loadAddress(),
        storageStats: (0, StorageInto_1.loadStorageInfo)(slice),
        storage: (0, AccountStorage_1.loadAccountStorage)(slice)
      };
    }
    exports.loadAccount = loadAccount;
    function storeAccount(src) {
      return (builder) => {
        builder.storeAddress(src.addr);
        builder.store((0, StorageInto_1.storeStorageInfo)(src.storageStats));
        builder.store((0, AccountStorage_1.storeAccountStorage)(src.storage));
      };
    }
    exports.storeAccount = storeAccount;
  }
});

// node_modules/@ton/core/dist/types/AccountStatus.js
var require_AccountStatus = __commonJS({
  "node_modules/@ton/core/dist/types/AccountStatus.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeAccountStatus = exports.loadAccountStatus = void 0;
    function loadAccountStatus(slice) {
      const status = slice.loadUint(2);
      if (status === 0) {
        return "uninitialized";
      }
      if (status === 1) {
        return "frozen";
      }
      if (status === 2) {
        return "active";
      }
      if (status === 3) {
        return "non-existing";
      }
      throw Error("Invalid data");
    }
    exports.loadAccountStatus = loadAccountStatus;
    function storeAccountStatus(src) {
      return (builder) => {
        if (src === "uninitialized") {
          builder.storeUint(0, 2);
        } else if (src === "frozen") {
          builder.storeUint(1, 2);
        } else if (src === "active") {
          builder.storeUint(2, 2);
        } else if (src === "non-existing") {
          builder.storeUint(3, 2);
        } else {
          throw Error("Invalid data");
        }
        return builder;
      };
    }
    exports.storeAccountStatus = storeAccountStatus;
  }
});

// node_modules/@ton/core/dist/types/AccountStatusChange.js
var require_AccountStatusChange = __commonJS({
  "node_modules/@ton/core/dist/types/AccountStatusChange.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeAccountStatusChange = exports.loadAccountStatusChange = void 0;
    function loadAccountStatusChange(slice) {
      if (!slice.loadBit()) {
        return "unchanged";
      }
      if (slice.loadBit()) {
        return "deleted";
      } else {
        return "frozen";
      }
    }
    exports.loadAccountStatusChange = loadAccountStatusChange;
    function storeAccountStatusChange(src) {
      return (builder) => {
        if (src == "unchanged") {
          builder.storeBit(0);
        } else if (src === "frozen") {
          builder.storeBit(1);
          builder.storeBit(0);
        } else if (src === "deleted") {
          builder.storeBit(1);
          builder.storeBit(1);
        } else {
          throw Error("Invalid account status change");
        }
      };
    }
    exports.storeAccountStatusChange = storeAccountStatusChange;
  }
});

// node_modules/@ton/core/dist/types/CommonMessageInfoRelaxed.js
var require_CommonMessageInfoRelaxed = __commonJS({
  "node_modules/@ton/core/dist/types/CommonMessageInfoRelaxed.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeCommonMessageInfoRelaxed = exports.loadCommonMessageInfoRelaxed = void 0;
    var CurrencyCollection_1 = require_CurrencyCollection();
    function loadCommonMessageInfoRelaxed(slice) {
      if (!slice.loadBit()) {
        const ihrDisabled = slice.loadBit();
        const bounce = slice.loadBit();
        const bounced = slice.loadBit();
        const src2 = slice.loadMaybeAddress();
        const dest2 = slice.loadAddress();
        const value = (0, CurrencyCollection_1.loadCurrencyCollection)(slice);
        const ihrFee = slice.loadCoins();
        const forwardFee = slice.loadCoins();
        const createdLt2 = slice.loadUintBig(64);
        const createdAt2 = slice.loadUint(32);
        return {
          type: "internal",
          ihrDisabled,
          bounce,
          bounced,
          src: src2,
          dest: dest2,
          value,
          ihrFee,
          forwardFee,
          createdLt: createdLt2,
          createdAt: createdAt2
        };
      }
      if (!slice.loadBit()) {
        throw Error("External In message is not possible for CommonMessageInfoRelaxed");
      }
      const src = slice.loadMaybeAddress();
      const dest = slice.loadMaybeExternalAddress();
      const createdLt = slice.loadUintBig(64);
      const createdAt = slice.loadUint(32);
      return {
        type: "external-out",
        src,
        dest,
        createdLt,
        createdAt
      };
    }
    exports.loadCommonMessageInfoRelaxed = loadCommonMessageInfoRelaxed;
    function storeCommonMessageInfoRelaxed(source) {
      return (builder) => {
        if (source.type === "internal") {
          builder.storeBit(0);
          builder.storeBit(source.ihrDisabled);
          builder.storeBit(source.bounce);
          builder.storeBit(source.bounced);
          builder.storeAddress(source.src);
          builder.storeAddress(source.dest);
          builder.store((0, CurrencyCollection_1.storeCurrencyCollection)(source.value));
          builder.storeCoins(source.ihrFee);
          builder.storeCoins(source.forwardFee);
          builder.storeUint(source.createdLt, 64);
          builder.storeUint(source.createdAt, 32);
        } else if (source.type === "external-out") {
          builder.storeBit(1);
          builder.storeBit(1);
          builder.storeAddress(source.src);
          builder.storeAddress(source.dest);
          builder.storeUint(source.createdLt, 64);
          builder.storeUint(source.createdAt, 32);
        } else {
          throw new Error("Unknown CommonMessageInfo type");
        }
      };
    }
    exports.storeCommonMessageInfoRelaxed = storeCommonMessageInfoRelaxed;
  }
});

// node_modules/@ton/core/dist/types/MessageRelaxed.js
var require_MessageRelaxed = __commonJS({
  "node_modules/@ton/core/dist/types/MessageRelaxed.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeMessageRelaxed = exports.loadMessageRelaxed = void 0;
    var Builder_1 = require_Builder();
    var CommonMessageInfoRelaxed_1 = require_CommonMessageInfoRelaxed();
    var StateInit_1 = require_StateInit();
    function loadMessageRelaxed2(slice) {
      const info = (0, CommonMessageInfoRelaxed_1.loadCommonMessageInfoRelaxed)(slice);
      let init = null;
      if (slice.loadBit()) {
        if (!slice.loadBit()) {
          init = (0, StateInit_1.loadStateInit)(slice);
        } else {
          init = (0, StateInit_1.loadStateInit)(slice.loadRef().beginParse());
        }
      }
      const body = slice.loadBit() ? slice.loadRef() : slice.asCell();
      return {
        info,
        init,
        body
      };
    }
    exports.loadMessageRelaxed = loadMessageRelaxed2;
    function storeMessageRelaxed2(message, opts) {
      return (builder) => {
        builder.store((0, CommonMessageInfoRelaxed_1.storeCommonMessageInfoRelaxed)(message.info));
        if (message.init) {
          builder.storeBit(true);
          let initCell = (0, Builder_1.beginCell)().store((0, StateInit_1.storeStateInit)(message.init));
          let needRef2 = false;
          if (opts && opts.forceRef) {
            needRef2 = true;
          } else {
            if (builder.availableBits - 2 >= initCell.bits) {
              needRef2 = false;
            } else {
              needRef2 = true;
            }
          }
          if (needRef2) {
            builder.storeBit(true);
            builder.storeRef(initCell);
          } else {
            builder.storeBit(false);
            builder.storeBuilder(initCell);
          }
        } else {
          builder.storeBit(false);
        }
        let needRef = false;
        if (opts && opts.forceRef) {
          needRef = true;
        } else {
          if (builder.availableBits - 1 >= message.body.bits.length && builder.refs + message.body.refs.length <= 4 && !message.body.isExotic) {
            needRef = false;
          } else {
            needRef = true;
          }
        }
        if (needRef) {
          builder.storeBit(true);
          builder.storeRef(message.body);
        } else {
          builder.storeBit(false);
          builder.storeBuilder(message.body.asBuilder());
        }
      };
    }
    exports.storeMessageRelaxed = storeMessageRelaxed2;
  }
});

// node_modules/@ton/core/dist/types/LibRef.js
var require_LibRef = __commonJS({
  "node_modules/@ton/core/dist/types/LibRef.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeLibRef = exports.loadLibRef = void 0;
    function loadLibRef(slice) {
      const type = slice.loadUint(1);
      if (type === 0) {
        return {
          type: "hash",
          libHash: slice.loadBuffer(32)
        };
      } else {
        return {
          type: "ref",
          library: slice.loadRef()
        };
      }
    }
    exports.loadLibRef = loadLibRef;
    function storeLibRef(src) {
      return (builder) => {
        if (src.type === "hash") {
          builder.storeUint(0, 1);
          builder.storeBuffer(src.libHash);
        } else {
          builder.storeUint(1, 1);
          builder.storeRef(src.library);
        }
      };
    }
    exports.storeLibRef = storeLibRef;
  }
});

// node_modules/@ton/core/dist/types/OutList.js
var require_OutList = __commonJS({
  "node_modules/@ton/core/dist/types/OutList.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.loadOutList = exports.storeOutList = exports.loadOutAction = exports.storeOutAction = void 0;
    var MessageRelaxed_1 = require_MessageRelaxed();
    var Builder_1 = require_Builder();
    var CurrencyCollection_1 = require_CurrencyCollection();
    var LibRef_1 = require_LibRef();
    function storeOutAction(action) {
      switch (action.type) {
        case "sendMsg":
          return storeOutActionSendMsg(action);
        case "setCode":
          return storeOutActionSetCode(action);
        case "reserve":
          return storeOutActionReserve(action);
        case "changeLibrary":
          return storeOutActionChangeLibrary(action);
        default:
          throw new Error(`Unknown action type ${action.type}`);
      }
    }
    exports.storeOutAction = storeOutAction;
    var outActionSendMsgTag = 247711853;
    function storeOutActionSendMsg(action) {
      return (builder) => {
        builder.storeUint(outActionSendMsgTag, 32).storeUint(action.mode, 8).storeRef((0, Builder_1.beginCell)().store((0, MessageRelaxed_1.storeMessageRelaxed)(action.outMsg)).endCell());
      };
    }
    var outActionSetCodeTag = 2907562126;
    function storeOutActionSetCode(action) {
      return (builder) => {
        builder.storeUint(outActionSetCodeTag, 32).storeRef(action.newCode);
      };
    }
    var outActionReserveTag = 921090057;
    function storeOutActionReserve(action) {
      return (builder) => {
        builder.storeUint(outActionReserveTag, 32).storeUint(action.mode, 8).store((0, CurrencyCollection_1.storeCurrencyCollection)(action.currency));
      };
    }
    var outActionChangeLibraryTag = 653925844;
    function storeOutActionChangeLibrary(action) {
      return (builder) => {
        builder.storeUint(outActionChangeLibraryTag, 32).storeUint(action.mode, 7).store((0, LibRef_1.storeLibRef)(action.libRef));
      };
    }
    function loadOutAction(slice) {
      const tag = slice.loadUint(32);
      if (tag === outActionSendMsgTag) {
        const mode = slice.loadUint(8);
        const outMsg = (0, MessageRelaxed_1.loadMessageRelaxed)(slice.loadRef().beginParse());
        return {
          type: "sendMsg",
          mode,
          outMsg
        };
      }
      if (tag === outActionSetCodeTag) {
        const newCode = slice.loadRef();
        return {
          type: "setCode",
          newCode
        };
      }
      if (tag === outActionReserveTag) {
        const mode = slice.loadUint(8);
        const currency = (0, CurrencyCollection_1.loadCurrencyCollection)(slice);
        return {
          type: "reserve",
          mode,
          currency
        };
      }
      if (tag === outActionChangeLibraryTag) {
        const mode = slice.loadUint(7);
        const libRef = (0, LibRef_1.loadLibRef)(slice);
        return {
          type: "changeLibrary",
          mode,
          libRef
        };
      }
      throw new Error(`Unknown out action tag 0x${tag.toString(16)}`);
    }
    exports.loadOutAction = loadOutAction;
    function storeOutList(actions) {
      const cell = actions.reduce((cell2, action) => (0, Builder_1.beginCell)().storeRef(cell2).store(storeOutAction(action)).endCell(), (0, Builder_1.beginCell)().endCell());
      return (builder) => {
        builder.storeSlice(cell.beginParse());
      };
    }
    exports.storeOutList = storeOutList;
    function loadOutList(slice) {
      const actions = [];
      while (slice.remainingRefs) {
        const nextCell = slice.loadRef();
        actions.push(loadOutAction(slice));
        slice = nextCell.beginParse();
      }
      return actions.reverse();
    }
    exports.loadOutList = loadOutList;
  }
});

// node_modules/@ton/core/dist/types/CommonMessageInfo.js
var require_CommonMessageInfo = __commonJS({
  "node_modules/@ton/core/dist/types/CommonMessageInfo.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeCommonMessageInfo = exports.loadCommonMessageInfo = void 0;
    var CurrencyCollection_1 = require_CurrencyCollection();
    function loadCommonMessageInfo(slice) {
      if (!slice.loadBit()) {
        const ihrDisabled = slice.loadBit();
        const bounce = slice.loadBit();
        const bounced = slice.loadBit();
        const src2 = slice.loadAddress();
        const dest2 = slice.loadAddress();
        const value = (0, CurrencyCollection_1.loadCurrencyCollection)(slice);
        const ihrFee = slice.loadCoins();
        const forwardFee = slice.loadCoins();
        const createdLt2 = slice.loadUintBig(64);
        const createdAt2 = slice.loadUint(32);
        return {
          type: "internal",
          ihrDisabled,
          bounce,
          bounced,
          src: src2,
          dest: dest2,
          value,
          ihrFee,
          forwardFee,
          createdLt: createdLt2,
          createdAt: createdAt2
        };
      }
      if (!slice.loadBit()) {
        const src2 = slice.loadMaybeExternalAddress();
        const dest2 = slice.loadAddress();
        const importFee = slice.loadCoins();
        return {
          type: "external-in",
          src: src2,
          dest: dest2,
          importFee
        };
      }
      const src = slice.loadAddress();
      const dest = slice.loadMaybeExternalAddress();
      const createdLt = slice.loadUintBig(64);
      const createdAt = slice.loadUint(32);
      return {
        type: "external-out",
        src,
        dest,
        createdLt,
        createdAt
      };
    }
    exports.loadCommonMessageInfo = loadCommonMessageInfo;
    function storeCommonMessageInfo(source) {
      return (builder) => {
        if (source.type === "internal") {
          builder.storeBit(0);
          builder.storeBit(source.ihrDisabled);
          builder.storeBit(source.bounce);
          builder.storeBit(source.bounced);
          builder.storeAddress(source.src);
          builder.storeAddress(source.dest);
          builder.store((0, CurrencyCollection_1.storeCurrencyCollection)(source.value));
          builder.storeCoins(source.ihrFee);
          builder.storeCoins(source.forwardFee);
          builder.storeUint(source.createdLt, 64);
          builder.storeUint(source.createdAt, 32);
        } else if (source.type === "external-in") {
          builder.storeBit(1);
          builder.storeBit(0);
          builder.storeAddress(source.src);
          builder.storeAddress(source.dest);
          builder.storeCoins(source.importFee);
        } else if (source.type === "external-out") {
          builder.storeBit(1);
          builder.storeBit(1);
          builder.storeAddress(source.src);
          builder.storeAddress(source.dest);
          builder.storeUint(source.createdLt, 64);
          builder.storeUint(source.createdAt, 32);
        } else {
          throw new Error("Unknown CommonMessageInfo type");
        }
      };
    }
    exports.storeCommonMessageInfo = storeCommonMessageInfo;
  }
});

// node_modules/@ton/core/dist/types/ComputeSkipReason.js
var require_ComputeSkipReason = __commonJS({
  "node_modules/@ton/core/dist/types/ComputeSkipReason.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeComputeSkipReason = exports.loadComputeSkipReason = void 0;
    function loadComputeSkipReason(slice) {
      let reason = slice.loadUint(2);
      if (reason === 0) {
        return "no-state";
      } else if (reason === 1) {
        return "bad-state";
      } else if (reason === 2) {
        return "no-gas";
      }
      throw new Error(`Unknown ComputeSkipReason: ${reason}`);
    }
    exports.loadComputeSkipReason = loadComputeSkipReason;
    function storeComputeSkipReason(src) {
      return (builder) => {
        if (src === "no-state") {
          builder.storeUint(0, 2);
        } else if (src === "bad-state") {
          builder.storeUint(1, 2);
        } else if (src === "no-gas") {
          builder.storeUint(2, 2);
        } else {
          throw new Error(`Unknown ComputeSkipReason: ${src}`);
        }
      };
    }
    exports.storeComputeSkipReason = storeComputeSkipReason;
  }
});

// node_modules/@ton/core/dist/types/DepthBalanceInfo.js
var require_DepthBalanceInfo = __commonJS({
  "node_modules/@ton/core/dist/types/DepthBalanceInfo.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeDepthBalanceInfo = exports.loadDepthBalanceInfo = void 0;
    var CurrencyCollection_1 = require_CurrencyCollection();
    function loadDepthBalanceInfo(slice) {
      let splitDepth = slice.loadUint(5);
      return {
        splitDepth,
        balance: (0, CurrencyCollection_1.loadCurrencyCollection)(slice)
      };
    }
    exports.loadDepthBalanceInfo = loadDepthBalanceInfo;
    function storeDepthBalanceInfo(src) {
      return (builder) => {
        builder.storeUint(src.splitDepth, 5);
        builder.store((0, CurrencyCollection_1.storeCurrencyCollection)(src.balance));
      };
    }
    exports.storeDepthBalanceInfo = storeDepthBalanceInfo;
  }
});

// node_modules/@ton/core/dist/types/HashUpdate.js
var require_HashUpdate = __commonJS({
  "node_modules/@ton/core/dist/types/HashUpdate.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeHashUpdate = exports.loadHashUpdate = void 0;
    function loadHashUpdate(slice) {
      if (slice.loadUint(8) !== 114) {
        throw Error("Invalid data");
      }
      const oldHash = slice.loadBuffer(32);
      const newHash = slice.loadBuffer(32);
      return { oldHash, newHash };
    }
    exports.loadHashUpdate = loadHashUpdate;
    function storeHashUpdate(src) {
      return (builder) => {
        builder.storeUint(114, 8);
        builder.storeBuffer(src.oldHash);
        builder.storeBuffer(src.newHash);
      };
    }
    exports.storeHashUpdate = storeHashUpdate;
  }
});

// node_modules/@ton/core/dist/types/MasterchainStateExtra.js
var require_MasterchainStateExtra = __commonJS({
  "node_modules/@ton/core/dist/types/MasterchainStateExtra.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.loadMasterchainStateExtra = void 0;
    var Dictionary_1 = require_Dictionary();
    var CurrencyCollection_1 = require_CurrencyCollection();
    function loadMasterchainStateExtra(cs) {
      if (cs.loadUint(16) !== 52262) {
        throw Error("Invalid data");
      }
      if (cs.loadBit()) {
        cs.loadRef();
      }
      let configAddress = cs.loadUintBig(256);
      let config = Dictionary_1.Dictionary.load(Dictionary_1.Dictionary.Keys.Int(32), Dictionary_1.Dictionary.Values.Cell(), cs);
      const globalBalance = (0, CurrencyCollection_1.loadCurrencyCollection)(cs);
      return {
        config,
        configAddress,
        globalBalance
      };
    }
    exports.loadMasterchainStateExtra = loadMasterchainStateExtra;
  }
});

// node_modules/@ton/core/dist/types/Message.js
var require_Message = __commonJS({
  "node_modules/@ton/core/dist/types/Message.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MessageValue = exports.storeMessage = exports.loadMessage = void 0;
    var Builder_1 = require_Builder();
    var CommonMessageInfo_1 = require_CommonMessageInfo();
    var StateInit_1 = require_StateInit();
    function loadMessage(slice) {
      const info = (0, CommonMessageInfo_1.loadCommonMessageInfo)(slice);
      let init = null;
      if (slice.loadBit()) {
        if (!slice.loadBit()) {
          init = (0, StateInit_1.loadStateInit)(slice);
        } else {
          init = (0, StateInit_1.loadStateInit)(slice.loadRef().beginParse());
        }
      }
      const body = slice.loadBit() ? slice.loadRef() : slice.asCell();
      return {
        info,
        init,
        body
      };
    }
    exports.loadMessage = loadMessage;
    function storeMessage2(message, opts) {
      return (builder) => {
        builder.store((0, CommonMessageInfo_1.storeCommonMessageInfo)(message.info));
        if (message.init) {
          builder.storeBit(true);
          let initCell = (0, Builder_1.beginCell)().store((0, StateInit_1.storeStateInit)(message.init));
          let needRef2 = false;
          if (opts && opts.forceRef) {
            needRef2 = true;
          } else {
            needRef2 = builder.availableBits - 2 < initCell.bits + message.body.bits.length;
          }
          if (needRef2) {
            builder.storeBit(true);
            builder.storeRef(initCell);
          } else {
            builder.storeBit(false);
            builder.storeBuilder(initCell);
          }
        } else {
          builder.storeBit(false);
        }
        let needRef = false;
        if (opts && opts.forceRef) {
          needRef = true;
        } else {
          needRef = builder.availableBits - 1 < message.body.bits.length || builder.refs + message.body.refs.length > 4;
        }
        if (needRef) {
          builder.storeBit(true);
          builder.storeRef(message.body);
        } else {
          builder.storeBit(false);
          builder.storeBuilder(message.body.asBuilder());
        }
      };
    }
    exports.storeMessage = storeMessage2;
    exports.MessageValue = {
      serialize(src, builder) {
        builder.storeRef((0, Builder_1.beginCell)().store(storeMessage2(src)));
      },
      parse(slice) {
        return loadMessage(slice.loadRef().beginParse());
      }
    };
  }
});

// node_modules/@ton/core/dist/types/SendMode.js
var require_SendMode = __commonJS({
  "node_modules/@ton/core/dist/types/SendMode.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SendMode = void 0;
    var SendMode2;
    (function(SendMode3) {
      SendMode3[SendMode3["CARRY_ALL_REMAINING_BALANCE"] = 128] = "CARRY_ALL_REMAINING_BALANCE";
      SendMode3[SendMode3["CARRY_ALL_REMAINING_INCOMING_VALUE"] = 64] = "CARRY_ALL_REMAINING_INCOMING_VALUE";
      SendMode3[SendMode3["DESTROY_ACCOUNT_IF_ZERO"] = 32] = "DESTROY_ACCOUNT_IF_ZERO";
      SendMode3[SendMode3["PAY_GAS_SEPARATELY"] = 1] = "PAY_GAS_SEPARATELY";
      SendMode3[SendMode3["IGNORE_ERRORS"] = 2] = "IGNORE_ERRORS";
      SendMode3[SendMode3["NONE"] = 0] = "NONE";
    })(SendMode2 || (exports.SendMode = SendMode2 = {}));
  }
});

// node_modules/@ton/core/dist/types/ReserveMode.js
var require_ReserveMode = __commonJS({
  "node_modules/@ton/core/dist/types/ReserveMode.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ReserveMode = void 0;
    var ReserveMode;
    (function(ReserveMode2) {
      ReserveMode2[ReserveMode2["THIS_AMOUNT"] = 0] = "THIS_AMOUNT";
      ReserveMode2[ReserveMode2["LEAVE_THIS_AMOUNT"] = 1] = "LEAVE_THIS_AMOUNT";
      ReserveMode2[ReserveMode2["AT_MOST_THIS_AMOUNT"] = 2] = "AT_MOST_THIS_AMOUNT";
      ReserveMode2[ReserveMode2["LEAVE_MAX_THIS_AMOUNT"] = 3] = "LEAVE_MAX_THIS_AMOUNT";
      ReserveMode2[ReserveMode2["BEFORE_BALANCE_PLUS_THIS_AMOUNT"] = 4] = "BEFORE_BALANCE_PLUS_THIS_AMOUNT";
      ReserveMode2[ReserveMode2["LEAVE_BBALANCE_PLUS_THIS_AMOUNT"] = 5] = "LEAVE_BBALANCE_PLUS_THIS_AMOUNT";
      ReserveMode2[ReserveMode2["BEFORE_BALANCE_MINUS_THIS_AMOUNT"] = 12] = "BEFORE_BALANCE_MINUS_THIS_AMOUNT";
      ReserveMode2[ReserveMode2["LEAVE_BEFORE_BALANCE_MINUS_THIS_AMOUNT"] = 13] = "LEAVE_BEFORE_BALANCE_MINUS_THIS_AMOUNT";
    })(ReserveMode || (exports.ReserveMode = ReserveMode = {}));
  }
});

// node_modules/@ton/core/dist/types/ShardAccount.js
var require_ShardAccount = __commonJS({
  "node_modules/@ton/core/dist/types/ShardAccount.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeShardAccount = exports.loadShardAccount = void 0;
    var Builder_1 = require_Builder();
    var Account_1 = require_Account();
    function loadShardAccount(slice) {
      let accountRef = slice.loadRef();
      let account = void 0;
      if (!accountRef.isExotic) {
        let accountSlice = accountRef.beginParse();
        if (accountSlice.loadBit()) {
          account = (0, Account_1.loadAccount)(accountSlice);
        }
      }
      return {
        account,
        lastTransactionHash: slice.loadUintBig(256),
        lastTransactionLt: slice.loadUintBig(64)
      };
    }
    exports.loadShardAccount = loadShardAccount;
    function storeShardAccount(src) {
      return (builder) => {
        if (src.account) {
          builder.storeRef((0, Builder_1.beginCell)().storeBit(true).store((0, Account_1.storeAccount)(src.account)));
        } else {
          builder.storeRef((0, Builder_1.beginCell)().storeBit(false));
        }
        builder.storeUint(src.lastTransactionHash, 256);
        builder.storeUint(src.lastTransactionLt, 64);
      };
    }
    exports.storeShardAccount = storeShardAccount;
  }
});

// node_modules/@ton/core/dist/types/ShardAccounts.js
var require_ShardAccounts = __commonJS({
  "node_modules/@ton/core/dist/types/ShardAccounts.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeShardAccounts = exports.loadShardAccounts = exports.ShardAccountRefValue = void 0;
    var Dictionary_1 = require_Dictionary();
    var DepthBalanceInfo_1 = require_DepthBalanceInfo();
    var ShardAccount_1 = require_ShardAccount();
    exports.ShardAccountRefValue = {
      parse: (cs) => {
        let depthBalanceInfo = (0, DepthBalanceInfo_1.loadDepthBalanceInfo)(cs);
        let shardAccount = (0, ShardAccount_1.loadShardAccount)(cs);
        return {
          depthBalanceInfo,
          shardAccount
        };
      },
      serialize(src, builder) {
        builder.store((0, DepthBalanceInfo_1.storeDepthBalanceInfo)(src.depthBalanceInfo));
        builder.store((0, ShardAccount_1.storeShardAccount)(src.shardAccount));
      }
    };
    function loadShardAccounts(cs) {
      return Dictionary_1.Dictionary.load(Dictionary_1.Dictionary.Keys.BigUint(256), exports.ShardAccountRefValue, cs);
    }
    exports.loadShardAccounts = loadShardAccounts;
    function storeShardAccounts(src) {
      return (Builder2) => {
        Builder2.storeDict(src);
      };
    }
    exports.storeShardAccounts = storeShardAccounts;
  }
});

// node_modules/@ton/core/dist/types/ShardIdent.js
var require_ShardIdent = __commonJS({
  "node_modules/@ton/core/dist/types/ShardIdent.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeShardIdent = exports.loadShardIdent = void 0;
    function loadShardIdent(slice) {
      if (slice.loadUint(2) !== 0) {
        throw Error("Invalid data");
      }
      return {
        shardPrefixBits: slice.loadUint(6),
        workchainId: slice.loadInt(32),
        shardPrefix: slice.loadUintBig(64)
      };
    }
    exports.loadShardIdent = loadShardIdent;
    function storeShardIdent(src) {
      return (builder) => {
        builder.storeUint(0, 2);
        builder.storeUint(src.shardPrefixBits, 6);
        builder.storeInt(src.workchainId, 32);
        builder.storeUint(src.shardPrefix, 64);
      };
    }
    exports.storeShardIdent = storeShardIdent;
  }
});

// node_modules/@ton/core/dist/types/ShardStateUnsplit.js
var require_ShardStateUnsplit = __commonJS({
  "node_modules/@ton/core/dist/types/ShardStateUnsplit.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.loadShardStateUnsplit = void 0;
    var MasterchainStateExtra_1 = require_MasterchainStateExtra();
    var ShardAccounts_1 = require_ShardAccounts();
    var ShardIdent_1 = require_ShardIdent();
    function loadShardStateUnsplit(cs) {
      if (cs.loadUint(32) !== 2418257890) {
        throw Error("Invalid data");
      }
      let globalId = cs.loadInt(32);
      let shardId = (0, ShardIdent_1.loadShardIdent)(cs);
      let seqno = cs.loadUint(32);
      let vertSeqNo = cs.loadUint(32);
      let genUtime = cs.loadUint(32);
      let genLt = cs.loadUintBig(64);
      let minRefMcSeqno = cs.loadUint(32);
      cs.loadRef();
      let beforeSplit = cs.loadBit();
      let shardAccountsRef = cs.loadRef();
      let accounts = void 0;
      if (!shardAccountsRef.isExotic) {
        accounts = (0, ShardAccounts_1.loadShardAccounts)(shardAccountsRef.beginParse());
      }
      cs.loadRef();
      let mcStateExtra = cs.loadBit();
      let extras = null;
      if (mcStateExtra) {
        let cell = cs.loadRef();
        if (!cell.isExotic) {
          extras = (0, MasterchainStateExtra_1.loadMasterchainStateExtra)(cell.beginParse());
        }
      }
      ;
      return {
        globalId,
        shardId,
        seqno,
        vertSeqNo,
        genUtime,
        genLt,
        minRefMcSeqno,
        beforeSplit,
        accounts,
        extras
      };
    }
    exports.loadShardStateUnsplit = loadShardStateUnsplit;
  }
});

// node_modules/@ton/core/dist/types/SplitMergeInfo.js
var require_SplitMergeInfo = __commonJS({
  "node_modules/@ton/core/dist/types/SplitMergeInfo.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeSplitMergeInfo = exports.loadSplitMergeInfo = void 0;
    function loadSplitMergeInfo(slice) {
      let currentShardPrefixLength = slice.loadUint(6);
      let accountSplitDepth = slice.loadUint(6);
      let thisAddress = slice.loadUintBig(256);
      let siblingAddress = slice.loadUintBig(256);
      return {
        currentShardPrefixLength,
        accountSplitDepth,
        thisAddress,
        siblingAddress
      };
    }
    exports.loadSplitMergeInfo = loadSplitMergeInfo;
    function storeSplitMergeInfo(src) {
      return (builder) => {
        builder.storeUint(src.currentShardPrefixLength, 6);
        builder.storeUint(src.accountSplitDepth, 6);
        builder.storeUint(src.thisAddress, 256);
        builder.storeUint(src.siblingAddress, 256);
      };
    }
    exports.storeSplitMergeInfo = storeSplitMergeInfo;
  }
});

// node_modules/@ton/core/dist/types/StorageUsedShort.js
var require_StorageUsedShort = __commonJS({
  "node_modules/@ton/core/dist/types/StorageUsedShort.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeStorageUsedShort = exports.loadStorageUsedShort = void 0;
    function loadStorageUsedShort(slice) {
      let cells = slice.loadVarUintBig(3);
      let bits = slice.loadVarUintBig(3);
      return {
        cells,
        bits
      };
    }
    exports.loadStorageUsedShort = loadStorageUsedShort;
    function storeStorageUsedShort(src) {
      return (builder) => {
        builder.storeVarUint(src.cells, 3);
        builder.storeVarUint(src.bits, 3);
      };
    }
    exports.storeStorageUsedShort = storeStorageUsedShort;
  }
});

// node_modules/@ton/core/dist/types/TransactionActionPhase.js
var require_TransactionActionPhase = __commonJS({
  "node_modules/@ton/core/dist/types/TransactionActionPhase.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeTransactionActionPhase = exports.loadTransactionActionPhase = void 0;
    var AccountStatusChange_1 = require_AccountStatusChange();
    var StorageUsedShort_1 = require_StorageUsedShort();
    function loadTransactionActionPhase(slice) {
      let success = slice.loadBit();
      let valid = slice.loadBit();
      let noFunds = slice.loadBit();
      let statusChange = (0, AccountStatusChange_1.loadAccountStatusChange)(slice);
      let totalFwdFees = slice.loadBit() ? slice.loadCoins() : void 0;
      let totalActionFees = slice.loadBit() ? slice.loadCoins() : void 0;
      let resultCode = slice.loadInt(32);
      let resultArg = slice.loadBit() ? slice.loadInt(32) : void 0;
      let totalActions = slice.loadUint(16);
      let specActions = slice.loadUint(16);
      let skippedActions = slice.loadUint(16);
      let messagesCreated = slice.loadUint(16);
      let actionListHash = slice.loadUintBig(256);
      let totalMessageSize = (0, StorageUsedShort_1.loadStorageUsedShort)(slice);
      return {
        success,
        valid,
        noFunds,
        statusChange,
        totalFwdFees,
        totalActionFees,
        resultCode,
        resultArg,
        totalActions,
        specActions,
        skippedActions,
        messagesCreated,
        actionListHash,
        totalMessageSize
      };
    }
    exports.loadTransactionActionPhase = loadTransactionActionPhase;
    function storeTransactionActionPhase(src) {
      return (builder) => {
        builder.storeBit(src.success);
        builder.storeBit(src.valid);
        builder.storeBit(src.noFunds);
        builder.store((0, AccountStatusChange_1.storeAccountStatusChange)(src.statusChange));
        builder.storeMaybeCoins(src.totalFwdFees);
        builder.storeMaybeCoins(src.totalActionFees);
        builder.storeInt(src.resultCode, 32);
        builder.storeMaybeInt(src.resultArg, 32);
        builder.storeUint(src.totalActions, 16);
        builder.storeUint(src.specActions, 16);
        builder.storeUint(src.skippedActions, 16);
        builder.storeUint(src.messagesCreated, 16);
        builder.storeUint(src.actionListHash, 256);
        builder.store((0, StorageUsedShort_1.storeStorageUsedShort)(src.totalMessageSize));
      };
    }
    exports.storeTransactionActionPhase = storeTransactionActionPhase;
  }
});

// node_modules/@ton/core/dist/types/TransactionBouncePhase.js
var require_TransactionBouncePhase = __commonJS({
  "node_modules/@ton/core/dist/types/TransactionBouncePhase.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeTransactionBouncePhase = exports.loadTransactionBouncePhase = void 0;
    var StorageUsedShort_1 = require_StorageUsedShort();
    function loadTransactionBouncePhase(slice) {
      if (slice.loadBit()) {
        let messageSize = (0, StorageUsedShort_1.loadStorageUsedShort)(slice);
        let messageFees = slice.loadCoins();
        let forwardFees = slice.loadCoins();
        return {
          type: "ok",
          messageSize,
          messageFees,
          forwardFees
        };
      }
      if (slice.loadBit()) {
        let messageSize = (0, StorageUsedShort_1.loadStorageUsedShort)(slice);
        let requiredForwardFees = slice.loadCoins();
        return {
          type: "no-funds",
          messageSize,
          requiredForwardFees
        };
      }
      return {
        type: "negative-funds"
      };
    }
    exports.loadTransactionBouncePhase = loadTransactionBouncePhase;
    function storeTransactionBouncePhase(src) {
      return (builder) => {
        if (src.type === "ok") {
          builder.storeBit(true);
          builder.store((0, StorageUsedShort_1.storeStorageUsedShort)(src.messageSize));
          builder.storeCoins(src.messageFees);
          builder.storeCoins(src.forwardFees);
        } else if (src.type === "negative-funds") {
          builder.storeBit(false);
          builder.storeBit(false);
        } else if (src.type === "no-funds") {
          builder.storeBit(false);
          builder.storeBit(true);
          builder.store((0, StorageUsedShort_1.storeStorageUsedShort)(src.messageSize));
          builder.storeCoins(src.requiredForwardFees);
        } else {
          throw new Error("Invalid TransactionBouncePhase type");
        }
      };
    }
    exports.storeTransactionBouncePhase = storeTransactionBouncePhase;
  }
});

// node_modules/@ton/core/dist/types/TransactionComputePhase.js
var require_TransactionComputePhase = __commonJS({
  "node_modules/@ton/core/dist/types/TransactionComputePhase.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeTransactionComputePhase = exports.loadTransactionComputePhase = void 0;
    var Builder_1 = require_Builder();
    var ComputeSkipReason_1 = require_ComputeSkipReason();
    function loadTransactionComputePhase(slice) {
      if (!slice.loadBit()) {
        let reason = (0, ComputeSkipReason_1.loadComputeSkipReason)(slice);
        return {
          type: "skipped",
          reason
        };
      }
      let success = slice.loadBit();
      let messageStateUsed = slice.loadBit();
      let accountActivated = slice.loadBit();
      let gasFees = slice.loadCoins();
      const vmState = slice.loadRef().beginParse();
      let gasUsed = vmState.loadVarUintBig(3);
      let gasLimit = vmState.loadVarUintBig(3);
      let gasCredit = vmState.loadBit() ? vmState.loadVarUintBig(2) : void 0;
      let mode = vmState.loadUint(8);
      let exitCode = vmState.loadInt(32);
      let exitArg = vmState.loadBit() ? vmState.loadInt(32) : void 0;
      let vmSteps = vmState.loadUint(32);
      let vmInitStateHash = vmState.loadUintBig(256);
      let vmFinalStateHash = vmState.loadUintBig(256);
      return {
        type: "vm",
        success,
        messageStateUsed,
        accountActivated,
        gasFees,
        gasUsed,
        gasLimit,
        gasCredit,
        mode,
        exitCode,
        exitArg,
        vmSteps,
        vmInitStateHash,
        vmFinalStateHash
      };
    }
    exports.loadTransactionComputePhase = loadTransactionComputePhase;
    function storeTransactionComputePhase(src) {
      return (builder) => {
        if (src.type === "skipped") {
          builder.storeBit(0);
          builder.store((0, ComputeSkipReason_1.storeComputeSkipReason)(src.reason));
          return;
        }
        builder.storeBit(1);
        builder.storeBit(src.success);
        builder.storeBit(src.messageStateUsed);
        builder.storeBit(src.accountActivated);
        builder.storeCoins(src.gasFees);
        builder.storeRef((0, Builder_1.beginCell)().storeVarUint(src.gasUsed, 3).storeVarUint(src.gasLimit, 3).store((b) => src.gasCredit !== void 0 && src.gasCredit !== null ? b.storeBit(1).storeVarUint(src.gasCredit, 2) : b.storeBit(0)).storeUint(src.mode, 8).storeInt(src.exitCode, 32).store((b) => src.exitArg !== void 0 && src.exitArg !== null ? b.storeBit(1).storeInt(src.exitArg, 32) : b.storeBit(0)).storeUint(src.vmSteps, 32).storeUint(src.vmInitStateHash, 256).storeUint(src.vmFinalStateHash, 256).endCell());
      };
    }
    exports.storeTransactionComputePhase = storeTransactionComputePhase;
  }
});

// node_modules/@ton/core/dist/types/TransactionCreditPhase.js
var require_TransactionCreditPhase = __commonJS({
  "node_modules/@ton/core/dist/types/TransactionCreditPhase.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeTransactionCreditPhase = exports.loadTransactionCreditPhase = void 0;
    var CurrencyCollection_1 = require_CurrencyCollection();
    function loadTransactionCreditPhase(slice) {
      const dueFeesColelcted = slice.loadBit() ? slice.loadCoins() : void 0;
      const credit = (0, CurrencyCollection_1.loadCurrencyCollection)(slice);
      return {
        dueFeesColelcted,
        credit
      };
    }
    exports.loadTransactionCreditPhase = loadTransactionCreditPhase;
    function storeTransactionCreditPhase(src) {
      return (builder) => {
        if (src.dueFeesColelcted === null || src.dueFeesColelcted === void 0) {
          builder.storeBit(false);
        } else {
          builder.storeBit(true);
          builder.storeCoins(src.dueFeesColelcted);
        }
        builder.store((0, CurrencyCollection_1.storeCurrencyCollection)(src.credit));
      };
    }
    exports.storeTransactionCreditPhase = storeTransactionCreditPhase;
  }
});

// node_modules/@ton/core/dist/types/TransactionStoragePhase.js
var require_TransactionStoragePhase = __commonJS({
  "node_modules/@ton/core/dist/types/TransactionStoragePhase.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeTransactionsStoragePhase = exports.loadTransactionStoragePhase = void 0;
    var AccountStatusChange_1 = require_AccountStatusChange();
    function loadTransactionStoragePhase(slice) {
      const storageFeesCollected = slice.loadCoins();
      let storageFeesDue = void 0;
      if (slice.loadBit()) {
        storageFeesDue = slice.loadCoins();
      }
      const statusChange = (0, AccountStatusChange_1.loadAccountStatusChange)(slice);
      return {
        storageFeesCollected,
        storageFeesDue,
        statusChange
      };
    }
    exports.loadTransactionStoragePhase = loadTransactionStoragePhase;
    function storeTransactionsStoragePhase(src) {
      return (builder) => {
        builder.storeCoins(src.storageFeesCollected);
        if (src.storageFeesDue === null || src.storageFeesDue === void 0) {
          builder.storeBit(false);
        } else {
          builder.storeBit(true);
          builder.storeCoins(src.storageFeesDue);
        }
        builder.store((0, AccountStatusChange_1.storeAccountStatusChange)(src.statusChange));
      };
    }
    exports.storeTransactionsStoragePhase = storeTransactionsStoragePhase;
  }
});

// node_modules/@ton/core/dist/types/TransactionDescription.js
var require_TransactionDescription = __commonJS({
  "node_modules/@ton/core/dist/types/TransactionDescription.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeTransactionDescription = exports.loadTransactionDescription = void 0;
    var Builder_1 = require_Builder();
    var SplitMergeInfo_1 = require_SplitMergeInfo();
    var Transaction_1 = require_Transaction();
    var TransactionActionPhase_1 = require_TransactionActionPhase();
    var TransactionBouncePhase_1 = require_TransactionBouncePhase();
    var TransactionComputePhase_1 = require_TransactionComputePhase();
    var TransactionCreditPhase_1 = require_TransactionCreditPhase();
    var TransactionStoragePhase_1 = require_TransactionStoragePhase();
    function loadTransactionDescription(slice) {
      let type = slice.loadUint(4);
      if (type === 0) {
        const creditFirst = slice.loadBit();
        let storagePhase = void 0;
        if (slice.loadBit()) {
          storagePhase = (0, TransactionStoragePhase_1.loadTransactionStoragePhase)(slice);
        }
        let creditPhase = void 0;
        if (slice.loadBit()) {
          creditPhase = (0, TransactionCreditPhase_1.loadTransactionCreditPhase)(slice);
        }
        let computePhase = (0, TransactionComputePhase_1.loadTransactionComputePhase)(slice);
        let actionPhase = void 0;
        if (slice.loadBit()) {
          actionPhase = (0, TransactionActionPhase_1.loadTransactionActionPhase)(slice.loadRef().beginParse());
        }
        let aborted = slice.loadBit();
        let bouncePhase = void 0;
        if (slice.loadBit()) {
          bouncePhase = (0, TransactionBouncePhase_1.loadTransactionBouncePhase)(slice);
        }
        const destroyed = slice.loadBit();
        return {
          type: "generic",
          creditFirst,
          storagePhase,
          creditPhase,
          computePhase,
          actionPhase,
          bouncePhase,
          aborted,
          destroyed
        };
      }
      if (type === 1) {
        return {
          type: "storage",
          storagePhase: (0, TransactionStoragePhase_1.loadTransactionStoragePhase)(slice)
        };
      }
      if (type === 2 || type === 3) {
        const isTock = type === 3;
        let storagePhase = (0, TransactionStoragePhase_1.loadTransactionStoragePhase)(slice);
        let computePhase = (0, TransactionComputePhase_1.loadTransactionComputePhase)(slice);
        let actionPhase = void 0;
        if (slice.loadBit()) {
          actionPhase = (0, TransactionActionPhase_1.loadTransactionActionPhase)(slice.loadRef().beginParse());
        }
        const aborted = slice.loadBit();
        const destroyed = slice.loadBit();
        return {
          type: "tick-tock",
          isTock,
          storagePhase,
          computePhase,
          actionPhase,
          aborted,
          destroyed
        };
      }
      if (type === 4) {
        let splitInfo = (0, SplitMergeInfo_1.loadSplitMergeInfo)(slice);
        let storagePhase = void 0;
        if (slice.loadBit()) {
          storagePhase = (0, TransactionStoragePhase_1.loadTransactionStoragePhase)(slice);
        }
        let computePhase = (0, TransactionComputePhase_1.loadTransactionComputePhase)(slice);
        let actionPhase = void 0;
        if (slice.loadBit()) {
          actionPhase = (0, TransactionActionPhase_1.loadTransactionActionPhase)(slice.loadRef().beginParse());
        }
        const aborted = slice.loadBit();
        const destroyed = slice.loadBit();
        return {
          type: "split-prepare",
          splitInfo,
          storagePhase,
          computePhase,
          actionPhase,
          aborted,
          destroyed
        };
      }
      if (type === 5) {
        let splitInfo = (0, SplitMergeInfo_1.loadSplitMergeInfo)(slice);
        let prepareTransaction = (0, Transaction_1.loadTransaction)(slice.loadRef().beginParse());
        const installed = slice.loadBit();
        return {
          type: "split-install",
          splitInfo,
          prepareTransaction,
          installed
        };
      }
      throw Error(`Unsupported transaction description type ${type}`);
    }
    exports.loadTransactionDescription = loadTransactionDescription;
    function storeTransactionDescription(src) {
      return (builder) => {
        if (src.type === "generic") {
          builder.storeUint(0, 4);
          builder.storeBit(src.creditFirst);
          if (src.storagePhase) {
            builder.storeBit(true);
            builder.store((0, TransactionStoragePhase_1.storeTransactionsStoragePhase)(src.storagePhase));
          } else {
            builder.storeBit(false);
          }
          if (src.creditPhase) {
            builder.storeBit(true);
            builder.store((0, TransactionCreditPhase_1.storeTransactionCreditPhase)(src.creditPhase));
          } else {
            builder.storeBit(false);
          }
          builder.store((0, TransactionComputePhase_1.storeTransactionComputePhase)(src.computePhase));
          if (src.actionPhase) {
            builder.storeBit(true);
            builder.storeRef((0, Builder_1.beginCell)().store((0, TransactionActionPhase_1.storeTransactionActionPhase)(src.actionPhase)));
          } else {
            builder.storeBit(false);
          }
          builder.storeBit(src.aborted);
          if (src.bouncePhase) {
            builder.storeBit(true);
            builder.store((0, TransactionBouncePhase_1.storeTransactionBouncePhase)(src.bouncePhase));
          } else {
            builder.storeBit(false);
          }
          builder.storeBit(src.destroyed);
        } else if (src.type === "storage") {
          builder.storeUint(1, 4);
          builder.store((0, TransactionStoragePhase_1.storeTransactionsStoragePhase)(src.storagePhase));
        } else if (src.type === "tick-tock") {
          builder.storeUint(src.isTock ? 3 : 2, 4);
          builder.store((0, TransactionStoragePhase_1.storeTransactionsStoragePhase)(src.storagePhase));
          builder.store((0, TransactionComputePhase_1.storeTransactionComputePhase)(src.computePhase));
          if (src.actionPhase) {
            builder.storeBit(true);
            builder.storeRef((0, Builder_1.beginCell)().store((0, TransactionActionPhase_1.storeTransactionActionPhase)(src.actionPhase)));
          } else {
            builder.storeBit(false);
          }
          builder.storeBit(src.aborted);
          builder.storeBit(src.destroyed);
        } else if (src.type === "split-prepare") {
          builder.storeUint(4, 4);
          builder.store((0, SplitMergeInfo_1.storeSplitMergeInfo)(src.splitInfo));
          if (src.storagePhase) {
            builder.storeBit(true);
            builder.store((0, TransactionStoragePhase_1.storeTransactionsStoragePhase)(src.storagePhase));
          } else {
            builder.storeBit(false);
          }
          builder.store((0, TransactionComputePhase_1.storeTransactionComputePhase)(src.computePhase));
          if (src.actionPhase) {
            builder.storeBit(true);
            builder.store((0, TransactionActionPhase_1.storeTransactionActionPhase)(src.actionPhase));
          } else {
            builder.storeBit(false);
          }
          builder.storeBit(src.aborted);
          builder.storeBit(src.destroyed);
        } else if (src.type === "split-install") {
          builder.storeUint(5, 4);
          builder.store((0, SplitMergeInfo_1.storeSplitMergeInfo)(src.splitInfo));
          builder.storeRef((0, Builder_1.beginCell)().store((0, Transaction_1.storeTransaction)(src.prepareTransaction)));
          builder.storeBit(src.installed);
        } else {
          throw Error(`Unsupported transaction description type ${src.type}`);
        }
      };
    }
    exports.storeTransactionDescription = storeTransactionDescription;
  }
});

// node_modules/@ton/core/dist/types/Transaction.js
var require_Transaction = __commonJS({
  "node_modules/@ton/core/dist/types/Transaction.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeTransaction = exports.loadTransaction = void 0;
    var Builder_1 = require_Builder();
    var Dictionary_1 = require_Dictionary();
    var AccountStatus_1 = require_AccountStatus();
    var CurrencyCollection_1 = require_CurrencyCollection();
    var HashUpdate_1 = require_HashUpdate();
    var Message_1 = require_Message();
    var TransactionDescription_1 = require_TransactionDescription();
    function loadTransaction(slice) {
      let raw = slice.asCell();
      if (slice.loadUint(4) !== 7) {
        throw Error("Invalid data");
      }
      let address = slice.loadUintBig(256);
      let lt = slice.loadUintBig(64);
      let prevTransactionHash = slice.loadUintBig(256);
      let prevTransactionLt = slice.loadUintBig(64);
      let now = slice.loadUint(32);
      let outMessagesCount = slice.loadUint(15);
      let oldStatus = (0, AccountStatus_1.loadAccountStatus)(slice);
      let endStatus = (0, AccountStatus_1.loadAccountStatus)(slice);
      let msgRef = slice.loadRef();
      let msgSlice = msgRef.beginParse();
      let inMessage = msgSlice.loadBit() ? (0, Message_1.loadMessage)(msgSlice.loadRef().beginParse()) : void 0;
      let outMessages = msgSlice.loadDict(Dictionary_1.Dictionary.Keys.Uint(15), Message_1.MessageValue);
      msgSlice.endParse();
      let totalFees = (0, CurrencyCollection_1.loadCurrencyCollection)(slice);
      let stateUpdate = (0, HashUpdate_1.loadHashUpdate)(slice.loadRef().beginParse());
      let description = (0, TransactionDescription_1.loadTransactionDescription)(slice.loadRef().beginParse());
      return {
        address,
        lt,
        prevTransactionHash,
        prevTransactionLt,
        now,
        outMessagesCount,
        oldStatus,
        endStatus,
        inMessage,
        outMessages,
        totalFees,
        stateUpdate,
        description,
        raw,
        hash: () => raw.hash()
      };
    }
    exports.loadTransaction = loadTransaction;
    function storeTransaction(src) {
      return (builder) => {
        builder.storeUint(7, 4);
        builder.storeUint(src.address, 256);
        builder.storeUint(src.lt, 64);
        builder.storeUint(src.prevTransactionHash, 256);
        builder.storeUint(src.prevTransactionLt, 64);
        builder.storeUint(src.now, 32);
        builder.storeUint(src.outMessagesCount, 15);
        builder.store((0, AccountStatus_1.storeAccountStatus)(src.oldStatus));
        builder.store((0, AccountStatus_1.storeAccountStatus)(src.endStatus));
        let msgBuilder = (0, Builder_1.beginCell)();
        if (src.inMessage) {
          msgBuilder.storeBit(true);
          msgBuilder.storeRef((0, Builder_1.beginCell)().store((0, Message_1.storeMessage)(src.inMessage)));
        } else {
          msgBuilder.storeBit(false);
        }
        msgBuilder.storeDict(src.outMessages);
        builder.storeRef(msgBuilder);
        builder.store((0, CurrencyCollection_1.storeCurrencyCollection)(src.totalFees));
        builder.storeRef((0, Builder_1.beginCell)().store((0, HashUpdate_1.storeHashUpdate)(src.stateUpdate)));
        builder.storeRef((0, Builder_1.beginCell)().store((0, TransactionDescription_1.storeTransactionDescription)(src.description)));
      };
    }
    exports.storeTransaction = storeTransaction;
  }
});

// node_modules/@ton/core/dist/types/_export.js
var require_export = __commonJS({
  "node_modules/@ton/core/dist/types/_export.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.storeSplitMergeInfo = exports.loadSplitMergeInfo = exports.storeLibRef = exports.loadLibRef = exports.storeSimpleLibrary = exports.loadSimpleLibrary = exports.loadShardStateUnsplit = exports.storeShardIdent = exports.loadShardIdent = exports.storeShardAccounts = exports.loadShardAccounts = exports.ShardAccountRefValue = exports.storeShardAccount = exports.loadShardAccount = exports.ReserveMode = exports.SendMode = exports.storeMessageRelaxed = exports.loadMessageRelaxed = exports.storeMessage = exports.loadMessage = exports.loadMasterchainStateExtra = exports.storeHashUpdate = exports.loadHashUpdate = exports.storeDepthBalanceInfo = exports.loadDepthBalanceInfo = exports.storeCurrencyCollection = exports.loadCurrencyCollection = exports.storeComputeSkipReason = exports.loadComputeSkipReason = exports.storeCommonMessageInfoRelaxed = exports.loadCommonMessageInfoRelaxed = exports.storeCommonMessageInfo = exports.loadCommonMessageInfo = exports.storeOutList = exports.loadOutList = exports.storeOutAction = exports.loadOutAction = exports.storeAccountStorage = exports.loadAccountStorage = exports.storeAccountStatusChange = exports.loadAccountStatusChange = exports.storeAccountStatus = exports.loadAccountStatus = exports.storeAccountState = exports.loadAccountState = exports.storeAccount = exports.loadAccount = exports.comment = exports.external = exports.internal = void 0;
    exports.storeTransactionsStoragePhase = exports.loadTransactionStoragePhase = exports.storeTransactionDescription = exports.loadTransactionDescription = exports.storeTransactionCreditPhase = exports.loadTransactionCreditPhase = exports.storeTransactionComputePhase = exports.loadTransactionComputePhase = exports.storeTransactionBouncePhase = exports.loadTransactionBouncePhase = exports.storeTransactionActionPhase = exports.loadTransactionActionPhase = exports.storeTransaction = exports.loadTransaction = exports.storeTickTock = exports.loadTickTock = exports.storeStorageUsedShort = exports.loadStorageUsedShort = exports.storeStorageUsed = exports.loadStorageUsed = exports.storeStorageInfo = exports.loadStorageInfo = exports.storeStateInit = exports.loadStateInit = void 0;
    var _helpers_1 = require_helpers();
    Object.defineProperty(exports, "internal", { enumerable: true, get: function() {
      return _helpers_1.internal;
    } });
    Object.defineProperty(exports, "external", { enumerable: true, get: function() {
      return _helpers_1.external;
    } });
    Object.defineProperty(exports, "comment", { enumerable: true, get: function() {
      return _helpers_1.comment;
    } });
    var Account_1 = require_Account();
    Object.defineProperty(exports, "loadAccount", { enumerable: true, get: function() {
      return Account_1.loadAccount;
    } });
    Object.defineProperty(exports, "storeAccount", { enumerable: true, get: function() {
      return Account_1.storeAccount;
    } });
    var AccountState_1 = require_AccountState();
    Object.defineProperty(exports, "loadAccountState", { enumerable: true, get: function() {
      return AccountState_1.loadAccountState;
    } });
    Object.defineProperty(exports, "storeAccountState", { enumerable: true, get: function() {
      return AccountState_1.storeAccountState;
    } });
    var AccountStatus_1 = require_AccountStatus();
    Object.defineProperty(exports, "loadAccountStatus", { enumerable: true, get: function() {
      return AccountStatus_1.loadAccountStatus;
    } });
    Object.defineProperty(exports, "storeAccountStatus", { enumerable: true, get: function() {
      return AccountStatus_1.storeAccountStatus;
    } });
    var AccountStatusChange_1 = require_AccountStatusChange();
    Object.defineProperty(exports, "loadAccountStatusChange", { enumerable: true, get: function() {
      return AccountStatusChange_1.loadAccountStatusChange;
    } });
    Object.defineProperty(exports, "storeAccountStatusChange", { enumerable: true, get: function() {
      return AccountStatusChange_1.storeAccountStatusChange;
    } });
    var AccountStorage_1 = require_AccountStorage();
    Object.defineProperty(exports, "loadAccountStorage", { enumerable: true, get: function() {
      return AccountStorage_1.loadAccountStorage;
    } });
    Object.defineProperty(exports, "storeAccountStorage", { enumerable: true, get: function() {
      return AccountStorage_1.storeAccountStorage;
    } });
    var OutList_1 = require_OutList();
    Object.defineProperty(exports, "loadOutAction", { enumerable: true, get: function() {
      return OutList_1.loadOutAction;
    } });
    Object.defineProperty(exports, "storeOutAction", { enumerable: true, get: function() {
      return OutList_1.storeOutAction;
    } });
    Object.defineProperty(exports, "loadOutList", { enumerable: true, get: function() {
      return OutList_1.loadOutList;
    } });
    Object.defineProperty(exports, "storeOutList", { enumerable: true, get: function() {
      return OutList_1.storeOutList;
    } });
    var CommonMessageInfo_1 = require_CommonMessageInfo();
    Object.defineProperty(exports, "loadCommonMessageInfo", { enumerable: true, get: function() {
      return CommonMessageInfo_1.loadCommonMessageInfo;
    } });
    Object.defineProperty(exports, "storeCommonMessageInfo", { enumerable: true, get: function() {
      return CommonMessageInfo_1.storeCommonMessageInfo;
    } });
    var CommonMessageInfoRelaxed_1 = require_CommonMessageInfoRelaxed();
    Object.defineProperty(exports, "loadCommonMessageInfoRelaxed", { enumerable: true, get: function() {
      return CommonMessageInfoRelaxed_1.loadCommonMessageInfoRelaxed;
    } });
    Object.defineProperty(exports, "storeCommonMessageInfoRelaxed", { enumerable: true, get: function() {
      return CommonMessageInfoRelaxed_1.storeCommonMessageInfoRelaxed;
    } });
    var ComputeSkipReason_1 = require_ComputeSkipReason();
    Object.defineProperty(exports, "loadComputeSkipReason", { enumerable: true, get: function() {
      return ComputeSkipReason_1.loadComputeSkipReason;
    } });
    Object.defineProperty(exports, "storeComputeSkipReason", { enumerable: true, get: function() {
      return ComputeSkipReason_1.storeComputeSkipReason;
    } });
    var CurrencyCollection_1 = require_CurrencyCollection();
    Object.defineProperty(exports, "loadCurrencyCollection", { enumerable: true, get: function() {
      return CurrencyCollection_1.loadCurrencyCollection;
    } });
    Object.defineProperty(exports, "storeCurrencyCollection", { enumerable: true, get: function() {
      return CurrencyCollection_1.storeCurrencyCollection;
    } });
    var DepthBalanceInfo_1 = require_DepthBalanceInfo();
    Object.defineProperty(exports, "loadDepthBalanceInfo", { enumerable: true, get: function() {
      return DepthBalanceInfo_1.loadDepthBalanceInfo;
    } });
    Object.defineProperty(exports, "storeDepthBalanceInfo", { enumerable: true, get: function() {
      return DepthBalanceInfo_1.storeDepthBalanceInfo;
    } });
    var HashUpdate_1 = require_HashUpdate();
    Object.defineProperty(exports, "loadHashUpdate", { enumerable: true, get: function() {
      return HashUpdate_1.loadHashUpdate;
    } });
    Object.defineProperty(exports, "storeHashUpdate", { enumerable: true, get: function() {
      return HashUpdate_1.storeHashUpdate;
    } });
    var MasterchainStateExtra_1 = require_MasterchainStateExtra();
    Object.defineProperty(exports, "loadMasterchainStateExtra", { enumerable: true, get: function() {
      return MasterchainStateExtra_1.loadMasterchainStateExtra;
    } });
    var Message_1 = require_Message();
    Object.defineProperty(exports, "loadMessage", { enumerable: true, get: function() {
      return Message_1.loadMessage;
    } });
    Object.defineProperty(exports, "storeMessage", { enumerable: true, get: function() {
      return Message_1.storeMessage;
    } });
    var MessageRelaxed_1 = require_MessageRelaxed();
    Object.defineProperty(exports, "loadMessageRelaxed", { enumerable: true, get: function() {
      return MessageRelaxed_1.loadMessageRelaxed;
    } });
    Object.defineProperty(exports, "storeMessageRelaxed", { enumerable: true, get: function() {
      return MessageRelaxed_1.storeMessageRelaxed;
    } });
    var SendMode_1 = require_SendMode();
    Object.defineProperty(exports, "SendMode", { enumerable: true, get: function() {
      return SendMode_1.SendMode;
    } });
    var ReserveMode_1 = require_ReserveMode();
    Object.defineProperty(exports, "ReserveMode", { enumerable: true, get: function() {
      return ReserveMode_1.ReserveMode;
    } });
    var ShardAccount_1 = require_ShardAccount();
    Object.defineProperty(exports, "loadShardAccount", { enumerable: true, get: function() {
      return ShardAccount_1.loadShardAccount;
    } });
    Object.defineProperty(exports, "storeShardAccount", { enumerable: true, get: function() {
      return ShardAccount_1.storeShardAccount;
    } });
    var ShardAccounts_1 = require_ShardAccounts();
    Object.defineProperty(exports, "ShardAccountRefValue", { enumerable: true, get: function() {
      return ShardAccounts_1.ShardAccountRefValue;
    } });
    Object.defineProperty(exports, "loadShardAccounts", { enumerable: true, get: function() {
      return ShardAccounts_1.loadShardAccounts;
    } });
    Object.defineProperty(exports, "storeShardAccounts", { enumerable: true, get: function() {
      return ShardAccounts_1.storeShardAccounts;
    } });
    var ShardIdent_1 = require_ShardIdent();
    Object.defineProperty(exports, "loadShardIdent", { enumerable: true, get: function() {
      return ShardIdent_1.loadShardIdent;
    } });
    Object.defineProperty(exports, "storeShardIdent", { enumerable: true, get: function() {
      return ShardIdent_1.storeShardIdent;
    } });
    var ShardStateUnsplit_1 = require_ShardStateUnsplit();
    Object.defineProperty(exports, "loadShardStateUnsplit", { enumerable: true, get: function() {
      return ShardStateUnsplit_1.loadShardStateUnsplit;
    } });
    var SimpleLibrary_1 = require_SimpleLibrary();
    Object.defineProperty(exports, "loadSimpleLibrary", { enumerable: true, get: function() {
      return SimpleLibrary_1.loadSimpleLibrary;
    } });
    Object.defineProperty(exports, "storeSimpleLibrary", { enumerable: true, get: function() {
      return SimpleLibrary_1.storeSimpleLibrary;
    } });
    var LibRef_1 = require_LibRef();
    Object.defineProperty(exports, "loadLibRef", { enumerable: true, get: function() {
      return LibRef_1.loadLibRef;
    } });
    Object.defineProperty(exports, "storeLibRef", { enumerable: true, get: function() {
      return LibRef_1.storeLibRef;
    } });
    var SplitMergeInfo_1 = require_SplitMergeInfo();
    Object.defineProperty(exports, "loadSplitMergeInfo", { enumerable: true, get: function() {
      return SplitMergeInfo_1.loadSplitMergeInfo;
    } });
    Object.defineProperty(exports, "storeSplitMergeInfo", { enumerable: true, get: function() {
      return SplitMergeInfo_1.storeSplitMergeInfo;
    } });
    var StateInit_1 = require_StateInit();
    Object.defineProperty(exports, "loadStateInit", { enumerable: true, get: function() {
      return StateInit_1.loadStateInit;
    } });
    Object.defineProperty(exports, "storeStateInit", { enumerable: true, get: function() {
      return StateInit_1.storeStateInit;
    } });
    var StorageInto_1 = require_StorageInto();
    Object.defineProperty(exports, "loadStorageInfo", { enumerable: true, get: function() {
      return StorageInto_1.loadStorageInfo;
    } });
    Object.defineProperty(exports, "storeStorageInfo", { enumerable: true, get: function() {
      return StorageInto_1.storeStorageInfo;
    } });
    var StorageUsed_1 = require_StorageUsed();
    Object.defineProperty(exports, "loadStorageUsed", { enumerable: true, get: function() {
      return StorageUsed_1.loadStorageUsed;
    } });
    Object.defineProperty(exports, "storeStorageUsed", { enumerable: true, get: function() {
      return StorageUsed_1.storeStorageUsed;
    } });
    var StorageUsedShort_1 = require_StorageUsedShort();
    Object.defineProperty(exports, "loadStorageUsedShort", { enumerable: true, get: function() {
      return StorageUsedShort_1.loadStorageUsedShort;
    } });
    Object.defineProperty(exports, "storeStorageUsedShort", { enumerable: true, get: function() {
      return StorageUsedShort_1.storeStorageUsedShort;
    } });
    var TickTock_1 = require_TickTock();
    Object.defineProperty(exports, "loadTickTock", { enumerable: true, get: function() {
      return TickTock_1.loadTickTock;
    } });
    Object.defineProperty(exports, "storeTickTock", { enumerable: true, get: function() {
      return TickTock_1.storeTickTock;
    } });
    var Transaction_1 = require_Transaction();
    Object.defineProperty(exports, "loadTransaction", { enumerable: true, get: function() {
      return Transaction_1.loadTransaction;
    } });
    Object.defineProperty(exports, "storeTransaction", { enumerable: true, get: function() {
      return Transaction_1.storeTransaction;
    } });
    var TransactionActionPhase_1 = require_TransactionActionPhase();
    Object.defineProperty(exports, "loadTransactionActionPhase", { enumerable: true, get: function() {
      return TransactionActionPhase_1.loadTransactionActionPhase;
    } });
    Object.defineProperty(exports, "storeTransactionActionPhase", { enumerable: true, get: function() {
      return TransactionActionPhase_1.storeTransactionActionPhase;
    } });
    var TransactionBouncePhase_1 = require_TransactionBouncePhase();
    Object.defineProperty(exports, "loadTransactionBouncePhase", { enumerable: true, get: function() {
      return TransactionBouncePhase_1.loadTransactionBouncePhase;
    } });
    Object.defineProperty(exports, "storeTransactionBouncePhase", { enumerable: true, get: function() {
      return TransactionBouncePhase_1.storeTransactionBouncePhase;
    } });
    var TransactionComputePhase_1 = require_TransactionComputePhase();
    Object.defineProperty(exports, "loadTransactionComputePhase", { enumerable: true, get: function() {
      return TransactionComputePhase_1.loadTransactionComputePhase;
    } });
    Object.defineProperty(exports, "storeTransactionComputePhase", { enumerable: true, get: function() {
      return TransactionComputePhase_1.storeTransactionComputePhase;
    } });
    var TransactionCreditPhase_1 = require_TransactionCreditPhase();
    Object.defineProperty(exports, "loadTransactionCreditPhase", { enumerable: true, get: function() {
      return TransactionCreditPhase_1.loadTransactionCreditPhase;
    } });
    Object.defineProperty(exports, "storeTransactionCreditPhase", { enumerable: true, get: function() {
      return TransactionCreditPhase_1.storeTransactionCreditPhase;
    } });
    var TransactionDescription_1 = require_TransactionDescription();
    Object.defineProperty(exports, "loadTransactionDescription", { enumerable: true, get: function() {
      return TransactionDescription_1.loadTransactionDescription;
    } });
    Object.defineProperty(exports, "storeTransactionDescription", { enumerable: true, get: function() {
      return TransactionDescription_1.storeTransactionDescription;
    } });
    var TransactionStoragePhase_1 = require_TransactionStoragePhase();
    Object.defineProperty(exports, "loadTransactionStoragePhase", { enumerable: true, get: function() {
      return TransactionStoragePhase_1.loadTransactionStoragePhase;
    } });
    Object.defineProperty(exports, "storeTransactionsStoragePhase", { enumerable: true, get: function() {
      return TransactionStoragePhase_1.storeTransactionsStoragePhase;
    } });
  }
});

// node_modules/@ton/core/dist/contract/openContract.js
var require_openContract = __commonJS({
  "node_modules/@ton/core/dist/contract/openContract.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.openContract = void 0;
    var Address_1 = require_Address();
    var Cell_1 = require_Cell();
    function openContract(src, factory) {
      let address;
      let init = null;
      if (!Address_1.Address.isAddress(src.address)) {
        throw Error("Invalid address");
      }
      address = src.address;
      if (src.init) {
        if (!(src.init.code instanceof Cell_1.Cell)) {
          throw Error("Invalid init.code");
        }
        if (!(src.init.data instanceof Cell_1.Cell)) {
          throw Error("Invalid init.data");
        }
        init = src.init;
      }
      let executor = factory({ address, init });
      return new Proxy(src, {
        get(target, prop) {
          const value = target[prop];
          if (typeof prop === "string" && (prop.startsWith("get") || prop.startsWith("send") || prop.startsWith("is"))) {
            if (typeof value === "function") {
              return (...args) => value.apply(target, [executor, ...args]);
            }
          }
          return value;
        }
      });
    }
    exports.openContract = openContract;
  }
});

// node_modules/@ton/core/dist/contract/ComputeError.js
var require_ComputeError = __commonJS({
  "node_modules/@ton/core/dist/contract/ComputeError.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ComputeError = void 0;
    var ComputeError = class _ComputeError extends Error {
      constructor(message, exitCode, opts) {
        super(message);
        this.exitCode = exitCode;
        this.debugLogs = opts && opts.debugLogs ? opts.debugLogs : null;
        this.logs = opts && opts.logs ? opts.logs : null;
        Object.setPrototypeOf(this, _ComputeError.prototype);
      }
    };
    exports.ComputeError = ComputeError;
  }
});

// node_modules/@ton/core/dist/utils/getMethodId.js
var require_getMethodId = __commonJS({
  "node_modules/@ton/core/dist/utils/getMethodId.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getMethodId = void 0;
    var TABLE = new Int16Array([
      0,
      4129,
      8258,
      12387,
      16516,
      20645,
      24774,
      28903,
      33032,
      37161,
      41290,
      45419,
      49548,
      53677,
      57806,
      61935,
      4657,
      528,
      12915,
      8786,
      21173,
      17044,
      29431,
      25302,
      37689,
      33560,
      45947,
      41818,
      54205,
      50076,
      62463,
      58334,
      9314,
      13379,
      1056,
      5121,
      25830,
      29895,
      17572,
      21637,
      42346,
      46411,
      34088,
      38153,
      58862,
      62927,
      50604,
      54669,
      13907,
      9842,
      5649,
      1584,
      30423,
      26358,
      22165,
      18100,
      46939,
      42874,
      38681,
      34616,
      63455,
      59390,
      55197,
      51132,
      18628,
      22757,
      26758,
      30887,
      2112,
      6241,
      10242,
      14371,
      51660,
      55789,
      59790,
      63919,
      35144,
      39273,
      43274,
      47403,
      23285,
      19156,
      31415,
      27286,
      6769,
      2640,
      14899,
      10770,
      56317,
      52188,
      64447,
      60318,
      39801,
      35672,
      47931,
      43802,
      27814,
      31879,
      19684,
      23749,
      11298,
      15363,
      3168,
      7233,
      60846,
      64911,
      52716,
      56781,
      44330,
      48395,
      36200,
      40265,
      32407,
      28342,
      24277,
      20212,
      15891,
      11826,
      7761,
      3696,
      65439,
      61374,
      57309,
      53244,
      48923,
      44858,
      40793,
      36728,
      37256,
      33193,
      45514,
      41451,
      53516,
      49453,
      61774,
      57711,
      4224,
      161,
      12482,
      8419,
      20484,
      16421,
      28742,
      24679,
      33721,
      37784,
      41979,
      46042,
      49981,
      54044,
      58239,
      62302,
      689,
      4752,
      8947,
      13010,
      16949,
      21012,
      25207,
      29270,
      46570,
      42443,
      38312,
      34185,
      62830,
      58703,
      54572,
      50445,
      13538,
      9411,
      5280,
      1153,
      29798,
      25671,
      21540,
      17413,
      42971,
      47098,
      34713,
      38840,
      59231,
      63358,
      50973,
      55100,
      9939,
      14066,
      1681,
      5808,
      26199,
      30326,
      17941,
      22068,
      55628,
      51565,
      63758,
      59695,
      39368,
      35305,
      47498,
      43435,
      22596,
      18533,
      30726,
      26663,
      6336,
      2273,
      14466,
      10403,
      52093,
      56156,
      60223,
      64286,
      35833,
      39896,
      43963,
      48026,
      19061,
      23124,
      27191,
      31254,
      2801,
      6864,
      10931,
      14994,
      64814,
      60687,
      56684,
      52557,
      48554,
      44427,
      40424,
      36297,
      31782,
      27655,
      23652,
      19525,
      15522,
      11395,
      7392,
      3265,
      61215,
      65342,
      53085,
      57212,
      44955,
      49082,
      36825,
      40952,
      28183,
      32310,
      20053,
      24180,
      11923,
      16050,
      3793,
      7920
    ]);
    function crc16(data) {
      if (!(data instanceof Buffer)) {
        data = Buffer.from(data);
      }
      let crc = 0;
      for (let index = 0; index < data.length; index++) {
        const byte = data[index];
        crc = (TABLE[(crc >> 8 ^ byte) & 255] ^ crc << 8) & 65535;
      }
      return crc;
    }
    function getMethodId(name) {
      return crc16(name) & 65535 | 65536;
    }
    exports.getMethodId = getMethodId;
  }
});

// node_modules/@ton/core/dist/crypto/safeSign.js
var require_safeSign = __commonJS({
  "node_modules/@ton/core/dist/crypto/safeSign.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.safeSignVerify = exports.safeSign = void 0;
    var crypto_1 = require_dist();
    var MIN_SEED_LENGTH = 8;
    var MAX_SEED_LENGTH = 64;
    function createSafeSignHash(cell, seed) {
      let seedData = Buffer.from(seed);
      if (seedData.length > MAX_SEED_LENGTH) {
        throw Error("Seed can	 be longer than 64 bytes");
      }
      if (seedData.length < MIN_SEED_LENGTH) {
        throw Error("Seed must be at least 8 bytes");
      }
      return (0, crypto_1.sha256_sync)(Buffer.concat([Buffer.from([255, 255]), seedData, cell.hash()]));
    }
    function safeSign(cell, secretKey, seed = "ton-safe-sign-magic") {
      return (0, crypto_1.sign)(createSafeSignHash(cell, seed), secretKey);
    }
    exports.safeSign = safeSign;
    function safeSignVerify(cell, signature, publicKey, seed = "ton-safe-sign-magic") {
      return (0, crypto_1.signVerify)(createSafeSignHash(cell, seed), signature, publicKey);
    }
    exports.safeSignVerify = safeSignVerify;
  }
});

// node_modules/@ton/core/dist/index.js
var require_dist2 = __commonJS({
  "node_modules/@ton/core/dist/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.safeSignVerify = exports.safeSign = exports.getMethodId = exports.base32Encode = exports.base32Decode = exports.crc32c = exports.crc16 = exports.fromNano = exports.toNano = exports.ComputeError = exports.openContract = exports.TupleBuilder = exports.TupleReader = exports.serializeTuple = exports.parseTuple = exports.generateMerkleUpdate = exports.generateMerkleProofDirect = exports.generateMerkleProof = exports.exoticPruned = exports.exoticMerkleUpdate = exports.convertToMerkleProof = exports.exoticMerkleProof = exports.Dictionary = exports.Cell = exports.CellType = exports.Slice = exports.beginCell = exports.Builder = exports.BitBuilder = exports.BitReader = exports.BitString = exports.contractAddress = exports.ADNLAddress = exports.ExternalAddress = exports.address = exports.Address = void 0;
    var Address_1 = require_Address();
    Object.defineProperty(exports, "Address", { enumerable: true, get: function() {
      return Address_1.Address;
    } });
    Object.defineProperty(exports, "address", { enumerable: true, get: function() {
      return Address_1.address;
    } });
    var ExternalAddress_1 = require_ExternalAddress();
    Object.defineProperty(exports, "ExternalAddress", { enumerable: true, get: function() {
      return ExternalAddress_1.ExternalAddress;
    } });
    var ADNLAddress_1 = require_ADNLAddress();
    Object.defineProperty(exports, "ADNLAddress", { enumerable: true, get: function() {
      return ADNLAddress_1.ADNLAddress;
    } });
    var contractAddress_1 = require_contractAddress();
    Object.defineProperty(exports, "contractAddress", { enumerable: true, get: function() {
      return contractAddress_1.contractAddress;
    } });
    var BitString_1 = require_BitString();
    Object.defineProperty(exports, "BitString", { enumerable: true, get: function() {
      return BitString_1.BitString;
    } });
    var BitReader_1 = require_BitReader();
    Object.defineProperty(exports, "BitReader", { enumerable: true, get: function() {
      return BitReader_1.BitReader;
    } });
    var BitBuilder_1 = require_BitBuilder();
    Object.defineProperty(exports, "BitBuilder", { enumerable: true, get: function() {
      return BitBuilder_1.BitBuilder;
    } });
    var Builder_1 = require_Builder();
    Object.defineProperty(exports, "Builder", { enumerable: true, get: function() {
      return Builder_1.Builder;
    } });
    Object.defineProperty(exports, "beginCell", { enumerable: true, get: function() {
      return Builder_1.beginCell;
    } });
    var Slice_1 = require_Slice();
    Object.defineProperty(exports, "Slice", { enumerable: true, get: function() {
      return Slice_1.Slice;
    } });
    var CellType_1 = require_CellType();
    Object.defineProperty(exports, "CellType", { enumerable: true, get: function() {
      return CellType_1.CellType;
    } });
    var Cell_1 = require_Cell();
    Object.defineProperty(exports, "Cell", { enumerable: true, get: function() {
      return Cell_1.Cell;
    } });
    var Dictionary_1 = require_Dictionary();
    Object.defineProperty(exports, "Dictionary", { enumerable: true, get: function() {
      return Dictionary_1.Dictionary;
    } });
    var exoticMerkleProof_1 = require_exoticMerkleProof();
    Object.defineProperty(exports, "exoticMerkleProof", { enumerable: true, get: function() {
      return exoticMerkleProof_1.exoticMerkleProof;
    } });
    Object.defineProperty(exports, "convertToMerkleProof", { enumerable: true, get: function() {
      return exoticMerkleProof_1.convertToMerkleProof;
    } });
    var exoticMerkleUpdate_1 = require_exoticMerkleUpdate();
    Object.defineProperty(exports, "exoticMerkleUpdate", { enumerable: true, get: function() {
      return exoticMerkleUpdate_1.exoticMerkleUpdate;
    } });
    var exoticPruned_1 = require_exoticPruned();
    Object.defineProperty(exports, "exoticPruned", { enumerable: true, get: function() {
      return exoticPruned_1.exoticPruned;
    } });
    var generateMerkleProof_1 = require_generateMerkleProof();
    Object.defineProperty(exports, "generateMerkleProof", { enumerable: true, get: function() {
      return generateMerkleProof_1.generateMerkleProof;
    } });
    Object.defineProperty(exports, "generateMerkleProofDirect", { enumerable: true, get: function() {
      return generateMerkleProof_1.generateMerkleProofDirect;
    } });
    var generateMerkleUpdate_1 = require_generateMerkleUpdate();
    Object.defineProperty(exports, "generateMerkleUpdate", { enumerable: true, get: function() {
      return generateMerkleUpdate_1.generateMerkleUpdate;
    } });
    var tuple_1 = require_tuple();
    Object.defineProperty(exports, "parseTuple", { enumerable: true, get: function() {
      return tuple_1.parseTuple;
    } });
    Object.defineProperty(exports, "serializeTuple", { enumerable: true, get: function() {
      return tuple_1.serializeTuple;
    } });
    var reader_1 = require_reader();
    Object.defineProperty(exports, "TupleReader", { enumerable: true, get: function() {
      return reader_1.TupleReader;
    } });
    var builder_1 = require_builder();
    Object.defineProperty(exports, "TupleBuilder", { enumerable: true, get: function() {
      return builder_1.TupleBuilder;
    } });
    __exportStar(require_export(), exports);
    var openContract_1 = require_openContract();
    Object.defineProperty(exports, "openContract", { enumerable: true, get: function() {
      return openContract_1.openContract;
    } });
    var ComputeError_1 = require_ComputeError();
    Object.defineProperty(exports, "ComputeError", { enumerable: true, get: function() {
      return ComputeError_1.ComputeError;
    } });
    var convert_1 = require_convert();
    Object.defineProperty(exports, "toNano", { enumerable: true, get: function() {
      return convert_1.toNano;
    } });
    Object.defineProperty(exports, "fromNano", { enumerable: true, get: function() {
      return convert_1.fromNano;
    } });
    var crc16_1 = require_crc16();
    Object.defineProperty(exports, "crc16", { enumerable: true, get: function() {
      return crc16_1.crc16;
    } });
    var crc32c_1 = require_crc32c();
    Object.defineProperty(exports, "crc32c", { enumerable: true, get: function() {
      return crc32c_1.crc32c;
    } });
    var base32_1 = require_base32();
    Object.defineProperty(exports, "base32Decode", { enumerable: true, get: function() {
      return base32_1.base32Decode;
    } });
    Object.defineProperty(exports, "base32Encode", { enumerable: true, get: function() {
      return base32_1.base32Encode;
    } });
    var getMethodId_1 = require_getMethodId();
    Object.defineProperty(exports, "getMethodId", { enumerable: true, get: function() {
      return getMethodId_1.getMethodId;
    } });
    var safeSign_1 = require_safeSign();
    Object.defineProperty(exports, "safeSign", { enumerable: true, get: function() {
      return safeSign_1.safeSign;
    } });
    Object.defineProperty(exports, "safeSignVerify", { enumerable: true, get: function() {
      return safeSign_1.safeSignVerify;
    } });
  }
});

// shim.js
var import_buffer = __toESM(require_buffer(), 1);
if (typeof globalThis.Buffer === "undefined") globalThis.Buffer = import_buffer.Buffer;

// entry.mjs
var import_core = __toESM(require_dist2(), 1);
var export_Address = import_core.Address;
var export_BitString = import_core.BitString;
var export_Builder = import_core.Builder;
var export_Cell = import_core.Cell;
var export_Dictionary = import_core.Dictionary;
var export_SendMode = import_core.SendMode;
var export_Slice = import_core.Slice;
var export_beginCell = import_core.beginCell;
var export_comment = import_core.comment;
var export_contractAddress = import_core.contractAddress;
var export_external = import_core.external;
var export_internal = import_core.internal;
var export_loadMessageRelaxed = import_core.loadMessageRelaxed;
var export_loadStateInit = import_core.loadStateInit;
var export_storeMessage = import_core.storeMessage;
var export_storeMessageRelaxed = import_core.storeMessageRelaxed;
var export_storeStateInit = import_core.storeStateInit;
export {
  export_Address as Address,
  export_BitString as BitString,
  export_Builder as Builder,
  export_Cell as Cell,
  export_Dictionary as Dictionary,
  export_SendMode as SendMode,
  export_Slice as Slice,
  export_beginCell as beginCell,
  export_comment as comment,
  export_contractAddress as contractAddress,
  export_external as external,
  export_internal as internal,
  export_loadMessageRelaxed as loadMessageRelaxed,
  export_loadStateInit as loadStateInit,
  export_storeMessage as storeMessage,
  export_storeMessageRelaxed as storeMessageRelaxed,
  export_storeStateInit as storeStateInit
};
/*! Bundled license information:

ieee754/index.js:
  (*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> *)

buffer/index.js:
  (*!
   * The buffer module from node.js, for the browser.
   *
   * @author   Feross Aboukhadijeh <https://feross.org>
   * @license  MIT
   *)
*/
