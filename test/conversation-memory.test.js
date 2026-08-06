const assert = require("assert");

// --- Simulate the conversation memory system (line 86) ---

function makeConversationMemory() {
  return {
    turns: [],
    lastTopic: null,
    lastSubject: null,
    lastIntent: null,
    entities: {},
  };
}

function recordTurn(memory, role, text, meta) {
  memory.turns.push({ role: role, text: text });
  if (memory.turns.length > 40) memory.turns.shift();
  if (meta) {
    if (meta.topic) memory.lastTopic = meta.topic;
    if (meta.subject) memory.lastSubject = meta.subject;
    if (meta.intent) memory.lastIntent = meta.intent;
    if (meta.entities) {
      for (const key in meta.entities) {
        memory.entities[key] = meta.entities[key];
      }
    }
  }
  return memory;
}

// --- Tests ---

describe("Conversation memory", () => {

  it("should initialize with empty state", () => {
    const mem = makeConversationMemory();
    assert.strictEqual(mem.turns.length, 0);
    assert.strictEqual(mem.lastTopic, null);
    assert.strictEqual(mem.lastSubject, null);
    assert.strictEqual(mem.lastIntent, null);
    assert.deepStrictEqual(mem.entities, {});
  });

  it("should record a user turn", () => {
    const mem = makeConversationMemory();
    recordTurn(mem, "user", "hello");
    assert.strictEqual(mem.turns.length, 1);
    assert.strictEqual(mem.turns[0].role, "user");
    assert.strictEqual(mem.turns[0].text, "hello");
  });

  it("should record an assistant turn", () => {
    const mem = makeConversationMemory();
    recordTurn(mem, "assistant", "hi there");
    assert.strictEqual(mem.turns.length, 1);
    assert.strictEqual(mem.turns[0].role, "assistant");
    assert.strictEqual(mem.turns[0].text, "hi there");
  });

  it("should update lastTopic from meta", () => {
    const mem = makeConversationMemory();
    recordTurn(mem, "user", "tell me about mars", { topic: "mars" });
    assert.strictEqual(mem.lastTopic, "mars");
  });

  it("should update lastSubject from meta", () => {
    const mem = makeConversationMemory();
    recordTurn(mem, "user", "tell me about mars", { subject: "mars" });
    assert.strictEqual(mem.lastSubject, "mars");
  });

  it("should update lastIntent from meta", () => {
    const mem = makeConversationMemory();
    recordTurn(mem, "user", "convert 5 km to miles", { intent: "tool" });
    assert.strictEqual(mem.lastIntent, "tool");
  });

  it("should accumulate entities from meta", () => {
    const mem = makeConversationMemory();
    recordTurn(mem, "user", "what about Jupiter", { entities: { planet: "jupiter" } });
    recordTurn(mem, "user", "and its moons?", { entities: { facet: "moons" } });
    assert.strictEqual(mem.entities.planet, "jupiter");
    assert.strictEqual(mem.entities.facet, "moons");
  });

  it("should maintain turn order across multiple turns", () => {
    const mem = makeConversationMemory();
    recordTurn(mem, "user", "first");
    recordTurn(mem, "assistant", "second");
    recordTurn(mem, "user", "third");
    assert.strictEqual(mem.turns.length, 3);
    assert.strictEqual(mem.turns[0].text, "first");
    assert.strictEqual(mem.turns[1].text, "second");
    assert.strictEqual(mem.turns[2].text, "third");
  });

  it("should cap turns at 40 (rolling window)", () => {
    const mem = makeConversationMemory();
    for (let i = 0; i < 50; i++) {
      recordTurn(mem, "user", `turn ${i}`);
    }
    assert.strictEqual(mem.turns.length, 40);
    // oldest turns should have been shifted out
    assert.strictEqual(mem.turns[0].text, "turn 10");
    assert.strictEqual(mem.turns[39].text, "turn 49");
  });

  it("should preserve context across turns", () => {
    const mem = makeConversationMemory();
    recordTurn(mem, "user", "tell me about Mars", { topic: "mars", subject: "mars", intent: "knowledge" });
    recordTurn(mem, "assistant", "Mars is the fourth planet...");
    recordTurn(mem, "user", "how many moons does it have?", { topic: "mars moons", intent: "knowledge" });
    
    assert.strictEqual(mem.lastTopic, "mars moons");
    assert.strictEqual(mem.lastSubject, "mars");
    assert.strictEqual(mem.lastIntent, "knowledge");
    assert.strictEqual(mem.turns.length, 3);
  });

  it("should handle turns without meta gracefully", () => {
    const mem = makeConversationMemory();
    recordTurn(mem, "user", "hello");
    recordTurn(mem, "assistant", "hi");
    assert.strictEqual(mem.turns.length, 2);
    assert.strictEqual(mem.lastTopic, null);
    assert.strictEqual(mem.lastSubject, null);
  });
});