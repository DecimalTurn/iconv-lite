import assert from "assert"
import iconv from "../lib/index-node.js"

describe("invalidCharHandler (MBCS) #node-web", function () {
  function hex (bytes) {
    return Buffer.from(bytes).toString("hex")
  }

  function withDefault (char, fn) {
    const originalDefault = iconv.defaultCharSingleByte
    const originalCache = iconv._codecDataCache
    iconv.defaultCharSingleByte = char
    iconv._codecDataCache = { __proto__: null }
    try {
      fn()
    } finally {
      iconv.defaultCharSingleByte = originalDefault
      iconv._codecDataCache = originalCache
    }
  }

  for (const encoding of ["shiftjis", "eucjp", "cp936", "gbk", "cp949", "cp950", "big5", "big5hkscs"]) {
    it(`reports unencodable code points without changing replacement output (${encoding})`, function () {
      const calls = []
      const input = "A?世🙂\uFFFFB"
      const expected = iconv.encode(input, encoding)
      const result = iconv.encode(input, encoding, {
        invalidCharHandler (char, index) { calls.push({ char, index }) }
      })

      assert.strictEqual(hex(result), hex(expected))
      assert.deepStrictEqual(calls, [{ char: "🙂", index: 3 }, { char: "\uFFFF", index: 4 }])
    })
  }

  it("allows valid GB18030 algorithmic mappings and counts them as single code points", function () {
    const calls = []
    const input = "A🙂\uFFFF\uD800B"
    const result = iconv.encode(input, "gb18030", {
      invalidCharHandler (char, index) { calls.push({ char, index }) }
    })

    assert.strictEqual(hex(result), hex(iconv.encode(input, "gb18030")))
    assert.deepStrictEqual(calls, [{ char: "\uD800", index: 3 }])
  })

  it("reports Shift-JIS aliases of the fallback byte, but not its decoded character", function () {
    for (const fallback of ["\\", "¥"]) {
      withDefault(fallback, function () {
        const calls = []
        const result = iconv.encode("\\¥?", "shiftjis", {
          invalidCharHandler (char, index) { calls.push({ char, index }) }
        })

        assert.strictEqual(hex(result), "5c5c3f")
        assert.deepStrictEqual(calls, [{ char: "¥", index: 1 }])
      })
    }
  })

  it("uses the actual fallback when the configured character is unmappable", function () {
    withDefault("\uFFFF", function () {
      const calls = []
      const result = iconv.encode("?\uFFFF", "shiftjis", {
        invalidCharHandler (char, index) { calls.push({ char, index }) }
      })

      assert.strictEqual(hex(result), "3f3f")
      assert.deepStrictEqual(calls, [{ char: "\uFFFF", index: 1 }])
    })
  })

  it("supports multibyte fallback mappings in write() and end()", function () {
    withDefault("中", function () {
      const calls = []
      const replacement = hex(iconv.encode("中", "shiftjis"))
      const input = "中\uFFFF\uD800"
      const result = iconv.encode(input, "shiftjis", {
        invalidCharHandler (char, index) { calls.push({ char, index }) }
      })

      assert.strictEqual(hex(result), replacement.repeat(3))
      assert.strictEqual(hex(iconv.encode(input, "shiftjis")), hex(result))
      assert.deepStrictEqual(calls, [{ char: "\uFFFF", index: 1 }, { char: "\uD800", index: 2 }])
    })
  })

  it("resolves a fallback character which also starts a Big5 sequence", function () {
    withDefault("Ê", function () {
      const calls = []
      const result = iconv.encode("Ê\u0304\uFFFFÊ", "big5", {
        invalidCharHandler (char, index) { calls.push({ char, index }) }
      })

      assert.strictEqual(hex(result), "886288668866")
      assert.deepStrictEqual(calls, [{ char: "\uFFFF", index: 2 }])
    })
  })

  it("does not report valid Big5 sequences split across writes", function () {
    const encoder = iconv.getEncoder("big5", {
      invalidCharHandler () { assert.fail("valid sequence reported as invalid") }
    })

    assert.strictEqual(hex(encoder.write("AÊ")), "41")
    assert.strictEqual(hex(encoder.write("")), "")
    assert.strictEqual(hex(encoder.write("\u0304")), "8862")
    assert.strictEqual(hex(encoder.write("Ê")), "")
    assert.strictEqual(hex(encoder.end()), "8866")
  })

  it("reports the invalid character after a sequence prefix, not the prefix", function () {
    for (const suffix of ["\uFFFF", "\uDC00", "\uD800B", "🙂"]) {
      const calls = []
      const encoder = iconv.getEncoder("big5", {
        invalidCharHandler (char, index) { calls.push({ char, index }) }
      })

      assert.strictEqual(hex(encoder.write("Ê")), "")
      const result = encoder.write(suffix)
      assert.strictEqual(hex(result), "88663f" + (suffix.endsWith("B") ? "42" : ""))
      assert.strictEqual(hex(result), hex(iconv.encode("Ê" + suffix, "big5")))
      assert.deepStrictEqual(calls, [{ char: suffix.endsWith("B") ? "\uD800" : suffix, index: 0 }])
      assert.strictEqual(encoder.end(), undefined)
    }
  })

  it("counts encodable astral characters and sequence characters individually", function () {
    const calls = []
    const result = iconv.encode("A𠕇Ê\u0304\uFFFF", "big5", {
      invalidCharHandler (char, index) { calls.push({ char, index }) }
    })

    assert.strictEqual(hex(result), "41fa4088623f")
    assert.deepStrictEqual(calls, [{ char: "\uFFFF", index: 4 }])
  })

  it("reports complete surrogate pairs split across writes at their original index", function () {
    const calls = []
    const encoder = iconv.getEncoder("shiftjis", {
      invalidCharHandler (char, index) { calls.push({ char, index }) }
    })

    assert.strictEqual(hex(encoder.write("A\uD83D")), "41")
    assert.strictEqual(hex(encoder.write("")), "")
    assert.strictEqual(hex(encoder.write("\uDE42\uFFFF")), "3f3f")
    assert.deepStrictEqual(calls, [{ char: "🙂", index: 1 }, { char: "\uFFFF", index: 1 }])
    assert.strictEqual(encoder.end(), undefined)
  })

  it("preserves encodable surrogate pairs split across writes", function () {
    for (const encoding of ["big5", "gb18030"]) {
      const encoder = iconv.getEncoder(encoding, {
        invalidCharHandler () { assert.fail("encodable surrogate pair reported as invalid") }
      })
      assert.strictEqual(hex(encoder.write("\uD841")), "")
      assert.strictEqual(hex(encoder.write("\uDD47")), hex(iconv.encode("𠕇", encoding)))
      assert.strictEqual(encoder.end(), undefined)
    }
  })

  it("reports each lone surrogate with its original value and code-point index", function () {
    const calls = []
    const input = "\uD800\uD801A\uDC00\uD802"
    const result = iconv.encode(input, "shiftjis", {
      invalidCharHandler (char, index) { calls.push({ char, index }) }
    })

    assert.strictEqual(hex(result), "3f3f413f3f")
    assert.deepStrictEqual(calls, [
      { char: "\uD800", index: 0 }, { char: "\uD801", index: 1 },
      { char: "\uDC00", index: 3 }, { char: "\uD802", index: 4 }
    ])
  })

  it("reports a pending lone surrogate before processing the next chunk", function () {
    const calls = []
    const encoder = iconv.getEncoder("shiftjis", {
      invalidCharHandler (char, index) { calls.push({ char, index }) }
    })

    assert.strictEqual(hex(encoder.write("AB\uD800")), "4142")
    assert.strictEqual(hex(encoder.write("C\uFFFF")), "3f433f")
    assert.deepStrictEqual(calls, [{ char: "\uD800", index: 2 }, { char: "\uFFFF", index: 1 }])
  })

  it("retains a pending surrogate's index until end()", function () {
    const calls = []
    const encoder = iconv.getEncoder("shiftjis", {
      invalidCharHandler (char, index) { calls.push({ char, index }) }
    })

    assert.strictEqual(hex(encoder.write("AB\uD800")), "4142")
    assert.strictEqual(hex(encoder.write("")), "")
    assert.strictEqual(hex(encoder.end()), "3f")
    assert.deepStrictEqual(calls, [{ char: "\uD800", index: 2 }])
    assert.strictEqual(encoder.end(), undefined)
  })

  it("discards a stopped write and allows clean encoder reuse", function () {
    const calls = []
    const encoder = iconv.getEncoder("big5", {
      invalidCharHandler (char, index) {
        calls.push({ char, index })
        return true
      }
    })

    assert.strictEqual(hex(encoder.write("XÊ\uD83D")), "58")
    assert.strictEqual(encoder.write("\uDE42\uFFFF"), null)
    assert.deepStrictEqual(calls, [{ char: "🙂", index: 2 }])
    assert.strictEqual(encoder.end(), undefined)
    assert.strictEqual(encoder.write("\u0304B"), null)
    assert.deepStrictEqual(calls[1], { char: "\u0304", index: 0 })
    assert.strictEqual(hex(encoder.write("BÊ\u0304")), "428862")
  })

  it("stops one-shot encoding during write() or end() without leaking pending output", function () {
    for (const input of ["A\uFFFFÊ\uD800", "AÊ\uD800", "A\uD800"]) {
      const calls = []
      assert.strictEqual(iconv.encode(input, "big5", {
        invalidCharHandler (char, index) {
          calls.push({ char, index })
          return true
        }
      }), null)
      assert.strictEqual(calls.length, 1)
    }
  })

  it("allows reuse after stopping end()", function () {
    const encoder = iconv.getEncoder("big5", { invalidCharHandler () { return true } })
    assert.strictEqual(hex(encoder.write("AÊ\uD800")), "41")
    assert.strictEqual(encoder.end(), null)
    assert.strictEqual(encoder.end(), undefined)
    assert.strictEqual(hex(encoder.write("B")), "42")
  })

  it("keeps normal output unless the handler returns exactly true", function () {
    for (const value of [undefined, false, "!", 1]) {
      assert.strictEqual(hex(iconv.encode("\uFFFF", "shiftjis", {
        invalidCharHandler () { return value }
      })), "3f")
    }
    assert.strictEqual(hex(iconv.encode("\uFFFF", "shiftjis", { invalidCharHandler: true })), "3f")
  })

  it("propagates handler exceptions from write() and end() and clears pending state", function () {
    const error = new Error("Cannot encode")
    for (const atEnd of [false, true]) {
      const encoder = iconv.getEncoder("big5", { invalidCharHandler () { throw error } })
      encoder.write("Ê\uD800")
      assert.throws(function () {
        if (atEnd) encoder.end()
        else encoder.write("B")
      }, function (err) { return err === error })
      assert.strictEqual(encoder.end(), undefined)
      assert.strictEqual(hex(encoder.write("B")), "42")
    }
  })

  it("preserves output at every chunk boundary with and without a handler", function () {
    const inputs = ["AÊ\u0304𠕇🙂\uFFFFB", "Ê\uDC00\uD800\uD801A\uDC00Ê\uD802"]
    for (const encoding of ["shiftjis", "eucjp", "gbk", "cp949", "cp950", "big5", "gb18030"]) {
      for (const input of inputs) {
        const expected = hex(iconv.encode(input, encoding))
        for (let split = 0; split <= input.length; split++) {
          for (const options of [undefined, { invalidCharHandler () {} }]) {
            const encoder = iconv.getEncoder(encoding, options)
            const chunks = [
              encoder.write(input.slice(0, split)),
              encoder.write(""),
              encoder.write(input.slice(split)),
              encoder.end()
            ]
            assert.strictEqual(hex(Buffer.concat(chunks.filter(Boolean))), expected, `${encoding} at ${split}`)
          }
        }
      }
    }
  })

  it("continues encoding after a stopped stream chunk", function (done) {
    const chunks = []
    const calls = []
    const stream = iconv.encodeStream("big5", {
      invalidCharHandler (char, index) {
        calls.push({ char, index })
        return true
      }
    })
    stream.on("data", chunk => chunks.push(chunk))
    stream.on("error", done)
    stream.on("end", function () {
      try {
        assert.strictEqual(hex(Buffer.concat(chunks)), "5842")
        assert.deepStrictEqual(calls, [{ char: "🙂", index: 1 }])
        done()
      } catch (err) {
        done(err)
      }
    })
    stream.write("X")
    stream.write("A🙂")
    stream.end("B")
  })

  it("propagates an error detected during stream flushing", function (done) {
    const error = new Error("Pending surrogate")
    const stream = iconv.encodeStream("shiftjis", { invalidCharHandler () { throw error } })
    stream.on("data", function () {})
    stream.on("error", function (err) {
      assert.strictEqual(err, error)
      done()
    })
    stream.end("A\uD800")
  })
})

describe("invalidCharHandler (SBCS)", function () {
  it("calls handler for unencodable chars", function () {
    var calls = []
    var res = iconv.encode("A世B", "latin1", {
      invalidCharHandler: function (char, index) {
        calls.push({ char: char, index: index })
      }
    })

    assert.strictEqual(res.toString("binary"), "A?B")
    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0].char, "世")
    assert.strictEqual(calls[0].index, 1)
  })

  it("does not call handler for encodable chars including '?'", function () {
    var called = false
    var res = iconv.encode("?A", "latin1", {
      invalidCharHandler: function () {
        called = true
      }
    })

    assert.strictEqual(called, false)
    assert.strictEqual(res.toString("binary"), "?A")
  })

  it("rejects a non-single-byte defaultCharSingleByte for SBCS", function () {
    var encoding = "iso88591"
    var originalDefaultCharSingleByte = iconv.defaultCharSingleByte
    var codecKey = iconv._canonicalizeEncoding(encoding)
    var cachedCodec = iconv._codecDataCache[codecKey]
    delete iconv._codecDataCache[codecKey]

    try {
      iconv.defaultCharSingleByte = "�"
      assert.throws(function () {
        iconv.getCodec(encoding)
      }, function (err) {
        assert.strictEqual(err.name, "TypeError")
        assert.strictEqual(err.message, "defaultCharSingleByte must be a single-byte character")
        return true
      })
    } finally {
      iconv.defaultCharSingleByte = originalDefaultCharSingleByte
      if (cachedCodec) {
        iconv._codecDataCache[codecKey] = cachedCodec
      } else {
        delete iconv._codecDataCache[codecKey]
      }
    }
  })

  it("propagates thrown errors", function () {
    assert.throws(function () {
      iconv.encode("世", "latin1", {
        invalidCharHandler: function () {
          throw new Error("boom")
        }
      })
    }, /boom/)
  })

  it("supports error message with full character details", function () {
    var encoding = "latin1"

    assert.throws(function () {
      iconv.encode("Hello 世", encoding, {
        invalidCharHandler: function (char, index) {
          throw new Error("Cannot encode character " + char + " at index " + index + " to " + encoding)
        }
      })
    }, function (err) {
      assert.strictEqual(err.message, "Cannot encode character 世 at index 6 to latin1")
      return true
    })
  })

  it("supports error message with full character details (even for surrogate pairs)", function () {
    var encoding = "latin1"

    assert.throws(function () {
      iconv.encode("Hello 🙂", encoding, {
        invalidCharHandler: function (char, index) {
          throw new Error("Cannot encode character " + char + " at index " + index + " to " + encoding)
        }
      })
    }, function (err) {
      assert.strictEqual(err.message, "Cannot encode character 🙂 at index 6 to latin1")
      return true
    })
  })

  it("reports index as Unicode code-point position", function () {
    var calls = []
    var res = iconv.encode("A🙂世B", "latin1", {
      invalidCharHandler: function (char, index) {
        calls.push({ char: char, index: index })
      }
    })

    assert.strictEqual(res.toString("binary"), "A???B")
    assert.strictEqual(calls.length, 2)
    assert.strictEqual(calls[0].char, "🙂")
    assert.strictEqual(calls[0].index, 1)
    assert.strictEqual(calls[1].char, "世")
    assert.strictEqual(calls[1].index, 2)
  })

  it("supports stopping SBCS encoding via handler return value", function () {
    var calls = []
    var res = iconv.encode("A世界B", "latin1", {
      invalidCharHandler: function (char, index) {
        calls.push({ char: char, index: index })
        return true
      }
    })

    assert.strictEqual(res, null)
    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0].char, "世")
    assert.strictEqual(calls[0].index, 1)
    // We don't call the handler for "界" because we stopped encoding after "世".
  })

  it("allows a handler to append a fallback before continuing", function () {
    var calls = []
    var output = []
    var replacements = {
      "🙂": ":)"
    }
    var encoder = iconv.getEncoder("latin1", {
      invalidCharHandler: function (char, index) {
        calls.push({ char: char, index: index })
        var replacement = replacements[char]
        assert.notStrictEqual(replacement, undefined)
        output.push(iconv.encode(replacement, "latin1"))
        return true
      }
    })

    output.push(encoder.write("Hello "))
    assert.strictEqual(encoder.write("🙂"), null)
    output.push(encoder.write(" world"))

    assert.strictEqual(Buffer.concat(output).toString("binary"), "Hello :) world")
    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0].char, "🙂")
    assert.strictEqual(calls[0].index, 0)
    assert.strictEqual(encoder.end(), undefined)
  })

  it("continues encoding after handler stops a stream chunk", function (done) {
    var calls = []
    var chunks = []
    var stream = iconv.encodeStream("latin1", {
      invalidCharHandler: function (char, index) {
        calls.push({ char: char, index: index })
        return true
      }
    })

    stream.on("data", function (chunk) { chunks.push(chunk) })
    stream.on("end", function () {
      try {
        assert.strictEqual(Buffer.concat(chunks).toString("binary"), "B")
        assert.strictEqual(calls.length, 1)
        done()
      } catch (e) {
        done(e)
      }
    })
    stream.write("A世")
    stream.end("B")
  })

  it("keeps default replacement when handler returns a value", function () {
    var res = iconv.encode("世", "latin1", {
      invalidCharHandler: function () {
        return "!"
      }
    })

    assert.strictEqual(res.toString("binary"), "?")
  })

  it("keeps default replacement when handler returns nothing", function () {
    var res = iconv.encode("世", "latin1", {
      invalidCharHandler: function () {
      }
    })

    assert.strictEqual(res.toString("binary"), "?")
  })
})
