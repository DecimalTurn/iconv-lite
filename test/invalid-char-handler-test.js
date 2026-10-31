import assert from "assert"
import * as stream from "node:stream"
import defaultIconv from "../lib/index-node.js"
import Iconv from "../lib/iconv.js"

describe("invalidCharHandler (SBCS) #node-web", function () {
  let iconv

  beforeEach(function () {
    iconv = new Iconv(defaultIconv.backend)
    iconv.enableStreamingAPI(stream)
  })
  it("calls handler for unencodable chars", function () {
    var calls = []
    var res = iconv.encode("A世B", "latin1", {
      invalidCharHandler: function (char, index) {
        calls.push({ char: char, index: index })
      }
    })

    assert.strictEqual(Buffer.from(res).toString("binary"), "A?B")
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
    assert.strictEqual(Buffer.from(res).toString("binary"), "?A")
  })

  it("reports U+FFFD when the replacement byte is unassigned", function () {
    iconv.defaultCharSingleByte = "\x81"
    const calls = []
    const result = iconv.encode("�A?", "windows1252", {
      invalidCharHandler (char, index) {
        calls.push({ char, index })
      }
    })

    assert.deepStrictEqual(Array.from(result), [0x81, 0x41, 0x3F])
    assert.deepStrictEqual(calls, [{ char: "�", index: 0 }])
    assert.strictEqual(iconv.encode("�", "windows1252", {
      invalidCharHandler () { return true }
    }), null)
  })

  it("allows the valid character at the configured replacement byte", function () {
    iconv.defaultCharSingleByte = "\x80"
    const calls = []
    const result = iconv.encode("€世", "windows1252", {
      invalidCharHandler (char, index) {
        calls.push({ char, index })
      }
    })

    assert.deepStrictEqual(Array.from(result), [0x80, 0x80])
    assert.deepStrictEqual(calls, [{ char: "世", index: 1 }])
  })

  it("rejects a non-single-byte defaultCharSingleByte for SBCS", function () {
    iconv.defaultCharSingleByte = "�"
    assert.throws(function () {
      iconv.getCodec("iso88591")
    }, { name: "TypeError", message: "defaultCharSingleByte must be a single-byte character" })
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

    assert.strictEqual(Buffer.from(res).toString("binary"), "A???B")
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

    assert.strictEqual(Buffer.from(res).toString("binary"), "?")
  })

  it("keeps default replacement when handler returns nothing", function () {
    var res = iconv.encode("世", "latin1", {
      invalidCharHandler: function () {
      }
    })

    assert.strictEqual(Buffer.from(res).toString("binary"), "?")
  })
})
