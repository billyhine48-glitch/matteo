const assert = require("assert");

// --- Simulate the detectIntent function from the NLU layer (line 358) ---

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

// --- Tests ---

describe("NLU intent detection", () => {

  describe("Greeting", () => {
    it("should detect 'hi' as greeting", () => {
      assert.strictEqual(detectIntent("hi"), "greeting");
    });
    it("should detect 'hello' as greeting", () => {
      assert.strictEqual(detectIntent("hello"), "greeting");
    });
    it("should detect 'hey' as greeting", () => {
      assert.strictEqual(detectIntent("hey"), "greeting");
    });
    it("should detect 'good morning' as greeting", () => {
      assert.strictEqual(detectIntent("good morning"), "greeting");
    });
    it("should detect 'yo' as greeting", () => {
      assert.strictEqual(detectIntent("yo"), "greeting");
    });
  });

  describe("Identity", () => {
    it("should detect 'who are you' as identity", () => {
      assert.strictEqual(detectIntent("who are you"), "identity");
    });
    it("should detect 'what can you do' as identity", () => {
      assert.strictEqual(detectIntent("what can you do"), "identity");
    });
    it("should detect 'your name' as identity", () => {
      assert.strictEqual(detectIntent("what is your name"), "identity");
    });
  });

  describe("Memory", () => {
    it("should detect 'remember' as memory", () => {
      assert.strictEqual(detectIntent("remember that I like pizza"), "memory");
    });
    it("should detect 'note that' as memory", () => {
      assert.strictEqual(detectIntent("note that the meeting is at 3pm"), "memory");
    });
    it("should detect 'don't forget' as memory", () => {
      assert.strictEqual(detectIntent("don't forget to call mom"), "memory");
    });
  });

  describe("Tool", () => {
    it("should detect 'convert 5 km to miles' as tool", () => {
      assert.strictEqual(detectIntent("convert 5 km to miles"), "tool");
    });
    it("should detect 'roll dice' as tool", () => {
      assert.strictEqual(detectIntent("roll dice"), "tool");
    });
    it("should detect 'what time is it' as tool", () => {
      assert.strictEqual(detectIntent("what time is it"), "tool");
    });
    it("should detect 'flip coin' as tool", () => {
      assert.strictEqual(detectIntent("flip coin"), "tool");
    });
  });

  describe("Code", () => {
    it("should detect 'write a function' as code", () => {
      assert.strictEqual(detectIntent("write a function to sort an array"), "code");
    });
    it("should detect 'fibonacci' as code", () => {
      assert.strictEqual(detectIntent("calculate fibonacci sequence"), "code");
    });
    it("should detect 'regex' as code", () => {
      assert.strictEqual(detectIntent("help me with a regex pattern"), "code");
    });
  });

  describe("Writing", () => {
    it("should detect 'write a poem' as writing", () => {
      assert.strictEqual(detectIntent("write a poem about the ocean"), "writing");
    });
    it("should detect 'draft an email' as writing", () => {
      assert.strictEqual(detectIntent("draft an email to my boss"), "writing");
    });
    it("should detect 'summarize' as writing", () => {
      assert.strictEqual(detectIntent("summarize this article"), "writing");
    });
  });

  describe("Knowledge", () => {
    it("should detect 'what is the capital of France' as knowledge", () => {
      assert.strictEqual(detectIntent("what is the capital of France"), "knowledge");
    });
    it("should detect 'how many planets' as knowledge", () => {
      assert.strictEqual(detectIntent("how many planets are in the solar system"), "knowledge");
    });
    it("should detect 'explain photosynthesis' as knowledge", () => {
      assert.strictEqual(detectIntent("explain photosynthesis"), "knowledge");
    });
  });

  describe("Social", () => {
    it("should detect 'thank you' as social", () => {
      assert.strictEqual(detectIntent("thank you"), "social");
    });
    it("should detect 'goodbye' as social", () => {
      assert.strictEqual(detectIntent("goodbye"), "social");
    });
    it("should detect 'tell me a joke' as social", () => {
      assert.strictEqual(detectIntent("tell me a joke"), "social");
    });
  });

  describe("Conversation fallback", () => {
    it("should detect unknown text as conversation", () => {
      assert.strictEqual(detectIntent("I went to the store"), "conversation");
    });
    it("should detect random text as conversation", () => {
      assert.strictEqual(detectIntent("pizza is delicious"), "conversation");
    });
  });

  describe("Planning", () => {
    it("should detect 'plan a roadmap' as planning", () => {
      assert.strictEqual(detectIntent("plan a roadmap for our project"), "planning");
    });
    it("should detect 'checklist' as planning", () => {
      assert.strictEqual(detectIntent("make a checklist for the deployment"), "planning");
    });
  });

  describe("Reasoning", () => {
    it("should detect 'step by step' as reasoning", () => {
      assert.strictEqual(detectIntent("solve this step by step"), "reasoning");
    });
    it("should detect 'walk me through' as reasoning", () => {
      assert.strictEqual(detectIntent("walk me through the solution"), "reasoning");
    });
  });

  describe("Upgrade", () => {
    it("should detect 'upgrade yourself' as upgrade", () => {
      assert.strictEqual(detectIntent("can you upgrade yourself"), "upgrade");
    });
    it("should detect 'add a new capability' as upgrade", () => {
      assert.strictEqual(detectIntent("add a new capability to your engine"), "upgrade");
    });
  });
});