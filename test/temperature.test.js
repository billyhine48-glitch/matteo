const assert = require("assert");

// --- Simulate the temperature conversion logic from the tools capability (line 1283) ---

function convertTemperature(text) {
  const t = text.toLowerCase();
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
  return null;
}

// --- Tests ---

describe("Temperature conversion", () => {

  it("should convert 0°C to 32°F", () => {
    const result = convertTemperature("convert 0 c to f");
    assert.strictEqual(result, "0°C = **32°F**");
  });

  it("should convert 100°C to 212°F", () => {
    const result = convertTemperature("convert 100 celsius to fahrenheit");
    assert.strictEqual(result, "100°C = **212°F**");
  });

  it("should convert 32°F to 0°C", () => {
    const result = convertTemperature("convert 32 f to c");
    assert.strictEqual(result, "32°F = **0°C**");
  });

  it("should convert 212°F to 100°C", () => {
    const result = convertTemperature("convert 212 fahrenheit to celsius");
    assert.strictEqual(result, "212°F = **100°C**");
  });

  it("should convert -40°C to -40°F (the crossover point)", () => {
    const result = convertTemperature("convert -40 c to f");
    assert.strictEqual(result, "-40°C = **-40°F**");
  });

  it("should convert -40°F to -40°C (the crossover point)", () => {
    const result = convertTemperature("convert -40 f to c");
    assert.strictEqual(result, "-40°F = **-40°C**");
  });

  it("should handle decimal temperatures", () => {
    const result = convertTemperature("convert 36.6 c to f");
    assert.ok(result.includes("97.88"), `Expected 97.88 in result, got: ${result}`);
  });

  it("should handle 'degrees' keyword", () => {
    const result = convertTemperature("convert 25 degrees c to f");
    assert.ok(result !== null, "Should match with 'degrees' keyword");
    assert.ok(result.includes("77°F"), `Expected 77°F in result, got: ${result}`);
  });

  it("should return null for non-temperature text", () => {
    const result = convertTemperature("hello world");
    assert.strictEqual(result, null);
  });

  it("should return same value when converting C to C", () => {
    const result = convertTemperature("convert 50 c to c");
    assert.ok(result.includes("50"), `Expected 50 in result, got: ${result}`);
  });
});