"use strict";
// Just enough JavaScript lexing to answer one question mechanically:
// "which names does this module declare, and does a function body touch a name
// that belongs to another module's scope?"
//
// Why not a parser: this repository has no JS parser dependency and the engine
// source is plain CommonJS with column-0 top-level declarations. What matters is
// that a MECHANICAL split cannot silently move code that reads or writes module
// state - which is exactly what happened: `let world=null,bridge=null,...` is a
// list of declarators, but a naive reader only sees the first name, so `bridge`
// looked like a free variable and code touching it was moved out of the module.
//
// Everything here is deliberately conservative: when in doubt a name counts as
// "used", so a real coupling is reported rather than missed.

// Names that exist without any declaration in a CommonJS module.
const GLOBALS = new Set([
  "require", "module", "exports", "process", "console", "Buffer", "__filename", "__dirname",
  "global", "globalThis", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "setImmediate", "clearImmediate", "queueMicrotask", "structuredClone", "URL", "URLSearchParams",
  "TextEncoder", "TextDecoder", "AbortController", "fetch", "performance",
  "Object", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Math", "JSON", "Date",
  "RegExp", "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError",
  "URIError", "Promise", "Map", "Set", "WeakMap", "WeakSet", "Proxy", "Reflect", "Intl",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent",
  "encodeURI", "decodeURI", "escape", "unescape", "undefined", "NaN", "Infinity",
  "arguments", "this", "super", "new", "typeof", "instanceof", "in", "of", "void", "delete",
  "if", "else", "for", "while", "do", "return", "function", "class", "const", "let", "var",
  "try", "catch", "finally", "throw", "switch", "case", "default", "break", "continue",
  "async", "await", "yield", "static", "get", "set", "extends", "true", "false", "null", "with",
]);

// Remove comments and string/template literals, so a name inside a message,
// a log line or a require() specifier never counts as a reference.
function stripComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const d = source[i + 1];
    if (c === "/" && d === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      out += " ";
      continue;
    }
    // A regex literal is not a string, but its body is a name magnet
    // (`/^Haul /` looks like a reference to `Haul`). Division shares the slash,
    // so decide by what precedes it.
    if (c === "/" && d !== "=") {
      const head = out.replace(/\s+$/, "");
      const prev = head.slice(-1);
      const afterKeyword = /\b(?:return|typeof|case|in|of|void|delete|instanceof|new)$/.test(head);
      if (afterKeyword || prev === "" || "(,=:[!&|?{};+-*%~^<>".includes(prev)) {
        let j = i + 1;
        let inClass = false;
        while (j < source.length) {
          const ch = source[j];
          if (ch === "\\") { j += 2; continue; }
          if (ch === "\n") break;
          if (ch === "[") inClass = true;
          else if (ch === "]") inClass = false;
          else if (ch === "/" && !inClass) { j++; break; }
          j++;
        }
        if (source[j - 1] === "/") {
          // keep flags out of the identifier scan too
          while (j < source.length && /[a-z]/.test(source[j])) j++;
          out += " ";
          i = j;
          continue;
        }
      }
    }
    out += c;
    i++;
  }
  return out;
}

// Split on commas that are not inside brackets.
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === "," && depth <= 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

// Binding names of a declarator list (`a=1, {b, c:d}, [e]`) or a parameter list.
function bindingNames(text) {
  const out = new Set();
  for (const raw of splitTopLevel(text)) {
    const part = raw.trim();
    if (!part) continue;
    if (part.startsWith("{") || part.startsWith("[")) {
      const close = part.startsWith("{") ? part.lastIndexOf("}") : part.lastIndexOf("]");
      let inner = part.slice(1, close >= 0 ? close : undefined);
      // `{b:c}` binds c and treats b as a key, so take the value of every
      // key:value pair first, then whatever identifiers remain.
      for (const pair of [...inner.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)/g)]) {
        if (!GLOBALS.has(pair[2])) out.add(pair[2]);
        inner = inner.replace(pair[0], " ");
      }
      for (const match of [...inner.matchAll(/[A-Za-z_$][\w$]*/g)]) {
        if (!GLOBALS.has(match[0])) out.add(match[0]);
      }
      continue;
    }
    const first = /^([A-Za-z_$][\w$]*)/.exec(part);
    if (first && !GLOBALS.has(first[1])) out.add(first[1]);
  }
  return out;
}

// Every name declared anywhere in a module body (functions, classes, all
// declarators of every const/let/var, parameters, catch and for-of bindings).
function declaredNames(strippedText) {
  const names = new Set();
  const add = (name) => { if (!GLOBALS.has(name)) names.add(name); };
  for (const m of strippedText.matchAll(/(?:^|[^.\w$])(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g)) add(m[1]);
  for (const m of strippedText.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of strippedText.matchAll(/\b(?:const|let|var)\s+/g)) {
    for (const name of bindingNames(declaratorText(strippedText, m.index + m[0].length))) add(name);
  }
  for (const m of strippedText.matchAll(/function\s*\*?\s*[A-Za-z_$\w$]*\s*\(([^)]*)\)/g)) for (const name of bindingNames(m[1])) add(name);
  // Object-literal method definitions: `authorizePayout({factionID}){ ... }`.
  for (const m of strippedText.matchAll(/(?:^|[^.\w$])[A-Za-z_$][\w$]*\s*\(([^)]*)\)\s*\{/g)) for (const name of bindingNames(m[1])) add(name);
  for (const m of strippedText.matchAll(/\(([^()]*)\)\s*=>/g)) for (const name of bindingNames(m[1])) add(name);
  for (const m of strippedText.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1]);
  for (const m of strippedText.matchAll(/catch\s*\(([^)]*)\)/g)) for (const name of bindingNames(m[1])) add(name);
  for (const m of strippedText.matchAll(/for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  return names;
}

// The declarator text that starts at `from`: every declarator of the statement,
// across lines, up to the terminating `;` at depth 0.
function declaratorText(text, from) {
  let i = from;
  let depth = 0;
  let out = "";
  while (i < text.length) {
    const ch = text[i];
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) { if (depth === 0) break; depth--; }
    else if (ch === ";" && depth === 0) break;
    else if (ch === "\n" && depth === 0) {
      if (!/[,=([]$/.test(text.slice(0, i).trimEnd())) break;
    }
    out += ch;
    i++;
  }
  return out;
}

// Module-level declarations of a file: the names whose value lives in that
// module's own scope.
function moduleLevelNames(source) {
  const text = stripComments(source).replace(/\r/g, "");
  const lines = text.split("\n");
  const names = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^[A-Za-z_$]/.test(line)) continue;
    const fn = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(line);
    if (fn) names.add(fn[1]);
    const cls = /^class\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (cls) names.add(cls[1]);
    if (!/^(?:const|let|var)\s/.test(line)) continue;
    // Collect the whole statement (it may span lines and hold several statements).
    let statement = line;
    let depth = 0;
    const terminated = () => {
      depth = 0;
      for (const ch of statement) {
        if ("([{".includes(ch)) depth++;
        else if (")]}".includes(ch)) depth--;
      }
      const tail = statement.trimEnd();
      return depth <= 0 && (tail.endsWith(";") || !/[,=([]$/.test(tail));
    };
    while (!terminated() && i + 1 < lines.length && !/^[A-Za-z_$]/.test(lines[i + 1])) {
      statement += `\n${lines[++i]}`;
    }
    for (const chunk of statement.split(";")) {
      const decl = /^\s*(?:const|let|var)\s+([\s\S]*)$/.exec(chunk);
      if (!decl) continue;
      for (const name of bindingNames(decl[1])) names.add(name);
    }
  }
  return names;
}

// Names this module assigns to (`x =`, `x +=`, `x++`, `x ||=`) without declaring
// them. In strict mode that is a ReferenceError the first time it runs.
function assignedNames(strippedText) {
  const names = new Set();
  const re = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*(?:\+=|-=|\*=|\/=|%=|\|\|=|&&=|\?\?=|=(?![=>])|\+\+|--)/g;
  for (const m of strippedText.matchAll(re)) {
    if (GLOBALS.has(m[1])) continue;
    if (/\?\.\s*$/.test(m[0])) continue;
    names.add(m[1]);
  }
  for (const m of strippedText.matchAll(/(\+\+|--)\s*([A-Za-z_$][\w$]*)/g)) {
    if (!GLOBALS.has(m[2])) names.add(m[2]);
  }
  return names;
}

// Names this module reads that are not member accesses or object keys
// (`instance.start()` and `{start: 1}` are not references to a binding).
function usedNames(strippedText) {
  const names = new Set();
  // Match the identifier and then look at what follows it. Doing that in one
  // regex with `(?!\s*:)` backtracks to a shorter name (`actionID` -> `actionI`),
  // which turns every long identifier into a phantom reference.
  for (const m of strippedText.matchAll(/([^.\w$]|^)([A-Za-z_$][\w$]*)/g)) {
    const after = strippedText.slice(m.index + m[0].length, m.index + m[0].length + 60);
    if (/^\s*:/.test(after)) continue; // object key, not a reference to a binding
    if (/^\s*\([^)]*\)\s*\{/.test(after)) continue; // method definition key, same thing
    if (!GLOBALS.has(m[2])) names.add(m[2]);
  }
  return names;
}

module.exports = { GLOBALS, stripComments, bindingNames, declaredNames, moduleLevelNames, assignedNames, usedNames };
