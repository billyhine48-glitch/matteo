/**
 * Unit tests for Nova AI engine — unit conversion bug fix
 *
 * Bug: The unit() helper functions in the tools capability used regex
 * patterns like /^km/ and /^kg/ to detect units. These matched "km" and
 * "kg" but NOT "kilometers" and "kilograms" (which start with "ki", not "km"/"kg").
 * As a result, converting from "kilometers" or "kilograms" was silently
 * treated as converting from "meters" or "grams", producing results that
 * were 1000x too small.
 *
 * Fix: Updated the regex to also match the full unit names:
 *   /^km/ → /^km|^kilometers?/
 *   /^kg/ → /^kg|^kilograms?/
 */

const assert = require("assert");

// --- Simulate the fixed unit() helpers from the tools capability ---

// Length converter unit detection (line 1297)
function lengthUnit(u) {
  return /^km|^kilometers?/.test(u) ? "km" : /^mi|^miles?/.test(u) ? "mi" : /^ft|^feet/.test(u) ? "ft" : "m";
}

// Weight converter unit detection (line 1307)
function weightUnit(u) {
  return /^kg|^kilograms?/.test(u) ? "kg" : /^lb|^pounds?/.test(u) ? "lb" : "g";
}

// Conversion logic (mirrors the engine's code)
const toMeters = { km: 1000, mi: 1609.34, m: 1, ft: 0.3048 };
const toGrams = { kg: 1000, lb: 453.592, g: 1 };

function convertLength(value, fromUnit, toUnit) {
  const from = lengthUnit(fromUnit);
  const to = lengthUnit(toUnit);
  const r = (value * toMeters[from]) / toMeters[to];
  return Math.round(r * 100000) / 100000;
}

function convertWeight(value, fromUnit, toUnit) {
  const from = weightUnit(fromUnit);
  const to = weightUnit(toUnit);
  const r = (value * toGrams[from]) / toGrams[to];
  return Math.round(r * 1000) / 1000;
}

// --- Tests ---

describe("Length conversion — unit detection", () => {

  it("should detect 'km' as kilometers", () => {
    assert.strictEqual(lengthUnit("km"), "km");
  });

  it("should detect 'kilometers' as kilometers (bug: was detected as meters)", () => {
    assert.strictEqual(lengthUnit("kilometers"), "km");
  });

  it("should detect 'kilometer' as kilometers", () => {
    assert.strictEqual(lengthUnit("kilometer"), "km");
  });

  it("should detect 'mi' as miles", () => {
    assert.strictEqual(lengthUnit("mi"), "mi");
  });

  it("should detect 'miles' as miles", () => {
    assert.strictEqual(lengthUnit("miles"), "mi");
  });

  it("should detect 'm' as meters", () => {
    assert.strictEqual(lengthUnit("m"), "m");
  });

  it("should detect 'ft' as feet", () => {
    assert.strictEqual(lengthUnit("ft"), "ft");
  });

  it("should convert 5 kilometers to miles correctly (not as meters)", () => {
    // 5 km = 5000 m; 5000 / 1609.34 ≈ 3.10686
    // Bug would have done: 5 m / 1609.34 ≈ 0.00311
    const result = convertLength(5, "kilometers", "miles");
    assert.strictEqual(result, 3.10686);
  });

  it("should convert 10 km to miles correctly", () => {
    const result = convertLength(10, "km", "mi");
    assert.strictEqual(result, 6.21373);
  });

  it("should convert 1 mile to kilometers correctly", () => {
    const result = convertLength(1, "miles", "kilometers");
    assert.strictEqual(result, 1.60934);
  });

  it("should convert 100 meters to kilometers correctly", () => {
    const result = convertLength(100, "m", "kilometers");
    assert.strictEqual(result, 0.1);
  });
});

describe("Weight conversion — unit detection", () => {

  it("should detect 'kg' as kilograms", () => {
    assert.strictEqual(weightUnit("kg"), "kg");
  });

  it("should detect 'kilograms' as kilograms (bug: was detected as grams)", () => {
    assert.strictEqual(weightUnit("kilograms"), "kg");
  });

  it("should detect 'kilogram' as kilograms", () => {
    assert.strictEqual(weightUnit("kilogram"), "kg");
  });

  it("should detect 'lb' as pounds", () => {
    assert.strictEqual(weightUnit("lb"), "lb");
  });

  it("should detect 'pounds' as pounds", () => {
    assert.strictEqual(weightUnit("pounds"), "lb");
  });

  it("should detect 'g' as grams", () => {
    assert.strictEqual(weightUnit("g"), "g");
  });

  it("should convert 5 kilograms to pounds correctly (not as grams)", () => {
    // 5 kg = 5000 g; 5000 / 453.592 ≈ 11.023
    // Bug would have done: 5 g / 453.592 ≈ 0.011
    const result = convertWeight(5, "kilograms", "pounds");
    assert.strictEqual(result, 11.023);
  });

  it("should convert 10 kg to lb correctly", () => {
    const result = convertWeight(10, "kg", "lb");
    assert.strictEqual(result, 22.046);
  });

  it("should convert 1 pound to kilograms correctly", () => {
    const result = convertWeight(1, "pounds", "kilograms");
    assert.strictEqual(result, 0.454);
  });

  it("should convert 500 grams to kilograms correctly", () => {
    const result = convertWeight(500, "g", "kilograms");
    assert.strictEqual(result, 0.5);
  });
});