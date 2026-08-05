# Nova Chatbot

Nova AI Engine v4 — a homemade, client-side AI chatbot with no external API dependencies.

**Live deployment:** [nova-ai.dls.so](https://nova-ai.dls.so)

## Features

- 12-capability modular AI engine (web search, math, code gen, writing, knowledge, reasoning, tools, planning, self-introspection, memory, conversational fallback)
- NLU layer for intent detection and entity extraction
- Conversation memory with context tracking
- Long-term memory via localStorage
- Unit conversion, temperature conversion, time/date, dice, and more
- DuckDuckGo + Wikipedia search integration for factual questions

## Project Structure

- `ai-engine-v4.js` — the core AI engine (1881 lines)
- `Nova-Chatbot-v4-updated-engine.html` — the chatbot UI (self-contained HTML)
- `test/unit-conversion.test.js` — Jest tests for unit conversion
- `package.json` — Node.js project config with Jest

## Tests

```bash
npm install
npm test
```

21 tests covering unit detection and conversion for both length and weight. All passing.

## Changelog

### v4.1.1 (Aug 5, 2026)
- Fixed `package.json` test script: replaced default `npm init` error with `jest` so `npm test` actually runs the 21 unit conversion tests

### v4.1 (Aug 4, 2026)
- Fixed unit conversion for full unit names: "kilometers" and "kilograms" were silently treated as "meters" and "grams", producing results 1000x too small ([PR #1](https://github.com/billyhine48-glitch/matteo/pull/1))
- Added "miles" and "feet" full name detection to length converter for consistency
- 21 Jest tests added covering unit detection and conversion accuracy

### v4.0 (Jul 26, 2026)
- Initial release: 12-capability AI engine with NLU, conversation memory, and long-term localStorage memory
- DuckDuckGo + Wikipedia web search integration
- Deployed at nova-ai.dls.so

## License

MIT