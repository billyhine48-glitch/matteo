# Nova Chatbot

Nova AI Engine v4 — a homemade, client-side AI chatbot with no external API dependencies.

## Features

- 12-capability modular AI engine (web search, math, code gen, writing, knowledge, reasoning, tools, planning, self-introspection, memory, conversational fallback)
- NLU layer for intent detection and entity extraction
- Conversation memory with context tracking
- Long-term memory via localStorage
- Unit conversion, temperature conversion, time/date, dice, and more

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

## License

MIT