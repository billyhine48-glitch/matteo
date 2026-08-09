const assert = require("assert");

// --- Simulate the safeMath function from the engine (line 68) ---

function safeMath(expr) {
  // sanitize
  const cleaned = String(expr)
    .replace(/[^0-9+\-*/^%.()a-zA-Z\s,]/g, "")
    .replace(/\^/g, "**")
    .replace(/\bpi\b/gi, "Math.PI")
    .replace(/\be\b/gi, "Math.E");

  // tokenize
  const tokens = [];
  let i = 0;
  const funcs = ["sqrt", "sin", "cos", "tan", "log", "abs", "pow", "max", "min", "round", "floor", "ceil"];
  while (i < cleaned.length) {
    const c = cleaned[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let num = "";
      while (i < cleaned.length && /[0-9.]/.test(cleaned[i])) { num += cleaned[i]; i++; }
      tokens.push({ type: "num", value: parseFloat(num) });
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let name = "";
      while (i < cleaned.length && /[a-zA-Z.]/.test(cleaned[i])) { name += cleaned[i]; i++; }
      if (name.startsWith("Math.")) {
        tokens.push({ type: "name", value: name });
      } else if (funcs.includes(name)) {
        tokens.push({ type: "name", value: "Math." + name });
      } else {
        // ignore unknown identifiers
        tokens.push({ type: "name", value: "0" });
      }
      continue;
    }
    if (c === "*" && cleaned[i + 1] === "*") {
      tokens.push({ type: "op", value: "**" });
      i += 2;
      continue;
    }
    if ("+-*/%(),".includes(c)) {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    i++;
  }

  // Recursive descent parser
  let pos = 0;
  function peek() { return tokens[pos]; }
  function next() { return tokens[pos++]; }

  function parseExpr() { return parseAdd(); }
  function parseAdd() {
    let left = parseMul();
    while (peek() && peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = next().value;
      const right = parseMul();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseMul() {
    let left = parsePow();
    while (peek() && peek().type === "op" && (peek().value === "*" || peek().value === "/" || peek().value === "%")) {
      const op = next().value;
      const right = parsePow();
      left = op === "*" ? left * right : op === "/" ? left / right : left % right;
    }
    return left;
  }
  function parsePow() {
    let left = parseUnary();
    if (peek() && peek().type === "op" && peek().value === "**") {
      next();
      const right = parsePow();
      left = Math.pow(left, right);
    }
    return left;
  }
  function parseUnary() {
    if (peek() && peek().type === "op" && peek().value === "-") { next(); return -parseUnary(); }
    if (peek() && peek().type === "op" && peek().value === "+") { next(); return parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error("unexpected end");
    if (t.type === "num") { next(); return t.value; }
    if (t.type === "name") {
      next();
      // could be Math.func(...) or a constant
      if (peek() && peek().type === "op" && peek().value === "(") {
        next();
        const args = [];
        if (!(peek() && peek().value === ")")) {
          args.push(parseExpr());
          while (peek() && peek().value === ",") { next(); args.push(parseExpr()); }
        }
        if (peek() && peek().value === ")") next(); else throw new Error("missing )");
        const fn = t.value.split(".")[1];
        if (typeof Math[fn] === "function") return Math[fn].apply(Math, args);
        throw new Error("unknown function " + fn);
      }
      // constant like Math.PI
      if (t.value.startsWith("Math.")) {
        const c = t.value.split(".")[1];
        if (typeof Math[c] === "number") return Math[c];
      }
      return 0;
    }
    if (t.type === "op" && t.value === "(") {
      next();
      const v = parseExpr();
      if (peek() && peek().value === ")") next(); else throw new Error("missing )");
      return v;
    }
    throw new Error("unexpected token");
  }

  const result = parseExpr();
  if (pos < tokens.length) throw new Error("trailing tokens");
  return result;
}

// --- Tests ---

describe("Safe math evaluator", () => {

  describe("Basic arithmetic", () => {
    it("should evaluate 2 + 2 = 4", () => {
      assert.strictEqual(safeMath("2 + 2"), 4);
    });
    it("should evaluate 10 - 5 = 5", () => {
      assert.strictEqual(safeMath("10 - 5"), 5);
    });
    it("should evaluate 3 * 4 = 12", () => {
      assert.strictEqual(safeMath("3 * 4"), 12);
    });
    it("should evaluate 20 / 4 = 5", () => {
      assert.strictEqual(safeMath("20 / 4"), 5);
    });
  });

  describe("Operator precedence", () => {
    it("should evaluate 2 + 3 * 4 = 14 (not 20)", () => {
      assert.strictEqual(safeMath("2 + 3 * 4"), 14);
    });
    it("should evaluate 2 * 3 + 4 = 10 (not 14)", () => {
      assert.strictEqual(safeMath("2 * 3 + 4"), 10);
    });
    it("should evaluate 10 - 2 * 3 = 4 (not 24)", () => {
      assert.strictEqual(safeMath("10 - 2 * 3"), 4);
    });
  });

  describe("Parentheses", () => {
    it("should evaluate (2 + 3) * 4 = 20", () => {
      assert.strictEqual(safeMath("(2 + 3) * 4"), 20);
    });
    it("should evaluate 2 * (3 + 4) = 14", () => {
      assert.strictEqual(safeMath("2 * (3 + 4)"), 14);
    });
  });

  describe("Power operator", () => {
    it("should evaluate 2 ** 3 = 8", () => {
      assert.strictEqual(safeMath("2 ** 3"), 8);
    });
    it("should evaluate 2 ^ 3 = 8 (caret syntax)", () => {
      assert.strictEqual(safeMath("2 ^ 3"), 8);
    });
    it("should evaluate 2 ** 3 ** 2 = 512 (right-associative)", () => {
      assert.strictEqual(safeMath("2 ** 3 ** 2"), 512);
    });
  });

  describe("Unary minus", () => {
    it("should evaluate -5 + 3 = -2", () => {
      assert.strictEqual(safeMath("-5 + 3"), -2);
    });
    it("should evaluate 3 + -2 = 1", () => {
      assert.strictEqual(safeMath("3 + -2"), 1);
    });
  });

  describe("Math functions", () => {
    it("should evaluate sqrt(16) = 4", () => {
      assert.strictEqual(safeMath("sqrt(16)"), 4);
    });
    it("should evaluate abs(-7) = 7", () => {
      assert.strictEqual(safeMath("abs(-7)"), 7);
    });
    it("should evaluate sin(0) = 0", () => {
      assert.strictEqual(safeMath("sin(0)"), 0);
    });
  });

  describe("Math constants", () => {
    it("should evaluate pi as Math.PI", () => {
      assert.strictEqual(safeMath("pi"), Math.PI);
    });
    it("should evaluate e as Math.E", () => {
      assert.strictEqual(safeMath("e"), Math.E);
    });
  });

  describe("Division by zero", () => {
    it("should return Infinity for 1 / 0", () => {
      assert.strictEqual(safeMath("1 / 0"), Infinity);
    });
  });

  describe("Invalid input", () => {
    it("should throw for empty string", () => {
      assert.throws(() => safeMath(""), Error);
    });
    it("should throw for trailing tokens: 2 + 2 3", () => {
      assert.throws(() => safeMath("2 + 2 3"), Error);
    });
  });
});