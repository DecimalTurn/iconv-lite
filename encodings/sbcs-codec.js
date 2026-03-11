"use strict"
var Buffer = require("safer-buffer").Buffer

// Single-byte codec. Needs a 'chars' string parameter that contains 256 or 128 chars that
// correspond to encoded bytes (if 128 - then lower half is ASCII).

exports._sbcs = SBCSCodec
function SBCSCodec (codecOptions, iconv) {
  if (!codecOptions) {
    throw new Error("SBCS codec is called without the data.")
  }

  // Prepare char buffer for decoding.
  if (!codecOptions.chars || (codecOptions.chars.length !== 128 && codecOptions.chars.length !== 256)) {
    throw new Error("Encoding '" + codecOptions.type + "' has incorrect 'chars' (must be of len 128 or 256)")
  }

  if (codecOptions.chars.length === 128) {
    var asciiString = ""
    for (var i = 0; i < 128; i++) {
      asciiString += String.fromCharCode(i)
    }
    codecOptions.chars = asciiString + codecOptions.chars
  }

  this.decodeBuf = Buffer.from(codecOptions.chars, "ucs2")

  // Encoding buffer.
  var encodeBuf = Buffer.alloc(65536, iconv.defaultCharSingleByte.charCodeAt(0))

  for (var i = 0; i < codecOptions.chars.length; i++) {
    encodeBuf[codecOptions.chars.charCodeAt(i)] = i
  }

  this.encodeBuf = encodeBuf
  this.codecChars = codecOptions.chars // Keep chars for lazy isEncodeable construction
}

SBCSCodec.prototype.encoder = SBCSEncoder
SBCSCodec.prototype.decoder = SBCSDecoder

function SBCSEncoder (options, codec) {
  this.encodeBuf = codec.encodeBuf
  this.invalidCharHandler = options && options.invalidCharHandler

  // Lazily build isEncodeable lookup only if handler is provided
  this.isEncodeable = null
  if (typeof this.invalidCharHandler === "function") {
    this.codecChars = codec.codecChars
  }
}

SBCSEncoder.prototype.write = function (str) {
  var buf = Buffer.alloc(str.length)

  var encodeBuf = this.encodeBuf
  var invalidCharHandler = this.invalidCharHandler

  if (typeof invalidCharHandler === "function") {
    return encodeWithInvalidCharHandler(this, str, buf, encodeBuf, invalidCharHandler)
  }

  for (var i = 0; i < str.length; i++) {
    buf[i] = encodeBuf[str.charCodeAt(i)]
  }

  return buf
}

function encodeWithInvalidCharHandler (encoder, str, buf, encodeBuf, invalidCharHandler) {
  // Handler path: build isEncodeable lookup on first use
  var isEncodeable = encoder.isEncodeable
  if (!isEncodeable) {
    isEncodeable = encoder.isEncodeable = Buffer.alloc(65536, 0)
    var codecChars = encoder.codecChars
    for (var j = 0; j < codecChars.length; j++) {
      isEncodeable[codecChars.charCodeAt(j)] = 1
    }
  }

  for (var i = 0; i < str.length; i++) {
    var charCode = str.charCodeAt(i)

    if (isEncodeable[charCode]) {
      buf[i] = encodeBuf[charCode]
      continue
    }

    var shouldCancel = invalidCharHandler(str.charAt(i), i)
    buf[i] = encodeBuf[charCode]

    // Only a strict `true` cancels the rest of the encoding process; other return values are ignored.
    // This could eventually allow the handler to return a replacement character (e.g. 'e' instead of 'é').
    if (shouldCancel === true) {
      return (i + 1 < buf.length) ? buf.slice(0, i + 1) : buf
    }
  }

  return buf
}

SBCSEncoder.prototype.end = function () {
}

function SBCSDecoder (options, codec) {
  this.decodeBuf = codec.decodeBuf
}

SBCSDecoder.prototype.write = function (buf) {
  // Strings are immutable in JS -> we use ucs2 buffer to speed up computations.
  var decodeBuf = this.decodeBuf
  var newBuf = Buffer.alloc(buf.length * 2)
  var idx1 = 0; var idx2 = 0
  for (var i = 0; i < buf.length; i++) {
    idx1 = buf[i] * 2; idx2 = i * 2
    newBuf[idx2] = decodeBuf[idx1]
    newBuf[idx2 + 1] = decodeBuf[idx1 + 1]
  }
  return newBuf.toString("ucs2")
}

SBCSDecoder.prototype.end = function () {
}
