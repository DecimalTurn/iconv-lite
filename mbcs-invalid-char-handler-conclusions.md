# MBCS `invalidCharHandler` conclusions

## Conclusion

It should be possible to extend the current `invalidCharHandler` strategy to
the MBCS encoders without redesigning the public API. The main implementation
would belong in [`encodings/dbcs-codec.js`](./encodings/dbcs-codec.js), with
corresponding tests and documentation updates.

## Why the implementation is different from SBCS

The SBCS encoder pre-fills its lookup table with the fallback byte. It
therefore has to infer that a character is unmappable when it produces that
byte, while allowing the character that genuinely maps to the configured
fallback byte.

The MBCS encoder generally represents an unmappable character as `UNASSIGNED`,
so ordinary unmappable-character detection is straightforward. However, to
match the current strategy exactly, it must also detect genuine mappings that
produce the fallback code but represent a different Unicode character.

For example, if the configured fallback character is `\` in Shift-JIS, both
`\` and `¥` encode to `0x5c`. The handler should allow `\`, but report `¥`
because it is not the configured default character.

## Required behavior

The MBCS encoder should:

1. Resolve the complete mapping, including sequences and GB18030 algorithmic
   mappings.
2. Identify the actual MBCS fallback code (`defCharSB`) and the Unicode
   character represented by that fallback code.
3. Invoke `invalidCharHandler` when the input is `UNASSIGNED`, or when its
   mapping equals the fallback code but the input character is not the fallback
   character.
4. Emit valid mappings normally.
5. Preserve the existing early-termination behavior: returning `true` should
   return `null` and leave the encoder reusable.

## Edge cases

- **MBCS sequences:** Big5 and related encodings can defer output across
  multiple input characters. A sequence prefix must not be reported
  prematurely.
- **Surrogate pairs:** The handler should receive a complete code point where
  possible, consistently with the SBCS implementation.
- **Chunk boundaries:** Pending lead surrogates and sequence state can span
  `write()` calls.
- **`end()`:** Pending lone surrogates and incomplete sequences currently emit
  fallback output. Handler behavior for these cases should be defined and
  tested.
- **GB18030:** Algorithmically encodable characters must not be reported as
  invalid merely because they are absent from the ordinary encode table.
- **Streams and errors:** Stream encoding, handler exceptions, and stopped
  writes should behave consistently with SBCS.

## Recommended test coverage

Tests should cover:

- an unmappable MBCS character;
- a valid configured default character;
- a non-default character sharing the fallback bytes, such as Shift-JIS `¥`
  versus `\`;
- GB18030 algorithmic mappings;
- Big5 sequences split across writes;
- surrogate pairs and chunk boundaries;
- stream encoding;
- handler exceptions; and
- early termination and encoder reuse.

This is a reasonable follow-up change, but it should be implemented as
MBCS-specific mapping-aware logic rather than by simply copying the SBCS byte
comparison.
