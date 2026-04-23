/**
 * Convert the `result` field returned by a DAP `evaluate` request when the
 * evaluated expression returns a `string` into the underlying raw text.
 *
 * The .NET debug adapter (vsdbg / netcoredbg) returns the C# literal form of
 * a string, which means the value is wrapped in double quotes and contains
 * `\"`, `\n`, `\r`, `\t`, `\\`, `\u00xx` style escapes. Without unescaping it
 * the clipboard would receive `"{\n  \"k\": 1\n}"` instead of pretty JSON.
 *
 * The C# escape grammar is a strict subset of the JSON one for the cases we
 * care about, so `JSON.parse` is the safest unescaper and round-trips the
 * common cases correctly. If the input is not in the expected literal form
 * (some adapters / proxies strip the surrounding quotes for `clipboard`
 * context) we return it unchanged instead of throwing, which makes the
 * function safely idempotent.
 */
export function unescapeCsharpString(literal: string): string {
  if (typeof literal !== 'string') {
    return literal;
  }

  if (literal.length >= 2 && literal.startsWith('"') && literal.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(literal);
      if (typeof parsed === 'string') {
        return parsed;
      }
    } catch {
      // Fall through to the hand-rolled unescaper below for the rare cases
      // where the adapter emits an escape JSON does not understand (e.g.
      // C# specific `\a`, `\v` or `\xNN`).
    }

    return manualUnescape(literal.slice(1, -1));
  }

  return literal;
}

/**
 * Minimal, defensive unescaper for C# string literals. Only invoked when
 * `JSON.parse` rejects the literal. Handles the escape sequences the .NET
 * debug adapters are known to emit; unknown escapes are passed through.
 */
function manualUnescape(body: string): string {
  let out = '';
  let i = 0;
  while (i < body.length) {
    const ch = body.charCodeAt(i);
    if (ch !== 0x5c /* \\ */) {
      out += body[i];
      i += 1;
      continue;
    }

    const next = body[i + 1];
    if (next === undefined) {
      out += '\\';
      i += 1;
      continue;
    }

    switch (next) {
      case '"':
        out += '"';
        i += 2;
        break;
      case '\\':
        out += '\\';
        i += 2;
        break;
      case '/':
        out += '/';
        i += 2;
        break;
      case 'n':
        out += '\n';
        i += 2;
        break;
      case 'r':
        out += '\r';
        i += 2;
        break;
      case 't':
        out += '\t';
        i += 2;
        break;
      case 'b':
        out += '\b';
        i += 2;
        break;
      case 'f':
        out += '\f';
        i += 2;
        break;
      case '0':
        out += '\0';
        i += 2;
        break;
      case 'a':
        out += '\x07';
        i += 2;
        break;
      case 'v':
        out += '\x0b';
        i += 2;
        break;
      case 'u': {
        const hex = body.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else {
          out += body[i];
          i += 1;
        }
        break;
      }
      case 'x': {
        // Accept 1-4 hex digits (C# spec). Greedy match.
        const m = body.slice(i + 2).match(/^[0-9a-fA-F]{1,4}/);
        if (m) {
          out += String.fromCharCode(parseInt(m[0], 16));
          i += 2 + m[0].length;
        } else {
          out += body[i];
          i += 1;
        }
        break;
      }
      default:
        out += body[i];
        i += 1;
        break;
    }
  }
  return out;
}
