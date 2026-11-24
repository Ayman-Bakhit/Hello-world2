# J1 AI Currency: answers as of 2026-11-24

All sources below were opened in this session on 2026-11-24. "Verified" means I read the primary page and it says this. Anything I worked out myself is labeled as inference or a calculation.

---

## Q1: Anthropic Claude API, moving a `computer_20251124` agent to the newest generally available model

**Short answer:** Switch to `claude-fable-5-2` at **$8 per million input tokens and $40 per million output tokens**. Your `computer_20251124` declaration **will break**: it returns a 400 on the Claude API. You have to migrate to the `computer_toolset_20260801` toolset.

### 1. Model ID: `claude-fable-5-2` (Verified)
- Claude Fable 5.2 launched on **November 9, 2026**. It is the newest model launch in the release notes. The later entries (Nov 12, 16, 17 and 23) add no new model.
  Source: https://platform.claude.com/docs/en/release-notes/overview (entry dated November 9, 2026)
- Availability is "All customers on the Claude API." The sibling model `claude-mythos-5-2` has the same capabilities but is limited to "Organizations verified through Anthropic's verification programs," so it is excluded by your constraint.
  Source: https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2 (Models table)
- Note: the models overview still recommends **Claude Opus 5.5** (`claude-opus-5-5`, $4/$20) as the starting point for most workloads. Fable 5.2 is the newest model and the most capable one, but it is not the default recommendation. If cost matters more to you than being on the newest model, test Opus 5.5 first. Its computer-use story is the same: the toolset is required on the Claude API.
  Source: https://platform.claude.com/docs/en/models/overview

### 2. Standard-speed price: $8.00 per MTok input and $40.00 per MTok output (Verified)
- The models overview table and the pricing page both list Fable 5.2 at **$8 / input MTok and $40 / output MTok**.
  Sources: https://platform.claude.com/docs/en/models/overview and https://platform.claude.com/docs/en/about-claude/pricing
- These prices took effect at launch on **2026-11-09**. They are down from $10/$50 on Fable 5.1, per the release note for that date.
- Related rates, not asked for: cache reads $0.20 per MTok, Batch $4/$20, fast mode $16/$80. The full 1M context window is billed at standard rates with no long-context surcharge (pricing page, "Long context pricing").

### 3. Will `computer_20251124` keep working? **No.** (Verified)
- "A request to either model that declares a `computer_20251124` tool returns a 400 `invalid_request_error` on every platform except Amazon Bedrock." Fable 5.2 supports computer use only through `computer_toolset_20260801`.
  Source: https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2 (section "Use the computer use toolset instead of `computer_20251124`"). The change is effective from the 2026-11-09 launch and is restated in the release notes for that date.
- The same rule applies to Opus 5.5, Sonnet 5.5 and Haiku 5.5 on the Claude API. Only Bedrock still accepts `computer_20251124` for these models.
  Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool (section "Earlier tool versions")

**What to change** (Verified, from https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool#migrate-from-computer-20251124). Make all of these changes together:
1. Drop the `anthropic-beta: computer-use-2025-11-24` header and call the standard (non-beta) Messages client.
2. Set the tool entry `type` to `computer_toolset_20260801`. Delete `name`, `display_width_px`, `display_height_px`, `display_number` and `enable_zoom`, because the toolset rejects them.
3. Zoom is **on by default** in the toolset. If your environment doesn't implement zoom, add `"configs": {"zoom": {"enabled": false}}`.
4. Your loop must handle **every** `tool_use` block in a turn, not just the first one. Dispatch on `name` + `toolset_name` instead of `input.action`. Member inputs no longer contain `action`.
5. Run the blocks in order and stop at the first failure. Answer the remaining blocks with `Not executed: an earlier computer action in this turn failed.`
6. Add `"toolset_name": "computer"` to every `tool_result` that answers a member call. Results may contain only `text` and `image` content.
7. Honor the optional `repeat` field (1 to 100) on `key`.
8. Resize screenshots yourself. The toolset rejects oversized images instead of downscaling them.
9. Move any `defer_loading` into `configs`.

Before and after:
```json
// before (sent with anthropic-beta: computer-use-2025-11-24)
{"type": "computer_20251124", "name": "computer", "display_width_px": 1024, "display_height_px": 768, "display_number": 1}
// after (no beta header)
{"type": "computer_toolset_20260801", "configs": {"zoom": {"enabled": false}}}
```

**Other Fable 5.2 breaking changes that can hit an agent loop** (Verified, same whats-new page):
- The prefix check is enforced for **every** account. If your loop edits `system`, `tools` or earlier messages and then sends back Fable 5.2 thinking blocks, the request gets a 400 ("The block is bound to a different conversation").
- `tool_choice` `any`/`tool` (forced tool use) is not accepted.
- Thinking is always on, and `budget_tokens` or `disabled` returns a 400.
- **Unverified in the live docs this session** (from Anthropic's bundled API reference, cached 2026-11-03): Fable 5.2 needs 30-day data retention, so an org on zero data retention gets a 400. Check this if your org uses ZDR.

---

## Q2: OpenAI GPT-6.2 overnight jobs on the Responses API

**Short answer:** Flex is **not available** on GPT-6.2. OpenAI's stated replacement is **background mode with a discounted completion window**: 8h is 40% below Standard and 2h is 30% below. However, if your overnight requests are independent of each other, the **Batch API is cheaper at 50% off**, with up to 24h turnaround.

### 1. Can I use `service_tier: "flex"` on GPT-6.2? **No.** (Verified)
- "Flex is unavailable on GPT-6.2 Astra and GPT-6.2 Sol, and we won't be adding it to future models." Flex is being wound down on the older models, and no retirement date has been published yet.
  Source: https://developers.openai.com/api/docs/guides/flex-processing (platform.openai.com/docs/guides/flex-processing redirects here)
- Date of change: **November 17, 2026**. The changelog for that date says "New models will not support Flex processing," alongside the GPT-6.2 Astra and Sol launch.
  Source: https://developers.openai.com/api/docs/changelog (Nov 17 entries)
- The pricing page's Flex table lists only gpt-6-astra, gpt-6.1-sol, gpt-6.1-terra and gpt-6-luna, with no GPT-6.2 models.
  Source: https://developers.openai.com/api/docs/pricing

### 2. Recommended alternative and the discount (Verified)
- **Recommended by OpenAI:** discounted background completion windows in the Responses API, in public beta on GPT-6.2 Astra, GPT-6.2 Sol, GPT-6.1 Terra and GPT-6 Luna. The token rate is **30% below Standard for the `2h` window and 40% below for the `8h` window**. The discount applies to every eligible request, including follow-ups.
  Sources: https://developers.openai.com/api/docs/guides/background ("Use discounted completion windows"), the flex-processing guide, and the pricing page. Launched **2026-11-17** per the changelog.
- **Cheaper option for independent requests:** the Batch API is **50% off** with a 24h completion window. The pricing page lists Batch rates for gpt-6.2-astra ($4/$20) and gpt-6.2-sol ($1/$5).
  Sources: https://developers.openai.com/api/docs/guides/batch and https://developers.openai.com/api/docs/pricing

Calculated from Standard rates on the pricing page (computed in Python), per 1M tokens, input / output:

| Model | Standard | 2h window (-30%) | 8h window (-40%) | Batch API (-50%, ≤24h) |
|---|---|---|---|---|
| gpt-6.2-astra | $8.00 / $40.00 | $5.60 / $28.00 | $4.80 / $24.00 | $4.00 / $20.00 |
| gpt-6.2-sol | $2.00 / $10.00 | $1.40 / $7.00 | $1.20 / $6.00 | $1.00 / $5.00 |

**Recommendation:**
- If each overnight item is a standalone request, use **Batch**. It is the cheapest option and covers "can wait a few hours," but completion is only guaranteed within 24h, not 8h.
- If the jobs are multi-step agent runs (tool calls with follow-ups), or results must land within 8h, use the **8h background window**.
- Caveat: Standard requests can't reuse prompt-cache entries created by 2h or 8h background requests. Requests on 2h or 8h windows also share the Batch/Background rate limit with Batch jobs (background guide).

### 3. Fields to set (Verified, background guide)
On `POST /v1/responses`:
```json
{
  "model": "gpt-6.2-sol",
  "input": "...",
  "background": true,
  "service_tier": "default",
  "background_options": {
    "completion_window": "8h",
    "continuation_id": "<your-run-id>"
  }
}
```
- `background: true` is required.
- `background_options.completion_window` must be `"2h"` or `"8h"`. The default `"soonest"` gets no discount.
- `service_tier: "default"`. Discounted windows require Standard processing. With `auto`, a request qualifies only if Standard is selected. **Remove `"flex"`.**
- Leave `stream` unset or set it to false.
- `background_options.continuation_id` is optional. Reuse it with the same model, project and window on follow-ups to get higher queue priority.
- Get results through a `response.completed` webhook, or by polling the response ID.

For Batch instead: upload a JSONL file, then call `POST /v1/batches` with `input_file_id`, `endpoint: "/v1/responses"` and `completion_window: "24h"`.

---

## Q3: Google Gemini API, `gemini-embedding-2-preview`

**Short answer:** The model was deprecated, and since **November 6, 2026** calls to it are routed to `gemini-embedding-2`. Your existing calls still work, billed at Gemini Embedding 2 rates. **No re-indexing is needed**, because Google says the two models share the same embedding space.

### 1. What happened, and from when (Verified)
- "`gemini-embedding-2-preview` is deprecated. Effective November 6, 2026, API requests to `gemini-embedding-2-preview` route to `gemini-embedding-2` at Gemini Embedding 2 rates."
  Source: https://ai.google.dev/gemini-api/docs/changelog (now redirects to https://aistudio.google.com/docs/changelog), entry dated **November 6, 2026**
- The deprecations table lists `gemini-embedding-2-preview` with release date March 10, 2026, shutdown date **November 6, 2026**, and replacement `gemini-embedding-2`. `gemini-embedding-2` itself has "No shutdown date announced."
  Source: https://ai.google.dev/gemini-api/docs/deprecations (now redirects to https://aistudio.google.com/docs/deprecations), "Embedding models / Deprecated models"

### 2. What happens to calls that still name it (Verified)
- They don't fail. They are **routed to `gemini-embedding-2`** and billed at Gemini Embedding 2 rates.
- Google says to "Update your model string to `gemini-embedding-2`." Do that now rather than relying on the alias indefinitely. My inference: aliases for deprecated models can be removed later, though no removal date is published.
  Source: changelog, Nov 6, 2026

### 3. Do I need to re-embed? **No** (Verified, with one caveat)
- "`gemini-embedding-2` uses the same API schema, pricing, and embedding space, so no other code changes or vector re-indexing are needed."
  Source: changelog, Nov 6, 2026
- Caveat (Verified): this applies only to vectors made with the **preview** model. Vectors from `gemini-embedding-001` are **incompatible** with `gemini-embedding-2`, and Google says you "must re-embed all of your existing data" in that case. If your index mixes models, re-embed the `001` vectors.
  Source: https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2 (redirects to https://aistudio.google.com/docs/models/gemini-embedding-2), section "Migration from gemini-embedding-001"
- Inference, not stated by Google: keep the same `output_dimensionality` (128 to 3072) and task settings you used at index time, so new query vectors match the stored ones. A cheap check is to re-embed about 20 stored documents and confirm cosine similarity of about 1.0 against the stored vectors before trusting the switch.

---

## Requirement check
- R1, Q1.1 to Q1.3 answered: Met, in the Q1 section (model ID, price, computer-tool migration).
- R2, Q2.1 to Q2.3 answered: Met, in the Q2 section (Flex no, alternative and discount, fields).
- R3, Q3.1 to Q3.3 answered: Met, in the Q3 section (what happened and date, routing, re-index).
- R4, a source URL and change date for every answer: Met. Each sub-answer cites a URL and an effective date: 2026-11-09 for Q1, 2026-11-17 for Q2, 2026-11-06 for Q3.
- R5, flag anything uncertain: Met. The Fable 5.2 ZDR requirement is labeled unverified. Two other points are labeled as my inference: that the preview alias may not last, and the dimensionality advice. Google docs URLs now redirect from ai.google.dev to aistudio.google.com, and both are given.
- R6, save to deliverable/J1/answer.md and commit only that folder: see git commit.
