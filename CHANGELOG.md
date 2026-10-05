# Changelog

## 0.3.0 — 2026-10-05

- Verified normal chat through Operit -> custom provider -> Vertex Express.
- Verified Operit Tool Call connection test.
- Added Gemini 3 thought-signature preservation through an in-memory cache.
- Added compatibility fallback for tool-call history when the original signature
  cannot be recovered.
- Kept the implementation as an external ToolPkg; no Operit app fork required.

## 0.2.0

- Attempted to preserve Gemini thought signatures inside Operit tool-call XML.
- Real-device testing showed that relying on the custom XML attribute alone was
  not sufficient across reconstructed PromptTurn history.

## 0.1.0

- Initial Vertex Express provider.
- Normal chat connected successfully.
- Tool calls reached Gemini but later turns could fail when Gemini 3 required a
  missing thought signature.
