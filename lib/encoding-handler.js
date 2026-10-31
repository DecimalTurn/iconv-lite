// State belongs to an encoder, never to a cached codec or its mapping tables.
export class EncodingHandler {
  #callback
  #encoding
  #pending = null

  constructor (callback, encoding) {
    this.#callback = callback
    this.#encoding = encoding
  }

  get hasPending () { return this.#pending !== null }

  clear () { this.#pending = null }

  * read (str, final = false) {
    if (str.length === 0 && !final) return
    const pending = this.#pending
    this.#pending = null
    if (pending) str = pending.char + str

    let index = 0
    for (let offset = 0; offset < str.length;) {
      const previous = pending !== null && offset === 0
      const position = previous ? pending.index : index
      const code = str.codePointAt(offset)
      const char = String.fromCodePoint(code)
      if (!final && code >= 0xD800 && code <= 0xDBFF && offset + 1 === str.length) {
        this.#pending = { char, index: position }
        return
      }
      yield { char, index: position }
      offset += char.length
      if (!previous || char.length === 2) index++
    }
  }

  resolve (char, index) {
    const result = this.#callback(char, index)
    if (result === true) return null
    if (result === undefined || result === false) return undefined
    if (typeof result === "string") return result
    throw new TypeError("invalidCharHandler must return a string, boolean, or undefined")
  }

  replacementError (char, index) {
    return new TypeError("Replacement " + JSON.stringify(char) + " cannot be encoded in " + this.#encoding + " at index " + index)
  }
}

// Only the opt-in handler path needs a growing output buffer.
export class EncodingBuffer {
  #backend
  #bytes
  #length = 0

  constructor (backend, capacity = 32) {
    this.#backend = backend
    this.#bytes = backend.allocBytes(Math.max(32, capacity))
  }

  writeByte (byte) {
    if (this.#length === this.#bytes.length) {
      const grown = this.#backend.allocBytes(this.#bytes.length * 2)
      grown.set(this.#bytes)
      this.#bytes = grown
    }
    this.#bytes[this.#length++] = byte
  }

  writeCode (code) {
    if (code > 0xFFFFFF) this.writeByte(code >>> 24)
    if (code > 0xFFFF) this.writeByte(code >>> 16)
    if (code > 0xFF) this.writeByte(code >>> 8)
    this.writeByte(code)
  }

  finish () { return this.#backend.bytesToResult(this.#bytes, this.#length) }
}
