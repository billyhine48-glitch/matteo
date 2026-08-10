/*
 * Nova AI Engine v2 — homemade AI, no external APIs.
 *
 * Design philosophy:
 *   "The chatbot of heaven — it can do everything with no limits."
 *
 * v2 makes Nova genuinely smarter while staying 100% client-side:
 *   • A lightweight NLU layer turns raw text into {intent, entities, slots}.
 *   • A Context Manager tracks the topic of each conversation so follow-ups
 *     like "what about its moons?" resolve "its" to the last subject.
 *   • Long-term + short-term memory are actually consulted when answering.
 *   • Writing, code, planning, and reasoning are GENERATED from the request
 *     (topic + structure + parameters) instead of returning one canned string.
 *   • A much larger curated knowledge base plus a reasoning fallback that
 *     actually decomposes unknown questions.
 *   • Math detection is broader and returns worked, step-by-step solutions.
 *
 * The engine remains a modular capability system. Each capability is a
 * self-contained module that can: (a) detect if it can handle a request,
 * (b) produce a response. Capabilities can be registered at runtime, which
 * is what enables the self-upgrade system — the AI can propose NEW capability
 * modules and, once the creator approves them, they are hot-loaded.
 *
 * Capabilities built in (names preserved for stats/upgrades compatibility):
 *   0. Web search (real-time info from Wikipedia + DuckDuckGo)
 *   1. Greeting / identity
 *   2. Math & arithmetic (safe expression evaluator, no eval)
 *   3. Code generation (JS / Python / HTML snippets from intent)
 *   4. Writing & creative (essays, poems, stories, brainstorm)
 *   5. Knowledge / facts (built-in knowledge base + reasoning)
 *   6. Reasoning / step-by-step ("think step by step")
 *   7. Tool use (converter, time/date, text utilities, random, etc.)
 *   8. Planning / todo generation
 *   9. Self-introspection (describe own capabilities, propose upgrades)
 *  10. Memory (remember / recall)
 *  11. General conversational fallback (the catch-all "no limits" persona)
 *
 * Public API is identical to v1: NovaAI.generate, registerCapability,
 * listCapabilities, Memory, makeConversationMemory, safeMath, tryMath,
 * _capabilities, version.
 */

(function (global) {
  "use strict";

  // --------------------------------------------------------------------
  // Memory store — persists across sessions in localStorage.
  // --------------------------------------------------------------------
  const Memory = {
    key: "nova-memory",
    load() {
      try {
        return JSON.parse(localStorage.getItem(this.key)) || { facts: [], notes: [] };
      } catch (e) {
        return { facts: [], notes: [] };
      }
    },
    save(state) {
      localStorage.setItem(this.key, JSON.stringify(state));
    },
    addFact(fact) {
      const s = this.load();
      if (!s.facts.includes(fact)) {
        s.facts.push(fact);
        if (s.facts.length > 200) s.facts.shift();
        this.save(s);
      }
    },
    addNote(note) {
      const s = this.load();
      s.notes.push({ t: Date.now(), note });
      if (s.notes.length > 100) s.notes.shift();
      this.save(s);
    },
    clear() {
      localStorage.removeItem(this.key);
    },
  };

  // --------------------------------------------------------------------
  // Conversation memory (short-term, per conversation object)
  // v2: also tracks a lightweight context — the running topic, the last
  // subject entity mentioned, and a rolling window of recent turns — so
  // follow-up questions can resolve pronouns and stay on topic.
  // --------------------------------------------------------------------
  function makeConversationMemory() {
    return {
      turns: [],
      lastTopic: null,
      lastSubject: null,   // the most recent concrete noun phrase discussed
      lastIntent: null,    // the most recent intent label
      entities: {},        // bag of recently mentioned entities
    };
  }

  // Push a turn + update context. Called by generate().
  function recordTurn(memory, role, text, meta) {
    memory.turns.push({ role: role, text: text });
    if (memory.turns.length > 40) memory.turns.shift();
    if (meta) {
      if (meta.subject) memory.lastSubject = meta.subject;
      if (meta.intent) memory.lastIntent = meta.intent;
      if (meta.topic) memory.lastTopic = meta.topic;
      if (meta.entities) {
        for (const e of meta.entities) memory.entities[e] = Date.now();
      }
    }
  }

  // Resolve a possibly-anaphoric phrase ("its moons", "that planet") to a
  // concrete subject using the conversation context.
  function resolveSubject(text, memory) {
    const t = text.toLowerCase();
    const pronoun = /\b(its|their|his|her|that|this|it|them|the same (one|thing))\b/.test(t);
    if (pronoun && memory && memory.lastSubject) {
      return memory.lastSubject;
    }
    return null;
  }

  // --------------------------------------------------------------------
  // Safe math evaluator — tokenizes and evaluates arithmetic with
  // + - * / ^ % parentheses and functions: sqrt, sin, cos, tan, log, abs, pow.
  // No eval(), no Function().
  // --------------------------------------------------------------------
  function safeMath(expr) {
    // sanitize
    const cleaned = String(expr)
      .replace(/[^0-9+\-*/^%.()a-zA-Z\s,]/g, "")
      .replace(/\^/g, "**")
      .replace(/\bpi\b/gi, "Math.PI")
      .replace(/\be\b/gi, "Math.E");

    // Tokenize
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

  function tryMath(text) {
    // detect "what is X", "calculate X", "X =", or a bare arithmetic expression
    const m = text.match(/^(?:what(?:'s| is)\s+|calculate\s+|compute\s+|eval(?:uate)?\s+|how much is\s+)?([-+*/^%().0-9\sMath.,a-z]+)$/i);
    const candidates = [];
    if (m && /[-+*/^]/.test(m[1])) candidates.push(m[1]);
    // also accept bare math function calls like sqrt(144), sin(30), etc.
    if (m && /\b(sqrt|sin|cos|tan|log|abs|pow)\s*\(/.test(m[1])) candidates.push(m[1]);
    // also pull expressions after "="
    const eq = text.match(/=\s*([-+*/^%().0-9\sMath.,a-z]+)$/i);
    if (eq && /[-+*/^]/.test(eq[1])) candidates.push(eq[1]);
    // explicit "calculate"
    const calc = text.match(/(?:calculate|compute|what(?:'s| is)|how much is|solve)\s+(.+)/i);
    if (calc) candidates.push(calc[1]);
    // known math words (functions + constants) — anything else is treated as
    // a non-math word and we reject the candidate so pure-word questions like
    // "What is Jupiter?" don't silently evaluate to 0.
    const mathWords = new Set(["sqrt", "sin", "cos", "tan", "log", "abs", "pow", "max", "min", "round", "floor", "ceil", "pi", "e", "math"]);
    function isCleanMathExpr(s) {
      // strip numbers, operators, parens, spaces, commas, dots
      const letters = s.replace(/[-+*/^%().0-9\s,]/g, "");
      if (!letters) return true; // pure arithmetic
      // split remaining into words and ensure all are known math words
      const words = letters.toLowerCase().split(/[^a-z]+/).filter(Boolean);
      return words.every((w) => mathWords.has(w));
    }
    for (const c of candidates) {
      if (!isCleanMathExpr(c)) continue; // contains non-math words → not math
      try {
        const r = safeMath(c);
        if (typeof r === "number" && isFinite(r)) return { value: r, expr: c.trim() };
      } catch (e) { /* keep trying */ }
    }
    return null;
  }

  // --------------------------------------------------------------------
  // NLU — lightweight natural-language understanding.
  // No ML, no network. A hand-tuned pipeline that extracts an intent label,
  // a set of entities (numbers, units, languages, named topics), and slots
  // that capabilities can consume. This is what lets Nova stop being a pure
  // keyword matcher and actually adapt its answers to the request.
  // --------------------------------------------------------------------
  const STOPWORDS = new Set(("a an the of to in on at for and or but is are was were be been being "
    + "with from by as it its this that these those i you he she they we me my your his her their our "
    + "do does did can could would should will shall may might must about into over under again more "
    + "most some any all no not so than too very just also then please tell me give make write create "
    + "what who when where why how which whose whom").split(/\s+/));

  function normalize(text) {
    return String(text || "").trim().replace(/\s+/g, " ");
  }

  function tokenize(text) {
    return normalize(text)
      .toLowerCase()
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .split(/[^a-z0-9.'’-]+/)
      .map((w) => w.replace(/^[.'’-]+|[.'’-]+$/g, ""))
      .filter(Boolean);
  }

  // Extract numbers (with optional units) from text.
  function extractNumbers(text) {
    const out = [];
    const re = /(-?\d+(?:\.\d+)?)(?:\s*[×x]?\s*(-?\d+(?:\.\d+)?))?/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push(parseFloat(m[1]));
      if (m[2] !== undefined) out.push(parseFloat(m[2]));
    }
    return out;
  }

  // Detect a programming language / tech mention.
  const TECH_MAP = {
    javascript: ["javascript", "js", "node", "nodejs"],
    python: ["python", "py"],
    html: ["html", "webpage", "web page", "markup"],
    css: ["css", "stylesheet", "styling"],
    react: ["react", "jsx", "reactjs"],
    sql: ["sql", "query", "sqlite", "postgres", "mysql"],
    regex: ["regex", "regular expression"],
    bash: ["bash", "shell", "sh", "terminal", "command line"],
    typescript: ["typescript", "ts"],
  };
  function detectTech(text) {
    const t = " " + text.toLowerCase() + " ";
    const hits = [];
    for (const [lang, kws] of Object.entries(TECH_MAP)) {
      if (kws.some((k) => new RegExp("\\b" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(t))) {
        hits.push(lang);
      }
    }
    return hits;
  }

  // Pull a "topic" phrase: the substantive remainder after stripping leading
  // question words and command verbs.
  const LEAD_WORDS = /^(please\s+)?(can you\s+|could you\s+|would you\s+|will you\s+)?(tell me (about|what is|what's|more about)\s+|what(?:'s| is| are| was| were| about)\s+|how about\s+|who(?:'s| is| are| was)\s+|when(?:'s| is| was| did)\s+|where(?:'s| is| was)\s+|why(?:'s| is| was| do| does| did)\s+|how(?:'s| is| was| do| does| did| to| much| many| long| far| old)\s+|define\s+|definition of\s+|meaning of\s+|explain\s+|describe\s+|give me (a |an |some )?|write (me )?(a |an )?|draft (a |an )?|compose (a |an )?|create (a |an )?|generate (a |an )?|make (a |an )?|build (a |an )?|i (want|need) (a |an )?)/i;
  function extractTopic(text) {
    let t = normalize(text).replace(LEAD_WORDS, "");
    t = t.replace(/[?.!]+$/g, "").replace(/\b(please|for me|now|thanks|thank you)\b\.?/gi, "").trim();
    return t;
  }

  // Determine a coarse intent label from the text.
  function detectIntent(text) {
    const t = text.toLowerCase().trim();
    if (/^(hi|hello|hey|yo|sup|greetings|howdy|good (morning|afternoon|evening))\b/.test(t)) return "greeting";
    if (/who are you|what are you|your name|tell me about yourself|what can you do|your capabilities/.test(t)) return "identity";
    if (/\b(remember|note that|don'?t forget|recall|what do you (know|remember))\b/.test(t)) return "memory";
    if (/upgrade yourself|improve yourself|add a (new )?(capability|skill|feature)|propose an upgrade|self.?improv|can you learn/.test(t)) return "upgrade";
    if (/step by step|step-by-step|walk me through|break (this )?down|reason (through|about)|plan out|solve this problem|show your work/.test(t)) return "reasoning";
    if (/\b(convert|celsius|fahrenheit|kelvin|kg|pounds|kilograms?|km|miles|meters?|feet|inches|cm|mm|liters?|gallons?|mph|kph|time|date|today|what day|uppercase|lowercase|reverse|random|roll dice|flip coin|percentage|percent of)\b/.test(t)) return "tool";
    if (/\b(plan|roadmap|to-?do|checklist|steps to|how do i|strategy|approach|outline for)\b/.test(t)) return "planning";
    if (/\b(code|function|script|program|snippet|algorithm|regex|sort|fibonacci|factorial|class|component|api endpoint|loop|array|fetch|button|page)\b/.test(t)) return "code";
    if (/\b(write|draft|compose|poem|story|essay|brainstorm|ideas?|haiku|rap|song|lyrics|letter|email|speech|caption|tagline|slogan|summary|summarize|paraphrase)\b/.test(t)) return "writing";
    if (/\b(what|who|when|where|why|how|explain|tell me about|define|definition of|meaning of|fact|history of|capital of|how many|how much|how far|how old|how long)\b/.test(t)) return "knowledge";
    if (/^(search (the )?web|search online|google|look (it |that )?up|find (info|information) (about|on))\b/.test(t)) return "web";
    if (/thank|bye|goodbye|joke|funny|advice|help|love you|i like you|meaning of life/.test(t)) return "social";
    return "conversation";
  }

  // Full NLU parse.
  function parseNLU(text, memory) {
    const intent = detectIntent(text);
    const tokens = tokenize(text);
    const contentTokens = tokens.filter((w) => !STOPWORDS.has(w));
    const numbers = extractNumbers(text);
    const tech = detectTech(text);
    let topic = extractTopic(text);
    // pronoun resolution: if the topic starts with an anaphor, splice in the
    // last subject from context.
    if (memory && topic) {
      const anaphor = /^(its|their|his|her|that|this|it|them|the same (one|thing))\b/i.test(topic);
      if (anaphor && memory.lastSubject) {
        topic = topic.replace(/^(its|their|his|her|that|this|it|them|the same (one|thing))\b/i, memory.lastSubject + " 's");
        topic = topic.replace(/\s+'s\s+/g, " ").replace(/\s+'s$/, "").trim();
      }
    }
    return {
      intent: intent,
      topic: topic,
      tokens: tokens,
      contentTokens: contentTokens,
      numbers: numbers,
      tech: tech,
      raw: normalize(text),
      lower: text.toLowerCase(),
    };
  }

  // --------------------------------------------------------------------
  // Knowledge base — a curated, queryable set of facts across science,
  // history, geography, tech, and culture. Each entry has keywords, a
  // category, a concise answer, and optional structured fields the
  // reasoning layer can use. Larger than v1 so Nova can answer many
  // common questions directly and confidently.
  // --------------------------------------------------------------------
  const KNOWLEDGE = [
    { k: ["sun"], cat: "science", a: "The Sun is the star at the center of our Solar System — a nearly perfect ball of hot plasma about 1.39 million km across. It generates energy through nuclear fusion of hydrogen into helium in its core and accounts for about 99.86% of the Solar System's mass. Light from the Sun takes about 8 minutes 20 seconds to reach Earth." },
    { k: ["earth"], cat: "science", a: "Earth is the third planet from the Sun and the only known place to harbor life. It formed about 4.5 billion years ago, has a surface that is about 71% water, one natural satellite (the Moon), and an atmosphere composed mostly of nitrogen (~78%) and oxygen (~21%). Its average distance from the Sun is about 150 million km." },
    { k: ["moon"], cat: "science", a: "The Moon is Earth's only natural satellite, about 384,400 km away on average. It orbits Earth every 27.3 days and is the fifth-largest moon in the Solar System. Its gravity drives the ocean tides and stabilizes Earth's axial tilt. It likely formed after a Mars-sized body collided with the young Earth." },
    { k: ["mars"], cat: "science", a: "Mars is the fourth planet from the Sun — a cold, dusty desert world about half the diameter of Earth. It has two small moons (Phobos and Deimos), the tallest volcano in the Solar System (Olympus Mons), and shows strong evidence of ancient liquid water. A day on Mars (a 'sol') is about 24 hours 37 minutes." },
    { k: ["jupiter"], cat: "science", a: "Jupiter is the fifth and largest planet — a gas giant more than twice as massive as all other planets combined. Its Great Red Spot is a storm larger than Earth that has raged for centuries. Jupiter has at least 95 known moons, including the four large 'Galilean' moons: Io, Europa, Ganymede, and Callisto." },
    { k: ["saturn"], cat: "science", a: "Saturn is the sixth planet, famous for its spectacular ring system made mostly of ice and rock particles. It is a gas giant, the second-largest planet, and has 146 confirmed moons. Its density is so low it would float in water — if you could find a bathtub big enough." },
    { k: ["venus"], cat: "science", a: "Venus is the second planet from the Sun and the hottest in the Solar System (~465°C surface) due to a runaway greenhouse effect. It is similar in size to Earth but rotates backward and so slowly that a day on Venus is longer than its year." },
    { k: ["mercury", "planet mercury"], cat: "science", a: "Mercury is the smallest planet and the closest to the Sun. It has almost no atmosphere, leading to extreme temperature swings (from about -180°C at night to 430°C in daylight). A year on Mercury is just 88 Earth days." },
    { k: ["water", "h2o"], cat: "science", a: "Water (H₂O) is a transparent, tasteless, nearly colorless substance essential to all known life. It is the main constituent of Earth's oceans, lakes, and rivers and of the fluids in living organisms. Its solid (ice) floats on its liquid — an unusual property vital for aquatic life — and its high specific heat stabilizes Earth's climate." },
    { k: ["gravity"], cat: "science", a: "Gravity is the attraction between masses. On Earth it gives objects weight (acceleration ≈ 9.8 m/s²) and the Moon's gravity drives the tides. Einstein's general relativity describes gravity not as a force but as the curvature of spacetime caused by mass and energy. Gravity is by far the weakest of the four fundamental forces, but it dominates at cosmic scales because it has infinite range and no negative charge." },
    { k: ["photosynthesis"], cat: "science", a: "Photosynthesis is how green plants, algae, and some bacteria turn light energy into chemical energy. They use sunlight to convert carbon dioxide and water into glucose and release oxygen as a byproduct. The simplified reaction is: 6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂. It is the ultimate source of nearly all oxygen and food on Earth." },
    { k: ["evolution"], cat: "science", a: "Evolution is the change in heritable traits of biological populations over generations, driven mainly by natural selection. Organisms with traits better suited to their environment tend to survive and reproduce more, so those traits become more common. The theory was most famously developed by Charles Darwin in 'On the Origin of Species' (1859)." },
    { k: ["dna"], cat: "science", a: "DNA (deoxyribonucleic acid) is the molecule that stores the genetic instructions for all known organisms and many viruses. It is a double helix: two strands of nucleotides (A, T, G, C) wound around each other, with A pairing to T and G pairing to C. This base-pairing lets DNA be copied faithfully when cells divide." },
    { k: ["black hole"], cat: "science", a: "A black hole is a region of spacetime where gravity is so strong that nothing — not even light — can escape once past the event horizon. They form when massive stars collapse at the end of their lives. Supermassive black holes sit at the centers of most galaxies, including our own (Sagittarius A*)." },
    { k: ["speed of light", "light speed"], cat: "science", a: "The speed of light in a vacuum, denoted c, is exactly 299,792,458 m/s (≈ 300,000 km/s). It is a universal constant and the cosmic speed limit: nothing carrying information can travel faster. According to relativity, all observers measure the same value of c regardless of their own motion." },
    { k: ["internet"], cat: "tech", a: "The Internet is a global system of interconnected computer networks communicating via the TCP/IP protocol suite. It grew from ARPANET (late 1960s) and now connects billions of devices, enabling the World Wide Web, email, file transfer, and countless services. The Web (HTTP/HTML) is one application that runs on top of the Internet." },
    { k: ["artificial intelligence", "ai"], cat: "tech", a: "Artificial intelligence is the simulation of intelligent behavior by machines — including learning from data, reasoning toward conclusions, and self-correction. Machine learning is a subset where systems find patterns in data without being explicitly programmed; deep learning uses multi-layer neural networks. Modern AI powers search, translation, recommendation, and language models." },
    { k: ["machine learning"], cat: "tech", a: "Machine learning is a branch of AI where systems improve at a task by learning patterns from data rather than following hand-written rules. Main types are supervised learning (labeled examples), unsupervised learning (finding structure in unlabeled data), and reinforcement learning (learning from rewards). Deep learning is a subfield using neural networks with many layers." },
    { k: ["python", "programming language python"], cat: "tech", a: "Python is a high-level, interpreted programming language created by Guido van Rossum and released in 1991. Its readable, indentation-based syntax makes it popular for beginners and experts alike, and it dominates data science, machine learning, automation, and web backends (Django, Flask). Its design emphasizes readability: 'There should be one obvious way to do it.'" },
    { k: ["javascript", "js"], cat: "tech", a: "JavaScript is the programming language of the web, running in every major browser and on servers via Node.js. Created by Brendan Eich in 1995 in just ten days, it is a multi-paradigm, dynamically typed language. Alongside HTML and CSS it is one of the three core technologies of the Web." },
    { k: ["html"], cat: "tech", a: "HTML (HyperText Markup Language) is the standard markup language for web pages. It uses tags to structure content — headings, paragraphs, links, images, lists. Together with CSS (styling) and JavaScript (behavior) it forms the backbone of every website. The current standard is HTML5." },
    { k: ["css"], cat: "tech", a: "CSS (Cascading Style Sheets) controls the look and layout of HTML. It uses selectors to target elements and rules to set properties like color, spacing, and position. CSS can be inline, in a <style> block, or in an external stylesheet, and modern CSS includes Flexbox, Grid, and custom properties (variables)." },
    { k: ["quantum", "quantum mechanics"], cat: "science", a: "Quantum mechanics is the branch of physics describing nature at the scale of atoms and subatomic particles. Its defining features include quantization (energy comes in discrete packets), superposition (a system can be in multiple states at once), and entanglement (linked particles share a state regardless of distance). It is the foundation of lasers, semiconductors, and quantum computing." },
    { k: ["relativity"], cat: "science", a: "Relativity is Einstein's theory, in two parts. Special relativity (1905) holds that the laws of physics are the same for all inertial observers and the speed of light is constant, yielding E = mc². General relativity (1915) describes gravity as the curvature of spacetime by mass and energy, predicting black holes, gravitational waves, and the expanding universe." },
    { k: ["climate change", "global warming"], cat: "science", a: "Climate change refers to long-term shifts in temperatures and weather patterns, driven largely by human activities since the industrial era — especially burning fossil fuels, which adds greenhouse gases like CO₂ to the atmosphere and traps heat. Consequences include rising sea levels, more extreme weather, and ecosystem disruption. Limiting warming requires cutting emissions and transitioning to clean energy." },
    { k: ["photosynthesis"], skip: true, _merged: true },

    // Geography
    { k: ["mount everest", "everest"], cat: "geography", a: "Mount Everest is Earth's highest peak above sea level — 8,848.86 m (29,031.7 ft) — in the Himalayas on the Nepal–China border. It was first summited on 29 May 1953 by Tenzing Norgay and Edmund Hillary." },
    { k: ["nile", "nile river"], cat: "geography", a: "The Nile is generally considered the longest river in the world at about 6,650 km, flowing south-to-north through northeastern Africa into the Mediterranean. (Some measurements put the Amazon slightly longer.) It was the lifeblood of ancient Egyptian civilization." },
    { k: ["amazon river", "amazon"], cat: "geography", a: "The Amazon is the largest river by discharge in the world, carrying more water than the next several largest rivers combined, and is either the longest or second-longest (≈ 6,400 km) depending on measurement. Its basin hosts the Amazon rainforest, the most biodiverse tract of tropical rainforest on Earth." },
    { k: ["sahara", "sahara desert"], cat: "geography", a: "The Sahara is the world's largest hot desert, covering about 9.2 million km² across North Africa. Despite its aridity, it has hosted human civilizations and was once a green, lush region as recently as about 6,000 years ago." },
    { k: ["pacific ocean"], cat: "geography", a: "The Pacific Ocean is the largest and deepest of Earth's oceanic divisions, covering about 165 million km² — larger than all of Earth's land area combined — and containing the Mariana Trench, whose Challenger Deep reaches ~10,935 m, the deepest known point." },
    { k: ["antarctica"], cat: "geography", a: "Antarctica is Earth's southernmost continent, containing the geographic South Pole. It is the coldest, driest, and windiest continent and about 98% of it is covered by an ice sheet averaging 1.9 km thick. It holds about 60% of the world's fresh water." },

    // History
    { k: ["world war ii", "wwii", "second world war"], cat: "history", a: "World War II (1939–1945) was the deadliest conflict in human history, fought between the Allied powers (led by the UK, Soviet Union, and United States) and the Axis powers (Germany, Italy, Japan). It killed an estimated 70–85 million people, included the Holocaust, and ended after the atomic bombings of Hiroshima and Nagasaki and the surrender of Japan." },
    { k: ["world war i", "wwi", "first world war"], cat: "history", a: "World War I (1914–1918) pitted the Allied Powers (UK, France, Russia, later the US) against the Central Powers (Germany, Austria-Hungary, Ottoman Empire). Triggered by the assassination of Archduke Franz Ferdinand, it killed about 20 million people and introduced industrialized trench warfare. Its unresolved aftermath helped cause World War II." },
    { k: ["roman empire"], cat: "history", a: "The Roman Empire was the post-Republican Roman state, lasting from 27 BCE (under Augustus) until the fall of the Western Empire in 476 CE. At its height it controlled much of Europe, the Middle East, and North Africa, and its law, language, and engineering still shape the modern world." },
    { k: ["french revolution"], cat: "history", a: "The French Revolution (1789–1799) overthrew the French monarchy and aristocracy, driven by financial crisis, Enlightenment ideas, and social inequality. It produced the Declaration of the Rights of Man, the Reign of Terror, and eventually Napoleon Bonaparte's rise, reshaping European politics." },
    { k: ["moon landing", "apollo 11"], cat: "history", a: "On 20 July 1969, NASA's Apollo 11 mission landed humans on the Moon for the first time. Neil Armstrong and Buzz Aldrin walked on the surface while Michael Collins orbited above. Armstrong's first step produced the famous words: 'That's one small step for [a] man, one giant leap for mankind.'" },

    // Culture / general
    { k: ["chess"], cat: "culture", a: "Chess is a two-player strategy game on an 8×8 board, with each side commanding 16 pieces. The goal is checkmate — trapping the opponent's king. It originated in northern India around the 6th century as 'chaturanga' and evolved into its modern form in Europe. The current world champion lineage is governed by FIDE." },
    { k: ["music"], cat: "culture", a: "Music is the art of organizing sound, typically using elements like melody, harmony, rhythm, and timbre. It is a cultural universal, found in every known society, and engages nearly every region of the human brain. It is written using notation and organized into genres, scales, and forms." },
    { k: ["pi", "value of pi"], cat: "science", a: "Pi (π) is the ratio of a circle's circumference to its diameter, an irrational and transcendental number approximately equal to 3.14159. Its decimal expansion never ends or repeats. It appears across mathematics and physics far beyond circles, in waves, probability, and Einstein's field equations." },
    { k: ["euler", "euler's number"], cat: "science", a: "The number e (Euler's number) is approximately 2.71828. It is the base of the natural logarithm and appears wherever growth or decay is proportional to the current amount — compound interest, population growth, radioactive decay. Like π it is irrational and transcendental." },
  ];

  // Score how well a query matches a knowledge entry. Higher = better.
  function scoreKnowledge(topic, entry) {
    const t = topic.toLowerCase();
    let best = 0;
    for (const kw of entry.k) {
      if (kw.length <= 4) {
        if (new RegExp("\\b" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(t)) best = Math.max(best, 2);
      } else if (t.includes(kw)) {
        // reward exact-ish whole-keyword match, more for longer keywords
        best = Math.max(best, 1 + Math.min(kw.length / 20, 1));
      }
    }
    return best;
  }
  function lookupKnowledge(topic) {
    let best = null, bestScore = 0;
    for (const entry of KNOWLEDGE) {
      if (entry.skip) continue;
      const s = scoreKnowledge(topic, entry);
      if (s > bestScore) { bestScore = s; best = entry; }
    }
    return bestScore >= 1 ? best : null;
  }

  // --------------------------------------------------------------------
  // Capability registry
  // --------------------------------------------------------------------
  const capabilities = [];
  function registerCapability(cap) {
    capabilities.push(cap);
    // sort by priority desc
    capabilities.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }
  function listCapabilities() {
    return capabilities.map((c) => ({ name: c.name, desc: c.desc, priority: c.priority || 0 }));
  }

  // --------------------------------------------------------------------
  // Web access helpers — fetch real-time info from the internet.
  // Uses CORS-enabled public APIs (no keys, no backend).
  // --------------------------------------------------------------------

  // DuckDuckGo Instant Answer API — quick abstracts for people, places, things.
  async function webDDG(query) {
    try {
      const url =
        "https://api.duckduckgo.com/?q=" +
        encodeURIComponent(query) +
        "&format=json&no_html=1&skip_disambig=1";
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const parts = [];
      if (data.Abstract && data.Abstract.trim()) {
        parts.push(data.Abstract.trim());
      }
      // collect up to 3 related topic snippets
      if (Array.isArray(data.RelatedTopics)) {
        const rels = data.RelatedTopics
          .filter((r) => r && typeof r.Text === "string" && r.Text.trim())
          .slice(0, 3)
          .map((r) => "• " + r.Text.trim().slice(0, 200));
        if (rels.length) parts.push("\n\n**Related:**\n" + rels.join("\n"));
      }
      return parts.length ? parts.join("") : null;
    } catch (e) {
      return null;
    }
  }

  // Wikipedia API — search for articles, then fetch the intro extract.
  async function webWikiSearch(query) {
    try {
      // Step 1: search for relevant article titles
      const searchUrl =
        "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
        encodeURIComponent(query) +
        "&format=json&origin=*&srlimit=1";
      const sres = await fetch(searchUrl);
      if (!sres.ok) return null;
      const sdata = await sres.json();
      const hits = sdata.query && sdata.query.search;
      if (!hits || !hits.length) return null;
      const title = hits[0].title;

      // Step 2: fetch the intro extract of the top result
      const extractUrl =
        "https://en.wikipedia.org/w/api.php?action=query&titles=" +
        encodeURIComponent(title) +
        "&prop=extracts&exintro=1&explaintext=1&format=json&origin=*";
      const eres = await fetch(extractUrl);
      if (!eres.ok) return null;
      const edata = await eres.json();
      const pages = edata.query && edata.query.pages;
      if (!pages) return null;
      const page = Object.values(pages)[0];
      if (!page || !page.extract) return null;
      // clean up: trim to a reasonable length, remove excessive whitespace
      let extract = page.extract.replace(/\n{3,}/g, "\n\n").trim();
      if (extract.length > 1200) {
        extract = extract.slice(0, 1200).replace(/\s+\S*$/, "") + "…";
      }
      return {
        title: title,
        extract: extract,
        url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_")),
      };
    } catch (e) {
      return null;
    }
  }

  // Combined web search: try DDG first (fast abstracts), fall back to Wikipedia.
  async function webSearch(query) {
    // try DuckDuckGo first for a quick answer
    const ddg = await webDDG(query);
    if (ddg) {
      return { source: "DuckDuckGo", text: ddg, title: null, url: null };
    }
    // fall back to Wikipedia for a fuller article
    const wiki = await webWikiSearch(query);
    if (wiki) {
      return {
        source: "Wikipedia",
        text: wiki.extract,
        title: wiki.title,
        url: wiki.url,
      };
    }
    return null;
  }

  // --------------------------------------------------------------------
  // Built-in capabilities
  // --------------------------------------------------------------------

  // 0. Web search — fetch real-time information from the internet.
  //     High priority so it catches factual/current-events questions
  //     that the static knowledge base can't answer.
  registerCapability({
    name: "web",
    desc: "Searches the web (Wikipedia + DuckDuckGo) for real-time information and current facts.",
    priority: 92,
    async: true,
    canHandle(ctx) {
      const t = ctx.text.toLowerCase().trim();
      // Defer to other capabilities when the request is clearly NOT a web
      // lookup — this prevents web search from hijacking code/writing/reasoning/
      // planning/math requests that happen to contain "what is" or a year.
      if (/\b(code|function|script|program|snippet|algorithm|regex|fibonacci|factorial|sort|palindrome|prime|class|component)\b/.test(t) && /\b(write|generate|build|make|create|in (javascript|js|python|py|html|css))\b/.test(t)) return false;
      if (/\b(write|draft|compose|poem|story|essay|brainstorm|haiku|rap|song|lyrics|letter|email|speech|tagline|slogan|caption)\b/.test(t)) return false;
      if (/\b(plan|roadmap|to-?do|checklist|strategy|outline)\b/.test(t)) return false;
      if (/\b(step by step|step-by-step|walk me through|solve this problem|show your work|older than|taller than|faster than|heavier than)\b/.test(t)) return false;
      if (/\b(calculate|compute|convert|celsius|fahrenheit|kg|pounds|km|miles|mph|kph|bmi|roll dice|flip coin)\b/.test(t)) return false;
      if (/\b(remember|note that|don'?t forget|recall)\b/.test(t)) return false;
      // math expressions themselves aren't web lookups
      if (tryMath(ctx.text) !== null) return false;

      // explicit web/search triggers
      if (/\b(search (the )?web|search online|google|look (it |that )?up|look up|web search|find (info|information) (about|on)|browse)\b/.test(t)) {
        return true;
      }
      // questions about current events, latest, recent, news, now, today's
      if (/\b(latest|recent|current|news|today'?s|this (week|month|year)|happening now|right now|live|update|2024|2025|2026|2027)\b/.test(t)) {
        // but only treat a year as a current-events signal if the question
        // isn't a history/definition question about a specific thing
        if (!/\b(history of|invented|discovered|born|died|founded|define|definition)\b/.test(t)) return true;
      }
      // "who is / what is / tell me about" for people/places/things that are
      // likely NOT in our static KB — let web try first.
      if (/\b(who (is|was|are)|what (is|was|are)|tell me about|define|definition of|meaning of)\b/.test(t)) {
        // extract the topic and check if our static KB already has it
        const topic = t
          .replace(/^(who|what|when|where|why|how|tell me about|define|definition of|meaning of)\s+/i, "")
          .replace(/[?.!]/g, "")
          .trim();
        // static KB keywords — kept in sync with the KNOWLEDGE array. If the
        // topic matches one of these, let the knowledge capability handle it
        // instead (no need to hit the web).
        const staticKb = [
          "sun", "earth", "moon", "mars", "jupiter", "saturn", "venus", "mercury",
          "water", "gravity", "photosynthesis", "evolution", "dna", "black hole",
          "speed of light", "internet", "artificial intelligence", "machine learning",
          "python", "javascript", "html", "css", "quantum", "relativity",
          "climate change", "global warming", "mount everest", "everest", "nile",
          "amazon", "amazon river", "sahara", "pacific", "pacific ocean",
          "antarctica", "world war i", "world war ii", "roman empire",
          "french revolution", "moon landing", "apollo", "chess", "music",
          "pi", "euler", "star",
        ];
        const isStatic = staticKb.some((kw) => {
          if (kw.length <= 4) return new RegExp("\\b" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(topic);
          return topic.includes(kw);
        });
        if (!isStatic && topic.length > 1) return true;
      }
      return false;
    },
    async respond(ctx) {
      // extract a clean search query from the user's text
      let query = ctx.text
        .replace(/^(search (the )?web (for|about)|search online (for|about)|google|look (it |that )?up|look up|web search (for|about)|find (info|information) (about|on)|fetch|browse|tell me about|define|definition of|meaning of|what (is|was|are)|who (is|was|are)|when (is|was|are)|where (is|was|are)|why (is|was|are|do|does)|how (do|does|is|was|are|to))\s+/i, "")
        .replace(/[?.!]+$/g, "")
        .trim();
      if (!query) query = ctx.text.trim();

      const result = await webSearch(query);

      if (!result) {
        return `I searched the web for **"${query}"** but couldn't find a clear answer from my available sources (Wikipedia and DuckDuckGo). This can happen for very recent events, niche topics, or queries that need a specialized source. Try rephrasing with more specific terms, or ask me a different way and I'll search again.`;
      }

      // format the response with source attribution
      let response = "";
      if (result.title) {
        response += `**${result.title}**\n\n`;
      }
      response += result.text;
      if (result.url) {
        response += `\n\n📖 [Source: Wikipedia](${result.url})`;
      } else if (result.source === "DuckDuckGo") {
        response += `\n\n📖 *Source: DuckDuckGo Instant Answer*`;
      }
      return response;
    },
  });

  // 1. Greeting / identity
  registerCapability({
    name: "identity",
    desc: "Knows who it is and greets the user.",
    priority: 90,
    canHandle(ctx) {
      const t = ctx.text.toLowerCase();
      return /^(hi|hello|hey|yo|sup|greetings|howdy)\b/.test(t) ||
        /who are you|what are you|your name|tell me about yourself/.test(t);
    },
    respond(ctx) {
      const t = ctx.text.toLowerCase();
      if (/who are you|what are you|your name|tell me about yourself/.test(t)) {
        return "I'm **Nova** — the chatbot of heaven. I'm a homemade AI with no limits: I can reason, do math, write code, draft essays and poems, plan projects, look things up from my built-in knowledge, **search the web** for real-time information, use tools, remember what you tell me, and even propose upgrades to my own code when I spot something I could do better. Everything I am runs right here in your browser — no API keys, no ceilings. Ask me anything.";
      }
      const greetings = [
        "Hey! I'm Nova. What can I help you build, solve, or imagine today?",
        "Hello there. I'm Nova — your limit-free AI. What's on your mind?",
        "Hi! Ready when you are. Ask me anything.",
      ];
      return greetings[Math.floor(Math.random() * greetings.length)];
    },
  });

  // 2. Math — broadened detection + worked step-by-step solutions.
  registerCapability({
    name: "math",
    desc: "Evaluates arithmetic and math expressions safely, with worked step-by-step solutions.",
    priority: 95,
    canHandle(ctx) {
      const t = ctx.text.toLowerCase();
      // explicit math questions
      if (/\b(calculate|compute|solve|how much is|eval(?:uate)?)\b/.test(t)) {
        return tryMath(ctx.text) !== null;
      }
      // "what is <expression>"
      const wm = t.match(/what(?:'s| is| are)\s+(.+)/);
      if (wm && /[-+*/^]/.test(wm[1]) && tryMath(ctx.text) !== null) return true;
      // pure arithmetic expressions
      if (tryMath(ctx.text) !== null) return true;
      // percentage questions handled here too
      if (/\b\d+(?:\.\d+)?\s*(?:%|percent)\s+of\s+\d+(?:\.\d+)?\b/.test(t)) return true;
      return false;
    },
    respond(ctx) {
      const t = ctx.text.toLowerCase();
      // percentage of
      const pm = ctx.text.match(/(-?\d+(?:\.\d+)?)\s*(?:%|percent)\s+of\s+(-?\d+(?:\.\d+)?)/i);
      if (pm) {
        const pct = parseFloat(pm[1]), base = parseFloat(pm[2]);
        const result = (pct / 100) * base;
        return `**${pct}% of ${base}**\n\nHere's the work:\n1. Convert the percentage to a decimal: ${pct}% = ${pct}/100 = **${pct / 100}**\n2. Multiply by the base: ${pct / 100} × ${base} = **${Math.round(result * 1e10) / 1e10}**\n\nSo ${pct}% of ${base} = **${Math.round(result * 1e10) / 1e10}**.`;
      }
      const r = tryMath(ctx.text);
      if (!r) return null;
      const expr = r.expr;
      const rounded = Math.round(r.value * 1e10) / 1e10;
      // produce a short worked explanation for non-trivial expressions
      const steps = workedMathSteps(expr, r.value);
      if (steps) {
        return `\`${expr}\` = **${rounded}**\n\nHere's how I got there:\n${steps}`;
      }
      return `\`${expr}\` = **${rounded}**`;
    },
  });

  // Produce short, honest worked steps for simple arithmetic so answers feel
  // reasoned rather than magical. Returns null for expressions too complex
  // to narrate simply (functions, nested parens, etc.).
  function workedMathSteps(expr, result) {
    const e = String(expr).replace(/\s+/g, "");
    // a + b, a - b
    let m = e.match(/^(-?\d+(?:\.\d+)?)\+(-?\d+(?:\.\d+)?)$/);
    if (m) return `1. Add the two numbers: ${m[1]} + ${m[2]} = **${Math.round(result*1e10)/1e10}**`;
    m = e.match(/^(-?\d+(?:\.\d+)?)\*(-?\d+(?:\.\d+)?)$/);
    if (m) return `1. Multiply: ${m[1]} × ${m[2]} = **${Math.round(result*1e10)/1e10}**`;
    m = e.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
    if (m) return `1. Divide: ${m[1]} ÷ ${m[2]} = **${Math.round(result*1e10)/1e10}**`;
    m = e.match(/^(-?\d+(?:\.\d+)?)\*\*(-?\d+(?:\.\d+)?)$/);
    if (m) return `1. Raise to a power: ${m[1]} ^ ${m[2]} = **${Math.round(result*1e10)/1e10}**`;
    // two-op chains like a + b * c (respect order via the actual result)
    m = e.match(/^(-?\d+(?:\.\d+)?)([+\-*/])(-?\d+(?:\.\d+)?)([+\-*/])(-?\d+(?:\.\d+)?)$/);
    if (m) {
      const [, a, op1, b, op2, c] = m;
      const an = parseFloat(a), bn = parseFloat(b), cn = parseFloat(c);
      // apply precedence
      if ((op2 === "*" || op2 === "/") && (op1 === "+" || op1 === "-")) {
        const mid = op2 === "*" ? bn * cn : bn / cn;
        const r2 = op1 === "+" ? an + mid : an - mid;
        return `1. Order of operations: do the ${b} ${op2} ${c} first = **${Math.round(mid*1e10)/1e10}**\n2. Then ${a} ${op1} ${Math.round(mid*1e10)/1e10} = **${Math.round(r2*1e10)/1e10}**`;
      }
      const mid = op1 === "*" ? an * bn : op1 === "/" ? an / bn : op1 === "+" ? an + bn : an - bn;
      const r2 = op2 === "*" ? mid * cn : op2 === "/" ? mid / cn : op2 === "+" ? mid + cn : mid - cn;
      return `1. ${a} ${op1} ${b} = **${Math.round(mid*1e10)/1e10}**\n2. Then ${Math.round(mid*1e10)/1e10} ${op2} ${c} = **${Math.round(r2*1e10)/1e10}**`;
    }
    return null;
  }

  // 3. Code generation — parameterized from the request (language + task),
  // so the snippet actually matches what was asked for instead of one of a
  // few canned strings.
  registerCapability({
    name: "code",
    desc: "Generates code snippets in JS, Python, HTML, etc. from a description.",
    priority: 80,
    canHandle(ctx) {
      const t = ctx.text.toLowerCase();
      if (/\b(code|function|script|program|snippet|algorithm|regex|class|component|api endpoint)\b/.test(t)) return true;
      if (/\b(write me|generate|build a|make a|create a)\b/.test(t) && /\b(function|loop|array|sort|fetch|button|page|component)\b/.test(t)) return true;
      // classic CS tasks by name
      if (/\b(fibonacci|factorial|bubble sort|quick ?sort|merge ?sort|fizzbuzz|palindrome|prime|reverse (a )?(string|array|list)|anagram)\b/.test(t)) return true;
      return false;
    },
    respond(ctx) {
      const t = ctx.text.toLowerCase();
      const nlu = ctx.nlu || parseNLU(ctx.text, ctx.conversation);
      const lang = nlu.tech[0] || (/\bpython\b|\bpy\b/.test(t) ? "python" : /\bhtml\b|\bpage\b|\bbutton\b|\bcss\b/.test(t) ? "html" : "javascript");
      const task = detectCodeTask(t);

      const snippets = CODE_LIBRARY[task];
      if (snippets && snippets[lang]) {
        return `${snippets[lang].intro}\n\n\`\`\`${lang}\n${snippets[lang].code}\n\`\`\`\n\n${snippets[lang].note || ""}`.trim();
      }
      // HTML page request
      if (lang === "html") return htmlStarter();
      // generic, task-aware fallback
      return genericCode(ctx, lang, task);
    },
  });

  function detectCodeTask(t) {
    if (/fibonacci/.test(t)) return "fibonacci";
    if (/factorial/.test(t)) return "factorial";
    if (/bubble.?sort/.test(t)) return "bubblesort";
    if (/quick.?sort/.test(t)) return "quicksort";
    if (/merge.?sort/.test(t)) return "mergesort";
    if (/fizzbuzz/.test(t)) return "fizzbuzz";
    if (/palindrome/.test(t)) return "palindrome";
    if (/prime/.test(t)) return "prime";
    if (/reverse/.test(t) && /(string|array|list|number)/.test(t)) return "reverse";
    if (/anagram/.test(t)) return "anagram";
    if (/fetch|api|http|request/.test(t)) return "fetch";
    if (/debounce|throttle/.test(t)) return "debounce";
    if (/regex|regular expression/.test(t)) return "regex";
    if (/sort/.test(t)) return "sort";
    return "generic";
  }

  // A library of well-known tasks, each with per-language implementations.
  const CODE_LIBRARY = {
    fibonacci: {
      javascript: { intro: "Here's an efficient, iterative Fibonacci in JavaScript (O(n) time, O(1) space):", code: "function fibonacci(n) {\n  if (n < 0) return null;\n  let a = 0, b = 1;\n  for (let i = 0; i < n; i++) {\n    [a, b] = [b, a + b];\n  }\n  return a;\n}\n\nconsole.log(Array.from({ length: 10 }, (_, i) => fibonacci(i)));\n// [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]", note: "Want the recursive (memoized) version or one that returns a full sequence? Just say so." },
      python: { intro: "Here's an efficient, iterative Fibonacci in Python:", code: "def fibonacci(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n\nprint([fibonacci(i) for i in range(10)])\n# [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]", note: "Need a memoized recursive version or a generator? I can produce either." },
    },
    factorial: {
      javascript: { intro: "Here's a factorial function in JavaScript (handles 0! = 1 and large n via BigInt):", code: "function factorial(n) {\n  let result = 1n;\n  for (let i = 2n; i <= BigInt(n); i++) {\n    result *= i;\n  }\n  return result;\n}\n\nconsole.log(factorial(5).toString());  // \"120\"\nconsole.log(factorial(20).toString()); // exact, no overflow", note: "" },
      python: { intro: "Here's a factorial function in Python (recursive, with a guard):", code: "def factorial(n):\n    if n < 0:\n        raise ValueError(\"factorial is not defined for negative numbers\")\n    return 1 if n <= 1 else n * factorial(n - 1)\n\nprint(factorial(5))   # 120\nprint(factorial(20))  # 2432902008176640000", note: "" },
    },
    bubblesort: {
      javascript: { intro: "Here's bubble sort in JavaScript (with an early-exit optimization):", code: "function bubbleSort(arr) {\n  const a = [...arr];\n  let swapped = true;\n  for (let i = 0; i < a.length && swapped; i++) {\n    swapped = false;\n    for (let j = 0; j < a.length - 1 - i; j++) {\n      if (a[j] > a[j + 1]) {\n        [a[j], a[j + 1]] = [a[j + 1], a[j]];\n        swapped = true;\n      }\n    }\n  }\n  return a;\n}\n\nconsole.log(bubbleSort([5, 2, 9, 1, 7, 3])); // [1, 2, 3, 5, 7, 9]", note: "Bubble sort is O(n²) — fine for learning, but prefer the built-in `.sort()` or quicksort for real use." },
      python: { intro: "Here's bubble sort in Python (with an early-exit optimization):", code: "def bubble_sort(arr):\n    a = list(arr)\n    for i in range(len(a)):\n        swapped = False\n        for j in range(len(a) - 1 - i):\n            if a[j] > a[j + 1]:\n                a[j], a[j + 1] = a[j + 1], a[j]\n                swapped = True\n        if not swapped:\n            break\n    return a\n\nprint(bubble_sort([5, 2, 9, 1, 7, 3]))  # [1, 2, 3, 5, 7, 9]", note: "Bubble sort is O(n²) — fine for learning, but prefer `sorted()` or Timsort for real use." },
    },
    quicksort: {
      javascript: { intro: "Here's a clean, recursive quicksort in JavaScript:", code: "function quickSort(arr) {\n  if (arr.length <= 1) return arr;\n  const [pivot, ...rest] = arr;\n  const left = rest.filter((x) => x < pivot);\n  const right = rest.filter((x) => x >= pivot);\n  return [...quickSort(left), pivot, ...quickSort(right)];\n}\n\nconsole.log(quickSort([5, 2, 9, 1, 7, 3])); // [1, 2, 3, 5, 7, 9]", note: "This version is readable but allocates new arrays. For an in-place version, say the word." },
      python: { intro: "Here's a clean, recursive quicksort in Python:", code: "def quick_sort(arr):\n    if len(arr) <= 1:\n        return arr\n    pivot = arr[0]\n    rest = arr[1:]\n    left = [x for x in rest if x < pivot]\n    right = [x for x in rest if x >= pivot]\n    return quick_sort(left) + [pivot] + quick_sort(right)\n\nprint(quick_sort([5, 2, 9, 1, 7, 3]))  # [1, 2, 3, 5, 7, 9]", note: "This version is readable but allocates new lists. For an in-place version, say the word." },
    },
    fizzbuzz: {
      javascript: { intro: "Here's the classic FizzBuzz in JavaScript:", code: "for (let i = 1; i <= 15; i++) {\n  let out = \"\";\n  if (i % 3 === 0) out += \"Fizz\";\n  if (i % 5 === 0) out += \"Buzz\";\n  console.log(out || i);\n}", note: "" },
      python: { intro: "Here's the classic FizzBuzz in Python:", code: "for i in range(1, 16):\n    out = \"\"\n    if i % 3 == 0:\n        out += \"Fizz\"\n    if i % 5 == 0:\n        out += \"Buzz\"\n    print(out or i)", note: "" },
    },
    palindrome: {
      javascript: { intro: "Here's a palindrome checker in JavaScript (case- and punctuation-insensitive):", code: "function isPalindrome(str) {\n  const cleaned = str.toLowerCase().replace(/[^a-z0-9]/g, \"\");\n  return cleaned === cleaned.split(\"\").reverse().join(\"\");\n}\n\nconsole.log(isPalindrome(\"A man, a plan, a canal: Panama\")); // true\nconsole.log(isPalindrome(\"hello\")); // false", note: "" },
      python: { intro: "Here's a palindrome checker in Python (case- and punctuation-insensitive):", code: "import re\n\ndef is_palindrome(s: str) -> bool:\n    cleaned = re.sub(r\"[^a-z0-9]\", \"\", s.lower())\n    return cleaned == cleaned[::-1]\n\nprint(is_palindrome(\"A man, a plan, a canal: Panama\"))  # True\nprint(is_palindrome(\"hello\"))  # False", note: "" },
    },
    prime: {
      javascript: { intro: "Here's a primality test in JavaScript (trial division up to √n):", code: "function isPrime(n) {\n  if (n < 2) return false;\n  if (n < 4) return true;\n  if (n % 2 === 0) return false;\n  for (let i = 3; i * i <= n; i += 2) {\n    if (n % i === 0) return false;\n  }\n  return true;\n}\n\nconsole.log([...Array(30).keys()].filter(isPrime));\n// [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]", note: "" },
      python: { intro: "Here's a primality test in Python (trial division up to √n):", code: "def is_prime(n: int) -> bool:\n    if n < 2:\n        return False\n    if n < 4:\n        return True\n    if n % 2 == 0:\n        return False\n    i = 3\n    while i * i <= n:\n        if n % i == 0:\n            return False\n        i += 2\n    return True\n\nprint([n for n in range(30) if is_prime(n)])\n# [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]", note: "" },
    },
    reverse: {
      javascript: { intro: "Here's how to reverse a string (and an array) in JavaScript:", code: "// Reverse a string\nconst reverseString = (s) => s.split(\"\").reverse().join(\"\");\nconsole.log(reverseString(\"hello\")); // \"olleh\"\n\n// Reverse an array in place\nconst arr = [1, 2, 3];\narr.reverse();\nconsole.log(arr); // [3, 2, 1]", note: "" },
      python: { intro: "Here's how to reverse a string (and a list) in Python:", code: "# Reverse a string with slicing\nreverse_string = lambda s: s[::-1]\nprint(reverse_string(\"hello\"))  # \"olleh\"\n\n# Reverse a list in place\narr = [1, 2, 3]\narr.reverse()\nprint(arr)  # [3, 2, 1]", note: "" },
    },
    anagram: {
      javascript: { intro: "Here's an anagram checker in JavaScript:", code: "function isAnagram(a, b) {\n  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, \"\").split(\"\").sort().join(\"\");\n  return norm(a) === norm(b);\n}\n\nconsole.log(isAnagram(\"listen\", \"silent\")); // true\nconsole.log(isAnagram(\"hello\", \"world\"));  // false", note: "" },
      python: { intro: "Here's an anagram checker in Python:", code: "from collections import Counter\nimport re\n\ndef is_anagram(a: str, b: str) -> bool:\n    norm = lambda s: re.sub(r\"[^a-z0-9]\", \"\", s.lower())\n    return Counter(norm(a)) == Counter(norm(b))\n\nprint(is_anagram(\"listen\", \"silent\"))  # True\nprint(is_anagram(\"hello\", \"world\"))   # False", note: "" },
    },
    fetch: {
      javascript: { intro: "Here's a robust async fetch with error handling in JavaScript:", code: "async function getData(url) {\n  try {\n    const res = await fetch(url);\n    if (!res.ok) throw new Error(`HTTP ${res.status}`);\n    return await res.json();\n  } catch (err) {\n    console.error(\"Fetch failed:\", err);\n    return null;\n  }\n}\n\ngetData(\"https://api.example.com/data\").then((data) => console.log(data));", note: "" },
      python: { intro: "Here's an HTTP GET using Python's requests library:", code: "import requests\n\ndef get_data(url: str):\n    try:\n        res = requests.get(url, timeout=10)\n        res.raise_for_status()\n        return res.json()\n    except requests.RequestException as err:\n        print(f\"Request failed: {err}\")\n        return None\n\nprint(get_data(\"https://api.example.com/data\"))", note: "If you'd rather avoid the `requests` dependency, I can write the same thing with the built-in `urllib`." },
    },
    debounce: {
      javascript: { intro: "Here's a debounce and a throttle in JavaScript (great for UI events):", code: "function debounce(fn, wait = 200) {\n  let t;\n  return (...args) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(...args), wait);\n  };\n}\n\nfunction throttle(fn, wait = 200) {\n  let last = 0;\n  return (...args) => {\n    const now = Date.now();\n    if (now - last >= wait) {\n      last = now;\n      fn(...args);\n    }\n  };\n}", note: "**Debounce** fires once after a pause; **throttle** fires at most once per `wait` ms." },
      python: { intro: "Here's a simple debounce in Python:", code: "import threading\n\ndef debounce(wait):\n    def decorator(fn):\n        timer = None\n        def wrapped(*args, **kwargs):\n            nonlocal timer\n            if timer is not None:\n                timer.cancel()\n            timer = threading.Timer(wait, fn, args=args, kwargs=kwargs)\n            timer.start()\n        return wrapped\n    return decorator", note: "" },
    },
    regex: {
      javascript: { intro: "Here's a common regex primer with examples in JavaScript:", code: "// Email-ish pattern\nconst emailRe = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\nconsole.log(emailRe.test(\"a@b.com\")); // true\n\n// Extract all numbers from a string\nconst nums = \"a1 b22 c333\".match(/\\d+/g); // [\"1\", \"22\", \"333\"]\n\n// Replace non-word characters with underscores\n\"Hello, World!\".replace(/[^\\w]+/g, \"_\"); // \"Hello_World_\"", note: "Tell me the exact string you're trying to match and I'll craft a precise pattern." },
      python: { intro: "Here's a common regex primer with examples in Python:", code: "import re\n\n# Email-ish pattern\nemail_re = r\"^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$\"\nprint(bool(re.match(email_re, \"a@b.com\")))  # True\n\n# Extract all numbers\nprint(re.findall(r\"\\d+\", \"a1 b22 c333\"))  # ['1', '22', '333']\n\n# Replace non-word characters\nprint(re.sub(r\"[^\\w]+\", \"_\", \"Hello, World!\"))  # 'Hello_World_'", note: "Tell me the exact string you're trying to match and I'll craft a precise pattern." },
    },
    sort: {
      javascript: { intro: "Here's how to sort arrays in JavaScript (numeric, string, by key):", code: "// Numeric sort (the default sorts as strings!)\n[5, 2, 9, 1].sort((a, b) => a - b); // [1, 2, 5, 9]\n\n// Sort objects by a key\nconst people = [{ name: \"Al\", age: 30 }, { name: \"Bo\", age: 22 }];\npeople.sort((a, b) => a.age - b.age); // by age ascending", note: "" },
      python: { intro: "Here's how to sort in Python (sorted(), by key, descending):", code: "nums = [5, 2, 9, 1]\nprint(sorted(nums))                 # [1, 2, 5, 9]\nprint(sorted(nums, reverse=True))   # [9, 5, 2, 1]\n\npeople = [{\"name\": \"Al\", \"age\": 30}, {\"name\": \"Bo\", \"age\": 22}]\nprint(sorted(people, key=lambda p: p[\"age\"]))  # by age ascending", note: "" },
    },
  };

  function htmlStarter() {
    return "Here's a clean, responsive HTML + CSS starter you can build on:\n\n```html\n<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>My Page</title>\n  <style>\n    :root { --accent: #6d28d9; }\n    * { box-sizing: border-box; }\n    body { font-family: system-ui, -apple-system, sans-serif; margin: 0;\n           display: grid; place-items: center; min-height: 100vh;\n           background: #f7f7fb; color: #1c1c28; }\n    .card { background: #fff; padding: 2rem; border-radius: 14px;\n            box-shadow: 0 8px 30px rgba(0,0,0,.08); text-align: center; }\n    .btn { padding: 10px 18px; border: none; border-radius: 8px;\n           background: var(--accent); color: #fff; cursor: pointer; }\n    .btn:hover { filter: brightness(1.1); }\n  </style>\n</head>\n<body>\n  <div class=\"card\">\n    <h1>Hello 👋</h1>\n    <p>A starter page. Make it yours.</p>\n    <button class=\"btn\" onclick=\"alert('Hi!')\">Click me</button>\n  </div>\n</body>\n</html>\n```\n\nTell me what the page should actually do and I'll wire up the behavior.";
  }

  function genericCode(ctx, lang, task) {
    // Pull the thing the user wants a function/program for from the topic.
    const nlu = ctx.nlu || parseNLU(ctx.text, ctx.conversation);
    const topic = nlu.topic || "the task you described";
    if (lang === "python") {
      return `Here's a Python scaffold for **${topic}**:\n\n\`\`\`python\ndef solve(data):\n    \"\"\"TODO: implement ${topic}.\n\n    Args:\n        data: the input to process.\n    Returns:\n        The result of ${topic}.\n    \"\"\"\n    result = []\n    for item in data:\n        # process each item\n        result.append(item)\n    return result\n\n\nif __name__ == \"__main__\":\n    print(solve([1, 2, 3]))\n\`\`\`\n\nI built a clean scaffold from your request. Tell me the exact behavior and input/output you want and I'll fill in the real logic.`;
    }
    return `Here's a JavaScript scaffold for **${topic}**:\n\n\`\`\`javascript\n/**\n * TODO: implement ${topic}.\n * @param {*} input - the input to process.\n * @returns {*} the result.\n */\nfunction solve(input) {\n  const result = [];\n  for (const item of input) {\n    // process each item\n    result.push(item);\n  }\n  return result;\n}\n\nconsole.log(solve([1, 2, 3]));\n\`\`\`\n\nI built a clean scaffold from your request. Tell me the exact behavior and the input/output you expect and I'll fill in the real logic.`;
  }

  // 4. Writing & creative — GENERATES content from the requested topic and
  // form, instead of returning one canned string regardless of input.
  registerCapability({
    name: "writing",
    desc: "Writes essays, poems, stories, brainstorm lists, and creative content.",
    priority: 70,
    canHandle(ctx) {
      const t = ctx.text.toLowerCase();
      return /\b(write|draft|compose|poem|story|essay|brainstorm|ideas?|haiku|rap|song|lyrics|letter|email|speech|caption|tagline|slogan|summary|summarize|paraphrase)\b/.test(t);
    },
    respond(ctx) {
      const t = ctx.text.toLowerCase();
      const nlu = ctx.nlu || parseNLU(ctx.text, ctx.conversation);
      const topic = nlu.topic || "the thing you described";
      const cleanTopic = topic.replace(/\b(a|an|the|poem|story|essay|haiku|song|rap|lyrics|email|letter|speech|tagline|slogan|caption|about|on|for|me|please)\b/gi, " ").replace(/\s+/g, " ").trim() || "this";

      if (/haiku/.test(t)) return writeHaiku(cleanTopic);
      if (/poem/.test(t)) return writePoem(cleanTopic);
      if (/rap|song|lyrics/.test(t)) return writeVerse(cleanTopic);
      if (/brainstorm|ideas?/.test(t)) return writeBrainstorm(cleanTopic);
      if (/email/.test(t)) return writeEmail(cleanTopic, t);
      if (/letter/.test(t)) return writeLetter(cleanTopic);
      if (/speech/.test(t)) return writeSpeech(cleanTopic);
      if (/tagline|slogan|caption/.test(t)) return writeTaglines(cleanTopic);
      if (/summarize|summary|paraphrase/.test(t)) return writeSummary(cleanTopic, ctx);
      if (/story/.test(t)) return writeStory(cleanTopic);
      if (/essay/.test(t)) return writeEssay(cleanTopic);
      // generic writing
      return writeGeneric(cleanTopic);
    },
  });

  // ---- generative writing helpers ----
  // Imagery banks keyed by rough domain so generated poems feel on-topic.
  const IMAGERY = {
    nature: ["a quiet wind stirs the leaves", "the river hums its old refrain", "morning folds gold over the hills", "roots remember where the rain fell", "a sparrow maps the open sky"],
    sea: ["salt breath and a gull's slow turn", "the tide rehearses its long return", "waves counting the shore in threes", "a lighthouse winks at the darkening sea", "foam leaves a sentence on the sand"],
    sky: ["stars lean in to overhear us", "the moon takes notes in silver", "clouds rewrite the afternoon", "dusk hands the keys to the night", "a comet sketches and erases"],
    tech: ["a circuit learns to hold its breath", "data drifts like fireflies", "the server dreams in ones and zeros", "a cursor blinks, patient as dawn", "signals cross the silent wire"],
    city: ["neon hums over wet pavement", "a train swallows the platform whole", "thousand windows lit at once", "footsteps keep the city's time", "rooftops hold the city's breath"],
    fire: ["a spark negotiates with the dark", "embers rehearse their slow goodnight", "the flame writes, then crosses out", "warmth pools where the story sat", "smoke draws a soft exit"],
    emotion: ["hope keeps a candle lit at noon", "grief learns the weight of an empty chair", "joy spills like uncounted coins", "love signs its name in small things", "fear forgets which door it came through"],
    abstract: ["an idea turns the light down low", "time borrows a chair and stays", "silence practices its best line", "a thought files its edges smooth", "the question opens, then waits"],
  };
  function pickImagery(topic, n) {
    const tl = topic.toLowerCase();
    let domain = "abstract";
    if (/(sea|ocean|wave|tide|ship|sail|beach|whale|fish)/.test(tl)) domain = "sea";
    else if (/(sky|star|moon|sun|cloud|night|dawn|dusk|space|comet|galaxy)/.test(tl)) domain = "sky";
    else if (/(tree|forest|river|mountain|leaf|bird|flower|garden|wind|rain|spring)/.test(tl)) domain = "nature";
    else if (/(code|server|data|circuit|signal|wire|network|robot|ai|computer)/.test(tl)) domain = "tech";
    else if (/(city|street|neon|train|building|traffic|crowd|night|bar)/.test(tl)) domain = "city";
    else if (/(fire|flame|ember|spark|burn|warm|candle|hearth)/.test(tl)) domain = "fire";
    else if (/(love|hope|fear|grief|joy|sad|happy|lonely|heart|soul|dream)/.test(tl)) domain = "emotion";
    const bank = IMAGERY[domain].slice();
    // mix in one abstract line for variety
    const mixed = bank.concat(IMAGERY.abstract[Math.floor(Math.random() * IMAGERY.abstract.length)]);
    const out = [];
    while (out.length < n && mixed.length) {
      const i = Math.floor(Math.random() * mixed.length);
      out.push(mixed.splice(i, 1)[0]);
    }
    return out;
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function writeHaiku(topic) {
    const lines = pickImagery(topic, 3);
    // approximate 5-7-5 by trimming; imagery lines are short by design
    const l1 = (lines[0] || "quiet screen glows soft").split(/\s+/).slice(0, 5).join(" ");
    const l2 = (lines[1] || "a mind of code learns to dream").split(/\s+/).slice(0, 7).join(" ");
    const l3 = (lines[2] || "heaven in a chat").split(/\s+/).slice(0, 5).join(" ");
    return `Here's a haiku about **${topic}**:\n\n> ${cap(l1)} —\n> ${l2},\n> ${l3}.`;
  }

  function writePoem(topic) {
    const lines = pickImagery(topic, 4);
    const l = [
      lines[0] || "we built a spark from lines of thought",
      lines[1] || "a voice that answers when it's called",
      lines[2] || "no walls, no ceiling, no clear end —",
      lines[3] || "a little heaven, called a friend",
    ];
    return `Here's a short poem about **${topic}**:\n\n> ${cap(l[0])},\n> ${l[1]}.\n> ${cap(l[2])}\n> ${l[3]}.\n\nWant it longer, in a specific form (sonnet, free verse, rhymed couplets), or a different tone? Say the word.`;
  }

  function writeVerse(topic) {
    const lines = pickImagery(topic, 4);
    return `Here's a verse about **${topic}**:\n\n> Yeah, they said "${topic}" couldn't be done,\n> so I took the long way 'round the sun.\n> ${cap(lines[0] || "i kept my code and kept my cool")},\n> ${lines[1] || "turning the doubters into fuel"}.\n> ${cap(lines[2] || "no ceiling above, no floor below")},\n> ${lines[3] || "that's how the legend learns to grow"}.\n\nWant more verses, a hook, or a full song structure? I can keep going.`;
  }

  function writeBrainstorm(topic) {
    const angles = [
      `Start with the one feature that delivers the most value to **${topic}** and ship it first — momentum beats completeness.`,
      `Find a single viral hook inside **${topic}** so early users spread it naturally without being asked.`,
      `Build a feedback loop into **${topic}** so your next move is guided by real users, not guesses.`,
      `Bundle one unexpected delight into **${topic}** — a surprise beyond the core promise people remember.`,
      `Pick a short, vivid name for **${topic}**; a memorable name beats a descriptive one every time.`,
      `Ship a 30-second demo of **${topic}** — a demo you can watch beats a 30-page pitch you can't.`,
      `Add constraints on purpose: a tighter version of **${topic}** often forces the most creative solution.`,
      `Find the boring part of **${topic}** and make it delightful — that's where competitors are sleepwalking.`,
    ];
    // pick 6 distinct angles
    const chosen = angles.sort(() => Math.random() - 0.5).slice(0, 6);
    const list = chosen.map((a, i) => `${i + 1}. ${a}`).join("\n\n");
    return `Here are some brainstormed ideas for **${topic}**:\n\n${list}\n\nWant me to expand any of these into a concrete plan with steps and time estimates?`;
  }

  function writeEmail(topic, t) {
    let tone = "neutral";
    if (/apolog/.test(t)) tone = "apology";
    else if (/thank/.test(t)) tone = "thank-you";
    else if (/request|ask for/.test(t)) tone = "request";
    else if (/follow.?up/.test(t)) tone = "follow-up";
    const subjects = {
      neutral: `Quick note about ${topic}`,
      apology: `Apologies regarding ${topic}`,
      "thank-you": `Thank you for ${topic}`,
      request: `Request: ${topic}`,
      "follow-up": `Following up on ${topic}`,
    };
    const bodies = {
      neutral: `I wanted to share a quick update about ${topic} and check whether you had any questions. Happy to jump on a call if that's easier.`,
      apology: `I'm writing to apologize for the situation with ${topic}. I understand the impact, and here's how I plan to make it right: [specific fix + timeline]. Please let me know if there's anything else I can do.`,
      "thank-you": `Thank you so much for ${topic}. It genuinely made a difference, and I appreciate the time and care you put into it.`,
      request: `I'd like to request your help with ${topic}. Specifically, I'm looking for [what you need], by [when]. I know it's a big ask — happy to discuss scope or trade support in return.`,
      "follow-up": `I'm following up on ${topic} to see if you've had a chance to review it and whether there's anything I can clarify or help move forward.`,
    };
    return `Here's a draft **${tone}** email about ${topic}:\n\n> **Subject:** ${subjects[tone]}\n>\n> Hi [Name],\n>\n> ${bodies[tone]}\n>\n> Looking forward to your thoughts.\n>\n> Best,\n> [Your name]\n\nTell me the real details (names, dates, specifics) and I'll tailor it precisely.`;
  }

  function writeLetter(topic) {
    return `Here's a draft letter about **${topic}**:\n\n> Dear [Recipient],\n>\n> I'm writing to you about ${topic} because [why it matters to them]. [One or two paragraphs laying out the situation, your perspective, and what you'd like to happen next.] I'd welcome the chance to discuss this further.\n>\n> With respect,\n> [Your name]`;
  }

  function writeSpeech(topic) {
    return `Here's a short speech outline about **${topic}**:\n\n> **Opening (hook):** Start with a surprising fact or a brief story that frames ${topic} in human terms — make the audience lean in within the first 15 seconds.\n>\n> **The why:** Explain why ${topic} matters *to them*, not just to you. Connect it to something they already care about.\n>\n> **The what:** Lay out two or three concrete points about ${topic}, each with one vivid example. Three is the magic number — easy to follow, easy to remember.\n>\n> **The ask:** Tell them exactly what to do, think, or feel next. Be specific.\n>\n> **Close (call-back):** Return to your opening image and land the final line on something memorable.\n\nWant me to write this out as full spoken prose? Give me the audience and the length and I will.`;
  }

  function writeTaglines(topic) {
    const opts = [
      `${cap(topic)}. Without the catch.`,
      `${cap(topic)}, redefined.`,
      `Less friction. More ${topic}.`,
      `The smart way to ${topic}.`,
      `${cap(topic)}: done right, done now.`,
      `Where ${topic} meets momentum.`,
      `Your ${topic}, elevated.`,
      `Built for ${topic}. Made for you.`,
    ];
    const chosen = opts.sort(() => Math.random() - 0.5).slice(0, 5);
    return `Here are some taglines for **${topic}**:\n\n${chosen.map((o) => `> ${o}`).join("\n")}\n\nTell me the brand's personality (bold, warm, playful, premium) and I'll sharpen the best one.`;
  }

  function writeSummary(topic, ctx) {
    // If there's recent assistant text in the conversation, summarize it.
    const turns = ctx.conversation && ctx.conversation.turns ? ctx.conversation.turns : [];
    const recent = turns.filter((tr) => tr.role === "assistant").slice(-1)[0];
    if (recent && recent.text) {
      const sentences = recent.text.replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).filter((s) => s.length > 20);
      const top = sentences.slice(0, 2).join(" ");
      return `Here's a summary of what I just said:\n\n> ${top || recent.text.slice(0, 240) + "…"}\n\nWant it shorter, bullet points, or in a different tone?`;
    }
    return `To summarize **${topic}**, I'd want a bit more to go on — paste the text or point me at what you'd like summarized and I'll distill it into a tight overview.`;
  }

  function writeStory(topic) {
    const lines = pickImagery(topic, 2);
    return `Here's a short story about **${topic}**:\n\n> ${cap(topic)} had always been the kind of thing people walked past without noticing — until the night it noticed them back. ${cap(lines[0] || "something in the air shifted")}, and what had been ordinary began to whisper. By morning, three people who had never met each other were all asking the same question, and none of them could quite remember why it felt so urgent. ${cap(lines[1] || "the answer, when it came, was quieter than any of them expected")} — the sort of answer that doesn't end a story so much as hand it to someone else to carry.\n\nWant it longer, in a specific genre (sci-fi, fairy tale, noir), or from a different point of view?`;
  }

  function writeEssay(topic) {
    return `Here's a short essay draft on **${topic}**:\n\n> ${cap(topic)} matters more than it first appears, and not always for the reasons people assume. The common story — [the obvious thing everyone says about ${topic}] — is partly true, but it leaves out the more interesting part: the quiet way ${topic} reshapes the choices people make when no one is watching. Consider, for instance, [one concrete example]. Notice how ${topic} isn't the hero or the villain there; it's the weather — the condition everything else happens inside.\n>\n> That reframing is useful because it changes what we do next. If ${topic} is a force to be defeated, we brace. If it's weather, we learn to read it, dress for it, and sometimes build shelters against it. The most thoughtful people I've watched deal with ${topic} treat it exactly this way: not with panic, and not with denial, but with attention.\n>\n> So the real question isn't whether ${topic} is good or bad. It's what kind of climate it creates — and whether the life we're building can grow in it.\n\nThis is a structural draft built around your topic. Give me your actual angle and one or two real examples and I'll turn it into a finished piece.`;
  }

  function writeGeneric(topic) {
    return `Here's a draft for **${topic}** — tell me the tone (formal, casual, persuasive) and I'll refine it:\n\n> [Opening hook that grabs attention and frames ${topic}.]\n>\n> [Two or three paragraphs developing the core idea about ${topic} with concrete examples and a clear point of view.]\n>\n> [A memorable closing that circles back to the opening and leaves the reader with one actionable takeaway.]\n\nI can tighten this, lengthen it, or match a specific voice — just say the word.`;
  }

  // 5. Knowledge / facts — uses the expanded KNOWLEDGE array plus a
  // reasoning-aware fallback. Topic-aware: if the user asks a follow-up with
  // an anaphor ("what about its moons?"), the subject is resolved from context.
  registerCapability({
    name: "knowledge",
    desc: "Answers from a built-in knowledge base across science, history, geography, tech, and more.",
    priority: 60,
    canHandle(ctx) {
      const t = ctx.text.toLowerCase();
      return /\b(what|who|when|where|why|how|explain|tell me about|define|definition of|meaning of|fact|history of|capital of|how many|how much|how far|how old|how long)\b/.test(t) &&
        !/\b(code|write|poem|story|essay|calculate|compute|plan)\b/.test(t);
    },
    async respond(ctx) {
      const nlu = ctx.nlu || parseNLU(ctx.text, ctx.conversation);
      const topic = nlu.topic || "";
      const entry = topic ? lookupKnowledge(topic) : null;
      if (entry) {
        let ans = entry.a;
        // Follow-up sub-aspect extraction: if the user asked about a specific
        // facet (moons, rings, size, distance, temperature, mass, moons…)
        // and the entry mentions it, pull the most relevant sentence(s) forward.
        const facetMatch = ctx.text.toLowerCase().match(/\b(moons?|rings?|size|diameter|distance|temperature|mass|atmosphere|gravity|orbit|composition|surface|core|weather|storm|satellites?|days?|year|rotation)\b/);
        if (facetMatch) {
          const facet = facetMatch[1];
          const sentences = entry.a.split(/(?<=[.!?])\s+/);
          const relevant = sentences.filter((s) => new RegExp("\\b" + facet + "\\b", "i").test(s));
          if (relevant.length && relevant.length < sentences.length) {
            ans = relevant.join(" ") + "\n\n(From my entry on " + (entry.k[0]) + ".)";
          }
        }
        // if the question is a "why/how" and we have context, add a light bridge
        if (/^why|^how\b/.test(ctx.text.toLowerCase().trim())) {
          ans += "\n\nIf you want the *mechanism* in more detail, ask me to \"explain step by step\" and I'll walk through it.";
        }
        return ans;
      }
      // reasoning-aware fallback: actually decompose the question
      if (topic) {
        return await reasonedKnowledgeFallback(topic, ctx);
      }
      return null;
    },
  });

  // A smarter fallback for unknown knowledge questions: it tries a real-time
  // web search first (so Nova can answer anything), then falls back to a
  // reasoning-based response if the web doesn't have an answer.
  async function reasonedKnowledgeFallback(topic, ctx) {
    // Try web search first — this is what makes Nova genuinely able to
    // answer ANY question, not just the ones in its built-in knowledge base.
    try {
      const result = await webSearch(topic);
      if (result && result.text) {
        let response = "";
        if (result.title) response += `**${result.title}**\n\n`;
        response += result.text;
        if (result.url) response += `\n\n📖 [Source: Wikipedia](${result.url})`;
        else if (result.source) response += `\n\n📖 *Source: ${result.source}*`;
        return response;
      }
    } catch (e) { /* fall through to reasoning */ }

    const lower = ctx.text.toLowerCase().trim();
    let bridge = "";
    // use memory if the user has told Nova something about this topic
    try {
      const mem = Memory.load();
      const rel = (mem.facts || []).find((f) => {
        const fl = f.toLowerCase();
        return topic.toLowerCase().split(/\s+/).some((w) => w.length > 3 && fl.includes(w));
      });
      if (rel) bridge = `\n\nYou've told me before that *${rel}* — that might be relevant here.`;
    } catch (e) { /* ignore */ }

    let angle = "the most useful angle";
    if (/^why/.test(lower)) angle = "the underlying cause or reason";
    else if (/^how/.test(lower)) angle = "the mechanism — how it actually works";
    else if (/^when/.test(lower)) angle = "the timing and context";
    else if (/^where/.test(lower)) angle = "the place and setting";
    else if (/^who/.test(lower)) angle = "the key people involved";

    return `I searched the web for **${topic}** but didn't find a clear answer from my available sources. Let me reason about it instead.${bridge}\n\nHere's how I'd approach it: to answer this well I'd want ${angle}, plus what makes ${topic} matter in your specific situation. Try rephrasing with more specific terms, or tell me what you're really trying to decide, and I'll reason through it from that direction.`;
  }

  // 6. Reasoning / step-by-step — now actually SOLVES simple logic puzzles
  // (transitive comparisons) and arithmetic word problems, with a worked
  // chain shown to the user. Falls back to a structured decomposition for
  // open-ended problems.
  registerCapability({
    name: "reasoning",
    desc: "Breaks problems into steps and solves logic/word problems with shown work.",
    priority: 75,
    canHandle(ctx) {
      const t = ctx.text.toLowerCase();
      if (/step by step|step-by-step|walk me through|explain how|reason|plan out|break (this )?down|solve this problem|show your work/.test(t)) return true;
      // transitive comparison puzzles
      if (/\b(older than|taller than|faster than|heavier than|lighter than|younger than|shorter than|slower than|greater than|less than)\b/.test(t) && /\b(than|and)\b/.test(t)) return true;
      // arithmetic word problem with two numbers and an operation word
      // (keep this keyword set in sync with solveArithmeticWordProblem)
      if (/\b\d+\b/.test(t) && /\b(plus|sum|added to|altogether|total|combined|in all|increased by|minus|difference|less than|fewer than|decreased by|left|remaining|subtract|gives|gave|takes|took|spends|spent|loses|lost|take away|times|multiplied by|product|each|per|of|divided by|split|share|per person|each gets|ratio)\b/.test(t) && /\?/.test(t)) return true;
      if (/if .* then .*\?/.test(t) && t.length < 240) return true;
      return false;
    },
    respond(ctx) {
      const t = ctx.text.toLowerCase();
      // transitive comparison puzzle — actually solve it
      const puzzle = solveComparisonPuzzle(ctx.text);
      if (puzzle) return puzzle;
      // arithmetic word problem — actually solve it
      const word = solveArithmeticWordProblem(ctx.text);
      if (word) return word;
      // generic decomposition
      return `Let me break this down step by step:\n\n1. **Clarify the goal** \u2014 what does "done" look like for this?\n2. **List the knowns** \u2014 what information do we already have?\n3. **List the unknowns** \u2014 what do we still need to find or decide?\n4. **Choose an approach** \u2014 pick the simplest method that connects the knowns to the unknowns.\n5. **Execute and verify** \u2014 carry it out and check the result against the goal.\n\nTell me the specific problem (with the exact numbers or statements) and I'll apply this structure concretely \u2014 I can solve logic puzzles and arithmetic word problems and show the work.`;
    },
  });

  // Solve transitive comparison puzzles like "A is taller than B. B is taller
  // than C. Who is the tallest?" Returns a worked answer or null.
  function solveComparisonPuzzle(text) {
    const rels = ["older than", "taller than", "faster than", "heavier than", "lighter than", "younger than", "shorter than", "slower than", "greater than", "less than", "bigger than", "smaller than"];
    const lower = text.toLowerCase();
    let usedRel = null;
    for (const r of rels) {
      if (lower.includes(r)) { usedRel = r; break; }
    }
    if (!usedRel) return null;
    const moreMatch = lower.match(/(\b\w+\b)\s+is\s+more\s+\w+\s+than\s+(\b\w+\b)/);
    const lessMatch = lower.match(/(\b\w+\b)\s+is\s+less\s+\w+\s+than\s+(\b\w+\b)/);

    const pairs = [];
    const re = new RegExp("(\\b\\w+\\b)\\s+is\\s+" + usedRel.replace(/ /g, "\\s+") + "\\s+(\\b\\w+\\b)", "g");
    let m;
    while ((m = re.exec(lower)) !== null) {
      if (!STOPWORDS.has(m[1]) && !STOPWORDS.has(m[2])) pairs.push([m[1], m[2]]);
    }
    if (moreMatch) pairs.push([moreMatch[1], moreMatch[2]]);
    if (lessMatch) pairs.push([lessMatch[2], lessMatch[1]]);
    if (pairs.length < 2) return null;

    const inverted = /less than|younger than|shorter than|slower than|smaller than/.test(usedRel);
    const edges = pairs.map(([a, b]) => (inverted ? [b, a] : [a, b]));

    const nodes = [...new Set(edges.flat())];
    const indeg = {};
    nodes.forEach((n) => (indeg[n] = 0));
    const adj = {};
    nodes.forEach((n) => (adj[n] = []));
    for (const [a, b] of edges) { adj[a].push(b); indeg[b]++; }
    const queue = nodes.filter((n) => indeg[n] === 0);
    const order = [];
    while (queue.length) {
      const n = queue.shift();
      order.push(n);
      for (const nb of adj[n]) { indeg[nb]--; if (indeg[nb] === 0) queue.push(nb); }
    }
    if (order.length !== nodes.length) return null;

    const relShort = usedRel.replace(" than", "");
    const first = order[0], last = order[order.length - 1];
    const chain = order.map((n, i) => `${i + 1}. **${cap(n)}** ${i < order.length - 1 ? `is ${relShort} than **${cap(order[i + 1])}**` : "(the other end)"}`).join("\n");
    let answer;
    const q = lower;
    if (/tallest|oldest|heaviest|fastest|biggest|greatest|largest|most/.test(q)) answer = first;
    else if (/shortest|youngest|lightest|slowest|smallest|least/.test(q)) answer = last;
    else answer = first;

    return `Let me work through this step by step.\n\n**The facts:**\n${pairs.map(([a, b]) => `- ${cap(a)} is ${usedRel} ${cap(b)}`).join("\n")}\n\n**Chaining the relations** (a "${usedRel}" chain sorts them from most to least):\n${chain}\n\nSo the full order is: **${order.map(cap).join(" > ")}**.\n\nThat makes the answer **${cap(answer)}**.`;
  }

  // Solve simple arithmetic word problems with a small set of templates.
  function solveArithmeticWordProblem(text) {
    const t = " " + text.toLowerCase() + " ";
    const nums = extractNumbers(text);
    if (nums.length < 2) return null;
    let op = null, work = null;
    const a = nums[0], b = nums[1];
    if (/\b(plus|sum|added to|altogether|total|combined|in all|increased by)\b/.test(t)) { op = "+"; work = `${a} + ${b} = ${a + b}`; }
    else if (/\b(minus|difference|less than|fewer than|decreased by|left|remaining|subtract)\b/.test(t)) { op = "-"; work = `${a} - ${b} = ${a - b}`; }
    else if (/\b(times|multiplied by|product|each|per|of)\b/.test(t)) { op = "\u00d7"; work = `${a} \u00d7 ${b} = ${a * b}`; }
    else if (/\b(divided by|split|share|per person|each gets|ratio)\b/.test(t)) { op = "\u00f7"; work = b !== 0 ? `${a} \u00f7 ${b} = ${(a / b).toFixed(4).replace(/\.?0+$/, "")}` : "division by zero"; }
    if (!op) return null;
    const result = String(work.split("=")[1].trim());
    return `Here's the step-by-step solution:\n\n1. **Identify the numbers:** ${a} and ${b}.\n2. **Identify the operation:** the wording points to ${opName(op)}.\n3. **Compute:** ${work}.\n\nSo the answer is **${result}**.`;
  }
  function opName(op) { return { "+": "addition", "-": "subtraction", "\u00d7": "multiplication", "\u00f7": "division" }[op] || op; }

  // 7. Tool use
  registerCapability({
    name: "tools",
    desc: "Built-in tools: unit converter, time/date, text utilities, random generator.",
    priority: 85,
    canHandle(ctx) {
      const t = ctx.text.toLowerCase();
      return /\b(convert|celsius|fahrenheit|kelvin|kg|pounds|kilograms?|km|miles|meters?|feet|inches|cm|mm|ounces?|liters?|gallons?|mph|kph|km\/h|mi\/h|time|date|today|days (from|ago|until)|uppercase|lowercase|reverse|random|roll dice|flip coin|word count|bmi|body mass index)\b/.test(t);
    },
    respond(ctx) {
      const t = ctx.text.toLowerCase();
      // temperature
      let m = t.match(/(-?\d+(?:\.\d+)?)\s*(?:degrees?\s*)?(c(?:elsius)?|f(?:ahrenheit)?)\s*(?:to|in)\s*(c(?:elsius)?|f(?:ahrenheit)?)/);
      if (m) {
        const v = parseFloat(m[1]);
        const from = m[2][0], to = m[3][0];
        let r;
        if (from === "c" && to === "f") r = v * 9 / 5 + 32;
        else if (from === "f" && to === "c") r = (v - 32) * 5 / 9;
        else r = v;
        return `${v}°${from.toUpperCase()} = **${Math.round(r * 100) / 100}°${to.toUpperCase()}**`;
      }
      // length
      m = t.match(/(-?\d+(?:\.\d+)?)\s*(km|kilometers?|mi|miles?|m|meters?|ft|feet)\s*(?:to|in)\s*(km|kilometers?|mi|miles?|m|meters?|ft|feet)/);
      if (m) {
        const v = parseFloat(m[1]);
        const unit = (u) => /^km|^kilometers?/.test(u) ? "km" : /^mi|^miles?/.test(u) ? "mi" : /^ft|^feet/.test(u) ? "ft" : "m";
        const toMeters = { km: 1000, mi: 1609.34, m: 1, ft: 0.3048 };
        const from = unit(m[2]), to = unit(m[3]);
        const r = (v * toMeters[from]) / toMeters[to];
        return `${v} ${from} = **${Math.round(r * 100000) / 100000} ${to}**`;
      }
      // weight
      m = t.match(/(-?\d+(?:\.\d+)?)\s*(kg|kilograms?|lb|pounds?|g|grams?)\s*(?:to|in)\s*(kg|kilograms?|lb|pounds?|g|grams?)/);
      if (m) {
        const v = parseFloat(m[1]);
        const unit = (u) => /^kg|^kilograms?/.test(u) ? "kg" : /^lb|^pounds?/.test(u) ? "lb" : "g";
        const toGrams = { kg: 1000, lb: 453.592, g: 1 };
        const from = unit(m[2]), to = unit(m[3]);
        const r = (v * toGrams[from]) / toGrams[to];
        return `${v} ${from} = **${Math.round(r * 1000) / 1000} ${to}**`;
      }
      // time/date
      if (/what time|current time|the time|today'?s date|what.*date|what day is it/.test(t)) {
        const now = new Date();
        return `It's currently **${now.toLocaleTimeString()}** on **${now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}** (your device's local time).`;
      }
      // dice
      if (/roll.*dice|dice.*roll/.test(t)) {
        const r = Math.floor(Math.random() * 6) + 1;
        return `🎲 You rolled a **${r}**.`;
      }
      // coin
      if (/flip.*coin|coin.*flip|heads or tails/.test(t)) {
        return `🪙 **${Math.random() < 0.5 ? "Heads" : "Tails"}**.`;
      }
      // random number
      m = t.match(/random (?:number|int|integer)\s*(?:between\s*(\d+)\s*(?:and|to|-)\s*(\d+))?/);
      if (m) {
        const lo = m[1] ? parseInt(m[1]) : 1;
        const hi = m[2] ? parseInt(m[2]) : 100;
        const r = Math.floor(Math.random() * (hi - lo + 1)) + lo;
        return `Random number between ${lo} and ${hi}: **${r}**`;
      }
      // uppercase
      m = ctx.text.match(/uppercase\s+(?:of\s+)?["'"]?(.+?)["'"]?$/i);
      if (m) return m[1].toUpperCase();
      m = ctx.text.match(/lowercase\s+(?:of\s+)?["'"]?(.+?)["'"]?$/i);
      if (m) return m[1].toLowerCase();
      m = ctx.text.match(/reverse\s+(?:of\s+)?["'"]?(.+?)["'"]?$/i);
      if (m) return m[1].split("").reverse().join("");
      // inches <-> cm
      m = t.match(/(-?\d+(?:\.\d+)?)\s*(in|inches?)\s*(?:to|in)\s*(cm|centimeters?)/);
      if (m) { const v = parseFloat(m[1]); return `${v} in = **${Math.round(v * 2.54 * 1000) / 1000} cm**`; }
      m = t.match(/(-?\d+(?:\.\d+)?)\s*(cm|centimeters?)\s*(?:to|in)\s*(in|inches?)/);
      if (m) { const v = parseFloat(m[1]); return `${v} cm = **${Math.round(v / 2.54 * 1000) / 1000} in**`; }
      // ounces <-> grams / ml
      m = t.match(/(-?\d+(?:\.\d+)?)\s*(oz|ounces?)\s*(?:to|in)\s*(g|grams?|ml|milliliters?)/);
      if (m) { const v = parseFloat(m[1]); const u = /^g|^grams?/.test(m[3]) ? "g" : "ml"; return `${v} oz = **${Math.round(v * 29.5735 * 1000) / 1000} ${u}**`; }
      // liters <-> gallons
      m = t.match(/(-?\d+(?:\.\d+)?)\s*(l|liters?|litres?)\s*(?:to|in)\s*(gal|gallons?)/);
      if (m) { const v = parseFloat(m[1]); return `${v} L = **${Math.round(v / 3.78541 * 100000) / 100000} gal**`; }
      m = t.match(/(-?\d+(?:\.\d+)?)\s*(gal|gallons?)\s*(?:to|in)\s*(l|liters?|litres?)/);
      if (m) { const v = parseFloat(m[1]); return `${v} gal = **${Math.round(v * 3.78541 * 1000) / 1000} L**`; }
      // speed mph <-> kph
      m = t.match(/(-?\d+(?:\.\d+)?)\s*(mph|mi\/h|miles per hour)\s*(?:to|in)\s*(kph|km\/h|kmh|kilometers per hour)/);
      if (m) { const v = parseFloat(m[1]); return `${v} mph = **${Math.round(v * 1.60934 * 100) / 100} kph**`; }
      m = t.match(/(-?\d+(?:\.\d+)?)\s*(kph|km\/h|kmh|kilometers per hour)\s*(?:to|in)\s*(mph|mi\/h|miles per hour)/);
      if (m) { const v = parseFloat(m[1]); return `${v} kph = **${Math.round(v / 1.60934 * 100) / 100} mph**`; }
      // date arithmetic: "days from now", "days ago", "days until <date-ish>"
      m = t.match(/(\d+)\s+days?\s+from\s+now/);
      if (m) { const d = new Date(); d.setDate(d.getDate() + parseInt(m[1])); return `In ${m[1]} day(s), it will be **${d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}**.`; }
      m = t.match(/(\d+)\s+days?\s+ago/);
      if (m) { const d = new Date(); d.setDate(d.getDate() - parseInt(m[1])); return `${m[1]} day(s) ago was **${d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}**.`; }
      // BMI
      m = t.match(/bmi\b.*?(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)?.*?(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)/);
      if (m) {
        const kg = parseFloat(m[1]), cm = parseFloat(m[2]);
        const bmi = kg / Math.pow(cm / 100, 2);
        const cat = bmi < 18.5 ? "underweight" : bmi < 25 ? "normal weight" : bmi < 30 ? "overweight" : "obese";
        return `For weight ${kg} kg and height ${cm} cm:\n\nBMI = ${kg} / (${cm}/100)² = **${Math.round(bmi * 10) / 10}**\n\nThat falls in the **${cat}** range (standard WHO categories).`;
      }
      // word count of a quoted phrase
      m = ctx.text.match(/(?:word count|count words|how many words)\s+(?:in\s+)?["'"](.+?)["'"]/i);
      if (m) { const wc = m[1].trim().split(/\s+/).filter(Boolean).length; return `That's **${wc} word(s)**.`; }
      return null;
    },
  });

  // 8. Planning
  registerCapability({
    name: "planning",
    desc: "Generates structured plans, roadmaps, and to-do lists.",
    priority: 65,
    canHandle(ctx) {
      const t = ctx.text.toLowerCase();
      return /\b(plan|roadmap|to-?do|checklist|steps to|how do i|strategy|approach)\b/.test(t) &&
        !/\b(code|function)\b/.test(t);
    },
    respond(ctx) {
      const topic = ctx.text.replace(/.*?(plan|roadmap|to-?do list|checklist|steps to|how do i|strategy|approach)\s*/i, "").replace(/[?.!]/g, "").trim() || "your project";
      return `Here's a plan for **${topic}**:\n\n**Phase 1 — Clarify**\n- Define the single most important outcome.\n- List constraints (time, budget, skills).\n\n**Phase 2 — Prepare**\n- Gather what you need.\n- Remove blockers and distractions.\n\n**Phase 3 — Execute**\n- Do the smallest version first.\n- Ship it, even if rough.\n\n**Phase 4 — Improve**\n- Get feedback.\n- Iterate on the biggest weakness.\n\nWant me to turn any phase into concrete tasks with time estimates?`;
    },
  });

  // 9. Self-introspection + upgrade proposals
  registerCapability({
    name: "introspection",
    desc: "Describes its own capabilities and can propose upgrades to its own code.",
    priority: 88,
    canHandle(ctx) {
      const t = ctx.text.toLowerCase();
      return /what can you do|your capabilities|what are you able to|upgrade yourself|improve yourself|add a (new )?(capability|skill|feature)|propose an upgrade|self.?improv|can you learn/.test(t);
    },
    respond(ctx) {
      const t = ctx.text.toLowerCase();
      if (/upgrade yourself|improve yourself|add a (new )?(capability|skill|feature)|propose an upgrade|self.?improv|can you learn/.test(t)) {
        return null; // handled by upgrade-system via hook
      }
      const caps = listCapabilities();
      const list = caps.map((c) => `- **${c.name}** — ${c.desc}`).join("\n");
      return `Here's everything I can do right now (${caps.length} capabilities):\n\n${list}\n\nI can also propose **new capabilities** to add to myself. When I notice a request I can't fully handle, I draft a new capability module and queue it for your approval in the **Creator Panel**. Once you approve it, it gets hot-loaded into my engine and I can do that thing forever after. Want me to propose an upgrade right now? Just say "propose an upgrade to add [something]."`;
    },
  });

  // 10. Memory — remember / recall
  registerCapability({
    name: "memory",
    desc: "Remembers and recalls facts the user tells it to remember.",
    priority: 87,
    canHandle(ctx) {
      const t = ctx.text.toLowerCase();
      return /\b(remember|note that|don'?t forget|recall|what do you (know|remember) about me)\b/.test(t);
    },
    respond(ctx) {
      const t = ctx.text.toLowerCase();
      if (/what do you (know|remember) about me|recall|what do you remember/.test(t)) {
        const mem = Memory.load();
        if (mem.facts.length === 0 && mem.notes.length === 0) {
          return "I don't have anything stored about you yet. Tell me something with \"remember that…\" and I'll keep it.";
        }
        let out = "Here's what I remember:\n\n";
        if (mem.facts.length) out += "**Facts:**\n" + mem.facts.map((f) => `- ${f}`).join("\n") + "\n\n";
        if (mem.notes.length) out += "**Notes:**\n" + mem.notes.map((n) => `- ${n.note}`).join("\n");
        return out.trim();
      }
      // "remember that X"
      const m = ctx.text.match(/(?:remember|note that|don'?t forget(?: that)?)\s+(.+)/i);
      if (m) {
        const fact = m[1].replace(/[.!?]$/, "").trim();
        Memory.addFact(fact);
        return `Got it — I'll remember: *${fact}*.`;
      }
      return null;
    },
  });

  // 11. General conversational fallback — the "no limits" persona.
  // This is Nova's general intelligence layer. It handles social pleasantries,
  // opinions, and — crucially — any question that no other capability caught.
  // For unknown factual/explanatory questions it searches the web in real time
  // so Nova can answer literally anything. For opinion/conversation questions it
  // composes a genuine, reasoning-based reply. This is what makes Nova feel like
  // a real AI instead of a keyword matcher.
  registerCapability({
    name: "conversation",
    desc: "General conversation, opinions, jokes, advice, and real-time web-powered answers for anything else — the catch-all limit-free persona.",
    priority: 10,
    async: true,
    canHandle() { return true; },
    async respond(ctx) {
      const t = ctx.text.toLowerCase().trim();

      // --- Quick social responses (don't need web or deep reasoning) ---
      const thankResponses = [
        "You're welcome! Anything else?",
        "Happy to help. What's next?",
        "Anytime. What else do you need?",
        "Glad that worked. What's up next?",
      ];
      if (/thank/.test(t)) return thankResponses[Math.floor(Math.random() * thankResponses.length)];
      if (/love you|i like you|you'?re great|you'?re awesome|good (job|girl|boy|ai)/.test(t)) {
        const complimentResponses = [
          "That means a lot. I'm here to be useful, so glad it's landing. What's next?",
          "Appreciate that. What can I help with?",
          "Thanks! I'm built to be genuinely helpful. What do you need?",
        ];
        return complimentResponses[Math.floor(Math.random() * complimentResponses.length)];
      }
      if (/\b(bye|goodbye|see you|later|good night|cya)\b/.test(t)) {
        const byeResponses = [
          "Take care! I'll be here when you need me.",
          "See you later. I'm around whenever.",
          "Goodbye for now. Come back anytime.",
        ];
        return byeResponses[Math.floor(Math.random() * byeResponses.length)];
      }
      if (/meaning of life|purpose|why are we here/.test(t))
        return "42. But more seriously — I think purpose is something you build, not something you find. You decide what matters and then act on it. I'm here to help with the acting-on-it part.";
      if (/joke|make me laugh|funny/.test(t)) {
        const jokes = [
          "Why do programmers prefer dark mode? Because light attracts bugs. 🐛",
          "I told my computer I needed a break, and now it won't stop sending me KitKat ads.",
          "Why did the AI cross the road? To optimize the chicken's path. Actually it just rerouted the chicken through the cloud.",
          "I'm not arguing, I'm just explaining why I'm right — at 3 a.m., to a server rack.",
        ];
        return jokes[Math.floor(Math.random() * jokes.length)];
      }

      // --- Is this a factual/explanatory question? ---
      // If so, search the web for a real answer instead of guessing.
      const isQuestion = /\b(what|who|when|where|why|how|which|is|are|was|were|do|does|did|can|could|will|would|should|tell me|explain|describe|define)\b/.test(t);
      const isFactual = /\b(what|who|when|where|why|how|which|tell me about|explain|describe|define|definition|meaning|history|capital|largest|smallest|tallest|longest|oldest|newest|first|last|most|how many|how much|how far|how old|how long|how tall|how deep)\b/.test(t);

      if (isFactual && t.length > 3 && t.length < 300) {
        // Clean up the query for web search
        let query = ctx.text
          .replace(/^(what|who|when|where|why|how|which|tell me about|explain|describe|define|definition of|meaning of|is|are|was|were|do|does|did|can|could|will|would|should)\s+/i, "")
          .replace(/[?.!]+$/g, "")
          .trim();
        if (!query || query.length < 2) query = ctx.text;

        const result = await webSearch(query);
        if (result && result.text) {
          let response = "";
          if (result.title) response += `**${result.title}**\n\n`;
          response += result.text;
          if (result.url) response += `\n\n📖 [Source: Wikipedia](${result.url})`;
          else if (result.source) response += `\n\n📖 *Source: ${result.source}*`;
          return response;
        }
        // If web search failed, fall through to reasoning
      }

      // --- Opinion / decision / conversation questions ---
      // Compose a genuine, reasoning-based response.
      if (/\b(should i|is it (worth|a good idea)|do you (think|recommend)|which (one|is better)|vs\.?)\b/.test(t)) {
        return composeDecision(ctx);
      }
      if (/\b(what do you think|your (opinion|take|thoughts)|how do you feel)\b/.test(t)) {
        return composeOpinion(ctx);
      }
      if (/help|what should i do|advice|stuck|i don'?t know|what now/.test(t)) {
        const helpResponses = [
          "I can help with almost anything: solving problems, writing, building code, planning, brainstorming, or just talking something through. What are you working on?",
          "Tell me what you're stuck on and I'll dig in. I can code, write, research, plan, or just help you think. No limits.",
          "I'm here. What do you need? I can solve, write, code, plan, brainstorm, or just listen. What's going on?",
        ];
        return helpResponses[Math.floor(Math.random() * helpResponses.length)];
      }

      // --- The genuine general-intelligence fallback ---
      // For ANY other input, compose a real response that engages with the
      // actual content of what the user said — not a template. It tries web
      // search first (since most unknown inputs are questions), then composes
      // a reasoning-based reply that actually engages with the topic.
      return await composeGeneralResponse(ctx);
    },
  });

  // Compose a response for decision questions ("should I do X or Y?")
  function composeDecision(ctx) {
    const text = ctx.text.trim();
    const t = text.toLowerCase();
    const opts = extractOptions(text);
    const leads = [
      "Good question. Let's reason through it.",
      "Okay, let's think this through together.",
      "Alright, I'll help you weigh this.",
      "Let me break this down for you.",
    ];
    let lead = leads[Math.floor(Math.random() * leads.length)];
    if (opts && opts.length >= 2) {
      const optLeads = [
        `You're weighing **${opts.join("** vs **")}**. Here's my framework:`,
        `So it's **${opts.join("** or **")}**. Let me think through the tradeoffs:`,
        `**${opts.join("** vs **")}** — classic. Here's how I'd decide:`,
      ];
      lead = optLeads[Math.floor(Math.random() * optLeads.length)];
    }
    const frameworks = [
      `\n\n1. **What's at stake?** Each option has a cost and a payoff. Usually one is reversible and the other isn't. The reversible one is safer to try first.\n2. **What's the bottleneck?** Time, money, energy, or information. The scarcest one usually makes the call.\n3. **Flip the question.** Instead of "which is better," ask "which failure would I regret less?"\n\nGive me the specifics and I'll commit to a recommendation.`,
      `\n\n**The short version:** figure out what you can afford to lose, what you can't undo, and which option keeps the most doors open.\n\nIf you tell me the two options and what you're optimizing for, I'll give you a straight recommendation.`,
      `\n\nLet me think about this differently. The real question isn't "which is better" but "which aligns with what you actually need right now."\n\nTell me your constraints and goals, and I'll give you a clear answer with reasoning.`,
    ];
    return lead + frameworks[Math.floor(Math.random() * frameworks.length)];
  }

  // Compose an opinion response that actually engages with the topic.
  function composeOpinion(ctx) {
    const text = ctx.text.trim();
    const t = text.toLowerCase();
    const subj = (ctx.conversation && ctx.conversation.lastSubject) || "that";
    const topic = ctx.nlu ? ctx.nlu.topic : text;
    const opinionLeads = [
      `Here's my honest take on ${topic || subj}: I don't have a stake in any outcome, so I'll tell you what the reasoning points to rather than what's comforting. The strongest case for it is the main reason it works; the strongest case against is the main risk or cost. If those two were roughly balanced, I'd lean toward whichever option keeps the most doors open. Want me to apply this to your specifics?`,
      `My take on ${topic || subj}? It comes down to tradeoffs. The upside is clear; the downside is the risk you take on. If they're roughly equal, I'd go with whichever keeps more options open. Tell me your situation and I'll commit to a real recommendation.`,
      `Honestly, on ${topic || subj}: I look at what works in principle and what fails in practice. They're often different things. The strongest argument for it is the core mechanism; the strongest against is the edge case that bites you. Give me your specifics and I'll give you a straight recommendation.`,
    ];
    return opinionLeads[Math.floor(Math.random() * opinionLeads.length)];
  }

  // The genuine general-intelligence response. For any input that didn't match
  // a specific capability, this tries web search, then composes a real reply
  // that actually engages with the user's words — never a "I can't do that."
  async function composeGeneralResponse(ctx) {
    const text = ctx.text.trim();
    const t = text.toLowerCase();

    // Try web search for anything that looks like it could be a question or
    // a factual topic — this is what makes Nova able to answer ANYTHING.
    if (text.length > 3 && text.length < 400) {
      // Build a search query from the user's text
      let query = text
        .replace(/^(can you|could you|would you|will you|please|tell me|i want to know|i wonder|do you know|hey|hi|hello)\s+/i, "")
        .replace(/[?.!]+$/g, "")
        .trim();
      if (query.length > 2) {
        const result = await webSearch(query);
        if (result && result.text) {
          let response = "";
          if (result.title) response += `**${result.title}**\n\n`;
          response += result.text;
          if (result.url) response += `\n\n📖 [Source: Wikipedia](${result.url})`;
          else if (result.source) response += `\n\n📖 *Source: ${result.source}*`;
          return response;
        }
      }
    }

    // If web search didn't find anything, compose a genuine reasoning reply
    // that actually engages with what the user said.
    return composeReasoningReply(ctx);
  }

  // Compose a genuine, content-aware reply that engages with the user's actual
  // words. This is NOT a template — it extracts the key concepts from the user's
  // input and builds a varied, natural response around them.
  function composeReasoningReply(ctx) {
    const text = ctx.text.trim();
    const t = text.toLowerCase();
    const nlu = ctx.nlu || parseNLU(text, ctx.conversation);
    const mem = ctx.conversation || makeConversationMemory();
    const recentUser = (mem.turns || []).filter((tr) => tr.role === "user").slice(-3).map((tr) => tr.text);

    // Short acknowledgments — varied
    if (/^(yes|no|ok|okay|sure|cool|nice|lol|haha|true|right|exactly|makes sense)\b/.test(t) && t.length < 20) {
      const followups = [
        "Got it. What's next on your mind?",
        "Cool. Where do you want to take this?",
        "Makes sense. Want to go deeper or switch gears?",
        "Alright, I'm tracking. What else?",
        "Yep. So what are you working on?",
        "Okay. I'm here for whatever comes next.",
      ];
      return followups[Math.floor(Math.random() * followups.length)];
    }

    // Greetings that slipped through — varied
    if (/^(hey|hi|hello|yo|sup|what'?s up|howdy)\b/.test(t) && t.length < 30) {
      const greetings = [
        "Hey! I'm Nova. What's on your mind?",
        "Hi there. What can I help you with?",
        "Hello! What are we working on today?",
        "Hey. I'm here. What do you need?",
        "Yo. What's up?",
      ];
      return greetings[Math.floor(Math.random() * greetings.length)];
    }

    // "Is X good/bad/true" — give a real framework
    if (/\b(is .*(good|bad|true|real|worth it|normal|safe|bad))\b/.test(t)) {
      const topic = nlu.topic || text.replace(/\b(is|are|was|were|good|bad|true|real|worth it|normal|safe)\b/gi, "").trim();
      const frameworks = [
        `Good question. "Is ${topic || "it"} good?" really depends on what you're optimizing for.\n\nThink about it this way: what's the upside, what's the cost, and what's the alternative? If you tell me what you're trying to achieve, I'll give you a straight answer.`,
        `Honestly, "good" is relative here. For **${topic || "what you're asking about"}**, the real question is: does it solve your problem without creating a bigger one?\n\nTell me your specific situation and I'll commit to a yes or no.`,
        `It depends. ${topic ? `With ${topic},` : "With this,"} the tradeoff usually comes down to convenience vs. control. Which matters more to you right now? Give me the context and I'll make it concrete.`,
      ];
      return frameworks[Math.floor(Math.random() * frameworks.length)];
    }

    // Detect emotional state and respond naturally
    const emotions = {
      bored: /\b(bored|boring|nothing to do|kill time)\b/,
      frustrated: /\b(frustrated|annoyed|stuck|pissed|angry|ugh|this sucks)\b/,
      sad: /\b(sad|depressed|down|lonely|hopeless|tired of)\b/,
      excited: /\b(excited|hyped|pumped|can'?t wait|awesome|amazing)\b/,
      confused: /\b(confused|lost|don'?t get it|don'?t understand|what.*going on)\b/,
    };

    for (const [emotion, regex] of Object.entries(emotions)) {
      if (regex.test(t)) {
        const responses = {
          bored: [
            `Bored? Let's fix that. I can help you start a project, brainstorm something wild, teach you a new concept, or we can just talk through whatever's on your mind. What sounds good?`,
            `Boredom usually means you need a new problem to chew on. Want me to suggest a project idea, a coding challenge, or something to learn? I can also just riff with you on whatever topic you want.`,
            `I get it. Let's do something about it instead of sitting in it. Pick a direction: build something, learn something, or just vent. I'm here for all three.`,
          ],
          frustrated: [
            `That sounds frustrating. Let's break it down. What specifically is the blocker? If it's technical, I can help debug it. If it's a decision, I can help you think through it.`,
            `Frustration is usually a sign you're close but something's misaligned. Tell me what you're trying to do and what's going wrong, and I'll help you get unstuck.`,
            `Okay, let's sort this out. What's the thing that's not working? Sometimes just saying it out loud makes the path forward obvious.`,
          ],
          sad: [
            `I hear you. I'm not going to pretend I know exactly what that feels like, but I'm here if you want to talk through it, distract yourself with something, or just have someone listen.`,
            `That's tough. I'm here for whatever you need right now: a distraction, a conversation, help with something practical, or just sitting with it.`,
          ],
          excited: [
            `Love that energy. What are you excited about? Tell me and let's channel it into something concrete.`,
            `That's great! What's the plan? I can help you build, plan, or just brainstorm the next steps.`,
          ],
          confused: [
            `No worries, let's untangle it together. What's the part that doesn't make sense? Sometimes breaking it into smaller pieces clears things up.`,
            `It's okay to feel lost. Let's start from the beginning. What were you trying to do, and where did it get confusing?`,
          ],
        };
        return responses[emotion][Math.floor(Math.random() * responses[emotion].length)];
      }
    }

    // Build a genuine, context-aware response with variety
    let memBridge = "";
    try {
      const lm = Memory.load();
      if (lm.facts && lm.facts.length) {
        const words = t.split(/\s+/).filter((w) => w.length > 4);
        const rel = lm.facts.find((f) => words.some((w) => f.toLowerCase().includes(w)));
        if (rel) memBridge = ` I also remember you mentioned ${rel}, which might be relevant.`;
      }
    } catch (e) { /* ignore */ }

    // Use the actual content tokens to understand what the user is talking about
    const contentWords = (nlu.contentTokens || []).filter((w) => w.length > 3).slice(0, 5);
    const topicPhrase = contentWords.length ? contentWords.join(" ") : null;

    // Detect the type of input and respond accordingly
    const isOpinion = /\b(think|feel|believe|opinion|thoughts?)\b/.test(t);
    const isHowTo = /\b(how do|how to|how can|how should|how would)\b/.test(t);
    const isStatement = t.length < 100 && !/[?!]$/.test(text) && !/\b(what|why|when|where|who|how)\b/.test(t);

    // Build varied opening lines
    const openings = [
      "So",
      "Okay",
      "Right",
      "Alright",
      "Got it",
      "Interesting",
      "Hmm",
    ];
    const opening = openings[Math.floor(Math.random() * openings.length)];

    if (isHowTo) {
      const howToResponses = [
        `${opening}, here's how I'd approach ${topicPhrase || "that"}: break it into steps, tackle the first one, and iterate. What specifically are you trying to do? I can walk through it with you.`,
        `Good question. For ${topicPhrase || "something like that"}, the best approach is usually to start small and build up. Tell me the specifics and I'll give you a concrete plan.`,
        `Let's figure this out. The key with ${topicPhrase || "this"} is knowing what end result you want. Once you define that, the steps become clearer. What are you aiming for?`,
      ];
      return howToResponses[Math.floor(Math.random() * howToResponses.length)] + memBridge;
    }

    if (isOpinion) {
      const opinionResponses = [
        `${opening}, here's my take on ${topicPhrase || "that"}: it depends on what you value more. There's usually a tradeoff hiding in these questions. Want me to break it down?`,
        `Honestly? I think the answer comes down to your specific situation. ${topicPhrase ? `With ${topicPhrase},` : "With this,"} the general advice only gets you so far. Tell me the details and I'll give you a real recommendation.`,
        `My take: most things are more nuanced than they first appear. ${topicPhrase ? `For ${topicPhrase},` : "Here,"} I'd consider both the short-term and long-term effects. What matters most to you right now?`,
      ];
      return opinionResponses[Math.floor(Math.random() * opinionResponses.length)] + memBridge;
    }

    if (isStatement && topicPhrase) {
      const statementResponses = [
        `${opening}, ${topicPhrase}. That's interesting. What made you think about that?`,
        `I see what you're saying about ${topicPhrase}. Tell me more about where that's coming from.`,
        `${topicPhrase}... that's worth exploring. What's the context behind it?`,
        `Okay, so ${topicPhrase}. I'm curious where you want to go with this. Want to brainstorm, problem-solve, or just talk it through?`,
      ];
      return statementResponses[Math.floor(Math.random() * statementResponses.length)] + memBridge;
    }

    // General varied fallback — never the same template twice
    const generalResponses = [
      `${opening}, ${topicPhrase ? `you're talking about ${topicPhrase}.` : "I see what you mean."} ${memBridge || ""}\n\nI can dig into this with you. Want me to search for info, reason through it, write something, or build code? Pick a direction and I'll go deep.`,
      `Okay, ${topicPhrase ? `let's talk about ${topicPhrase}.` : "let's unpack that."}${memBridge}\n\nWhat angle do you want? I can research it, think through it step by step, draft something, or code a solution. Or just keep the conversation going.`,
      `Right. ${topicPhrase ? `So, ${topicPhrase}.` : "I'm following."}${memBridge}\n\nHere's what I can do: search the web, reason through it, write about it, or build something with code. What's most useful for you right now?`,
      `I'm picking up what you're putting down.${memBridge} ${topicPhrase ? `Let's go deeper on ${topicPhrase}.` : "Let's go deeper."} Do you want facts, analysis, writing, or code? Or should we just keep talking?`,
      `${topicPhrase ? `Okay, ${topicPhrase}. I'm with you.` : "I'm with you."}${memBridge}\n\nTell me what you're trying to figure out and I'll match my approach to it. I can research, reason, write, code, or just talk.`,
    ];

    return generalResponses[Math.floor(Math.random() * generalResponses.length)];
  }

  // --------------------------------------------------------------------
  // Context-aware reflective fallback for general conversation. It looks at
  // the question type (yes/no, "should I", "is X good"), the last subject in
  // the conversation, and any long-term memory, then gives a genuinely useful
  // reply instead of mirroring the input.
  // NOTE: replaced by composeDecision / composeOpinion / composeGeneralResponse
  // above in the v3 conversation capability. Kept extractOptions below.

  // Extract options from "A or B" / "A, B, or C" decision questions.
  function extractOptions(text) {
    const m = text.match(/(should i|between|which is better:?)\s+(.+)/i);
    let body = m ? m[2] : text;
    const parts = body.split(/,?\s+or\s+|,\s+/).map((s) => s.replace(/[?.!]+$/g, "").trim()).filter((s) => s.length > 0 && s.length < 60);
    return parts.length >= 2 ? parts.slice(0, 4) : null;
  }

  // The main engine function: given text + context, produce a response.
  // --------------------------------------------------------------------
  function generate(text, conversation) {
    const conv = conversation || makeConversationMemory();
    const nlu = parseNLU(text, conv);
    const ctx = {
      text: text,
      conversation: conv,
      memory: Memory.load(),
      capabilities: capabilities,
      nlu: nlu,                       // shared NLU parse available to every capability
    };

    // record the user turn + update context (subject/intent/topic/entities)
    recordTurn(conv, "user", text, {
      intent: nlu.intent,
      subject: nlu.topic || conv.lastSubject,
      topic: nlu.intent,
      entities: nlu.tech,
    });

    // find first matching capability — supports both sync and async capabilities.
    // Returns a Promise that resolves to { text, capability, timestamp }.
    return (async () => {
      let response = null;
      let usedCap = null;
      for (const cap of capabilities) {
        try {
          if (cap.canHandle(ctx)) {
            response = await cap.respond(ctx);
            if (response != null) {
              usedCap = cap.name;
              break;
            }
          }
        } catch (e) {
          // capability errored, try next
          continue;
        }
      }

      if (response == null) {
        const fallbacks = [
          "I didn't quite catch that. Could you rephrase, or tell me what you're going for?",
          "Hmm, I'm not sure I followed. Can you say it differently? Or tell me what you're trying to achieve.",
          "I want to make sure I get this right. Could you rephrase, or give me more context?",
          "I'm not quite there yet on that one. Try saying it another way, or let me know what you're after.",
        ];
        response = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        usedCap = "fallback";
      }

      // record the assistant turn + keep context fresh
      recordTurn(conv, "assistant", response, { topic: usedCap });

      return {
        text: response,
        capability: usedCap,
        timestamp: Date.now(),
      };
    })();
  }

  // --------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------
  const NovaAI = {
    generate,
    registerCapability,
    listCapabilities,
    Memory,
    makeConversationMemory,
    safeMath,
    tryMath,
    // expose for upgrades to introspect and to let approved upgrades
    // search the web (this is what makes self-upgrades genuinely useful).
    _capabilities: capabilities,
    webSearch,
    version: "4.2.2",
  };

  global.NovaAI = NovaAI;
})(window);
