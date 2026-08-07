# Nova Chatbot

Nova AI Engine v4: a homemade, client-side AI chatbot with no external API dependencies.

**Live deployment:** [nova-ai.dls.so](https://nova-ai.dls.so)

## Features

- 12-capability modular AI engine (web search, math, code gen, writing, knowledge, reasoning, tools, planning, self-introspection, memory, conversational fallback)
- NLU layer for intent detection and entity extraction
- Conversation memory with context tracking
- Long-term memory via localStorage
- Unit conversion, temperature conversion, time/date, dice, and more
- DuckDuckGo + Wikipedia search integration for factual queries

## Project Structure

- `ai-engine-v4.js` — the core AI engine (1881 lines)
- `Nova-Chatbot-v4-updated-engine.html` — the chatbot UI (self-contained HTML)
- `test/unit-conversion.test.js` — Jest tests for unit conversion (21 tests)
- `test/temperature.test.js` — Jest tests for temperature conversion (10 tests)
- `test/nlu-intent.test.js` — Jest tests for NLU intent detection (35 tests)
- `test/conversation-memory.test.js` — Jest tests for conversation memory (10 tests)
- `package.json` — Node.js project config with Jest
- `.gitignore` — ignores node_modules, OS files, editor configs, env files
- `LICENSE` — MIT License

## Tests

```bash
npm install
npm test
```

77 tests across 4 suites, all passing:
- Unit conversion (21 tests): length and weight detection + accuracy
- Temperature conversion (10 tests): C to F, decimals, crossover point, edge cases
- NLU intent detection (35 tests): greeting, identity, memory, tool, code, writing, knowledge, social, planning, reasoning, upgrade, fallback
- Conversation memory (10 tests): initialization, turn recording, entity accumulation, 40-turn rolling window, multi-turn context

## Changelog

### v4.2.1 (Aug 7, 2026)
- Added MIT LICENSE file (roadmap item #5)
- Updated package.json: proper name, description, keywords, author, license fields
- Cleaned up stale branches from merged PRs #1 and #3

### v4.2 (Aug 7, 2026)
- Merged [PR #3](https://github.com/billyhine48-glitch/matteo/pull/3): expanded test coverage from 21 to 77 tests across 4 suites (temperature, NLU intent detection, conversation memory)
- Updated [issue #2](https://github.com/billyhine48-glitch/matteo/issues/2) roadmap: item 3 (expand test coverage) complete

### v4.1.2 (Aug 6, 2026)
- Added `.gitignore` for Node.js project (node_modules, OS files, editor configs, env files)
- Opened [issue #2](https://github.com/billyhine48-glitch/matteo/issues/2): v4.2 roadmap (server-side API, CI/CD, expanded tests, GitHub Pages, repo metadata cleanup)

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

MIT — see [LICENSE](LICENSE) file.