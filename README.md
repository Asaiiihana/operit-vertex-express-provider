# Operit Vertex Express Gemini Provider

A small custom AI Provider for **Operit** that connects Operit directly to
**Google Vertex / Agent Platform Express Mode** with an Express Mode API key.

Current verified package: **v0.3.0**

## Why this exists

Operit's built-in Google/Gemini provider targets the normal Gemini Developer API
flow, while Vertex Express Mode uses a different REST route. This provider adds
that missing adapter without modifying or forking the Operit app.

Request path used by this provider:

```text
Operit
  -> ToolPkg.registerAiProvider(...)
  -> Vertex Express Provider
  -> https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent
  -> Gemini
```

## Verified on device

The v0.3.0 package has been tested in Operit with:

- Normal chat: **working**
- Tool Call connection test: **working**
- Image request transport: **connected**
  - Operit's tester reported that it could not automatically verify image understanding.
- Primary tested model: `gemini-3-flash-preview`

This is an early release based on real-device testing rather than a claim of
complete compatibility with every Gemini model or every Operit workflow.

## Install

1. Download `com-asai-vertex-express-provider-v0.3.0.toolpkg`.
2. Import/install the ToolPkg in a compatible Operit DEV build.
3. Select **Vertex Express (Gemini)** as the AI provider.
4. Enter your Vertex / Agent Platform Express Mode API key.
5. Model: start with `gemini-3-flash-preview`.
6. Endpoint: normally leave the provider default as:
   `https://aiplatform.googleapis.com`
7. Run Operit's connection test, then try a normal chat.

**Do not put your API key into the package source or commit it to Git.**

## Models listed by v0.3.0

The provider currently exposes these model IDs in its model picker:

- `gemini-3-flash-preview`
- `gemini-3-pro-preview`
- `gemini-3.1-pro-preview`
- `gemini-2.5-flash`
- `gemini-2.5-pro`
- `gemini-2.5-flash-lite`

Availability is controlled by Google and may change independently of this
package.

## Gemini 3 tool calls / thought signatures

Gemini 3 function calling can require a `thoughtSignature` to be preserved in
later conversation turns.

Operit represents tool calls internally with its own tool-call history format,
so v0.3.0 bridges this by:

1. preserving a signature in the generated Operit tool-call XML when possible;
2. keeping a small in-memory signature cache keyed by function name + arguments;
3. using Google's `skip_thought_signature_validator` compatibility value as a
   fallback when the original signature cannot be recovered.

This behavior is intentionally isolated inside the provider adapter rather than
requiring changes to Operit itself.

## Known limitations

- The provider currently uses non-streaming `generateContent`.
- Token estimation is approximate (`characters / 4`).
- The signature cache is in-memory and is not persistent storage.
- Image transport has been observed to connect, but v0.3.0 does not provide its
  own automated vision-comprehension test.
- Google preview model IDs, quotas, pricing, and Express Mode behavior can change.
- The provider has been tested primarily with `gemini-3-flash-preview`.

## Development

The package uses Operit's custom AI Provider hook:

```js
ToolPkg.registerAiProvider(provider)
```

Main exported hooks:

- `listModels`
- `sendMessage`
- `testConnection`
- `calculateInputTokens`
- `registerToolPkg`

The adapter maps Operit `PromptTurn` history and tool declarations to Gemini
`contents`, `functionDeclarations`, `functionCall`, and `functionResponse`.

## Build

A `.toolpkg` is a ZIP-format package containing at least:

```text
manifest.json
main.js
```

To reproduce v0.3.0 from this repository, ZIP `manifest.json` and `main.js` at
the archive root and use the `.toolpkg` extension.

## Official references

- Google Vertex / Agent Platform Express Mode:
  https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/express-mode/overview
- Gemini thought signatures:
  https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking/thought-signatures
- Operit source:
  https://github.com/AAswordman/Operit

## Security

This repository/package should contain **no API keys, Google account IDs,
billing IDs, service-account credentials, or local device paths**.

If you discover a secret in a published package, rotate the secret first and
then remove it from publication/history.

## License

MIT. See `LICENSE`.

## Credits

- Asai — project direction, device testing, debugging and validation.
- Sol — provider adapter implementation, protocol mapping, packaging and fixes.
- Operit and Google Gemini/Vertex are third-party projects/services and are not
  affiliated with this repository.
