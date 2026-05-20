# `@tokenshelf/anthropic`

A 100-line wrapper around `@anthropic-ai/sdk` that turns every `messages.create`
into a verifiable receipt on your TokenShelf project.

```ts
import Anthropic from "@anthropic-ai/sdk";
import { wrap } from "@tokenshelf/anthropic";

const anthropic = wrap(new Anthropic(), {
  projectSlug: "rag-eval-suite",
  apiToken: process.env.TOKENSHELF_TOKEN!,
});

await anthropic.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});
// → posted to https://tokenshelf.dev/api/receipts
```

## Guarantees

- Never throws. Receipt-post failures are swallowed (logged via `onError`).
- Fire-and-forget. The `create` promise resolves the moment the SDK's does.
- Trust tier `SELF_REPORTED` — to get `VERIFIED`, also connect your Anthropic
  Admin key in [/settings](https://tokenshelf.dev/settings).

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `projectSlug` | required | Where the receipts land. |
| `apiToken` | required | A `tks_…` token minted in [/settings/tokens](https://tokenshelf.dev/settings/tokens). |
| `endpoint` | `https://tokenshelf.dev/api/receipts` | Override for self-hosting. |
| `serviceTier` | undefined | Pass `"batch"` if you're using Anthropic Batch. |
| `onError` | `console.warn` | Hook for your logger. |
