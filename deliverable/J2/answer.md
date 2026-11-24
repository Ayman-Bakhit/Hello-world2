# J2 Builder: Invoice Chaser: answer

**Status: done.** Everything is in `deliverable/J2/`:

- `invoice_chaser.py`: the module, all five required functions plus the CLI. Python 3.11+, standard library only, no network code.
- `README.md`: setup, running it daily (Windows Task Scheduler and cron), input format, rules, safety measures, limitations.
- `tests/test_invoice_chaser.py`: 53 pytest cases, all passing (`python -m pytest -q` on Python 3.13). The CLI was also smoke-run twice under Python 3.11: first run `{"emailed": 1, "escalated": 2, "skipped_rows": 0}`, second run all zeros.

## Design decisions

1. **It can't send, by construction.** There is no `smtplib` or socket import. The output is `.eml` drafts with `X-Unsent: 1`, so Outlook opens them as drafts for review. The body uses 8-bit encoding, so the raw file is readable too (no quoted-printable line splits through amounts).
2. **Fail closed on state, fail open on data.** A bad invoice row is skipped and reported (rule 7). A corrupt sent-log line stops the whole run *before anything is written*. Without a readable log, "no duplicates" can't be guaranteed, and a duplicate dunning email is worse than a late one.
3. **Ordering for crash safety.** Each draft is written (exclusive create, never overwrite) before its log line is appended and fsynced. The worst crash outcome is a visible duplicate draft, never a logged-but-missing reminder.
4. **Idempotency comes from the rules themselves.** Every action is logged with today's date, so rule 5 (log entry fewer than 7 days old) blocks a same-day re-run. Rule 4 blocks the tier again regardless.
5. **Rules 4 and 5 also apply to `escalate`.** The spec logs escalations to the same log, so I treated every log line as "a reminder." Effect: each invoice is escalated once, and an escalation can wait up to 6 days after a final notice. This is an interpretation, documented in the README.
6. **Spec followed literally on tiers.** There is no backfill of skipped tiers (first seen at 35 days → final only). There is no "don't downgrade" rule: if a due date is moved out and the invoice falls back to a tier never sent before, it gets that tier. I flagged this rather than invent a rule.
7. **Stricter validation where wrong guesses cost money or reputation:**
   - Duplicate `invoice_id` rejects *all* copies, not just the later ones, because I can't tell which is right.
   - Negative `amount_paid` is rejected (it would inflate the balance being chased).
   - Amounts must be plain numbers. No `$`, thousands commas or exponents.
   - The currency must be 3 letters.
   - Email gets a pragmatic single-address regex, which also blocks `a@b.com;c@d.com` multi-recipient tricks.
   - Invalid UTF-8 becomes a per-row error (via `surrogateescape`) instead of crashing the file.
   - Fully blank rows are ignored silently.
   - Row numbers count CSV records, so a quoted multi-line cell is still one row.
8. **Header injection, three layers.**
   1. Rows with CR/LF or any control or line-separator character in `invoice_id`, `customer_name`, `customer_email` or `currency` are bad rows. This is checked *before* whitespace stripping, so a trailing `\r\n` can't be stripped and then slip through.
   2. `render_email` re-checks, because it can be called with hand-built actions.
   3. `email.policy.SMTP` raises on CR/LF in headers (verified).
9. **File names.**
   - Format: `YYYY-MM-DD_<sanitised id>_<tier>.eml`, using only `[A-Za-z0-9._-]`, with leading dots stripped.
   - An 8-char SHA-256 suffix is added whenever sanitising changed the id, so `a/b` and `a_b` can't collide.
   - The resolved parent directory is asserted to equal `out_dir`.
   - The date prefix also avoids Windows reserved names like `CON`.
   - Tested with `../../etc/x`, `..`, `/abs/path`, `..\..\win`.
10. **Money formatting.** `Decimal` throughout. Display is quantized to 0.01 with ROUND_HALF_UP (`0.125` → `0.13`), not Python's default banker's rounding. `action["balance"]` stays exact.
11. **Summary dict is exactly `{emailed, escalated, skipped_rows}`.** Bad-row details are reported through the CLI's stderr and `out_dir/skipped_rows.csv`, not as extra keys, so the required return shape isn't polluted.
12. **`escalations.csv`.**
   - It is appended to (header only when the file is new), so a second same-day run with new escalations doesn't wipe the first run's list.
   - The README recommends a dated `--out` folder per day so stale files don't look new.
   - Text cells starting with `= + - @` get a `'` prefix against spreadsheet formula injection. That means a customer literally named `-Foo` shows as `'-Foo` in that file only.

## What I'd do next (in priority order)

1. **Pilot on a real export for one week in shadow mode.** Run daily and compare the drafts against what staff would have sent by hand. This is the only real validation of the rules and templates. Stop/go criterion: zero wrong-recipient or already-paid drafts.
2. **One email per customer.** Group multiple overdue invoices into a single statement-style reminder. Five separate drafts to one client looks sloppy.
3. **Lock file** around the run, to prevent two simultaneous runs against one log.
4. **Configurable templates and thresholds** (a small INI file), plus per-customer "do not chase" and "payment plan" flags read from an optional column.
5. **Decide the downgrade policy with the client.** Should a moved-out due date restart the sequence? Today it follows the spec literally.
6. **Tolerant number parsing behind an explicit flag** (`$1,250.00`) if their spreadsheet exports that way. It is strict today on purpose.
7. A `--dry-run` that prints the plan without writing or logging.

## Requirement coverage

| # | Requirement | Status | Evidence |
|---|---|---|---|
| R1 | Single module `invoice_chaser.py` at submission root | Met | `deliverable/J2/invoice_chaser.py` |
| R2 | `README.md` covering setup, daily run, rules, limitations | Met | Sections "Setup", "Running it / Daily schedule", "Rules", "Limitations" |
| R3 | Python 3.11+, stdlib only, no network, no API keys | Met | Imports: argparse, csv, hashlib, json, os, re, sys, unicodedata, datetime, decimal, email. Imported and run under python3.11. |
| R4 | `load_invoices` return types and normalisation | Met | `test_load_valid_row_types_and_normalisation` |
| R5 | `load_sent_log`, missing file → [] | Met | `test_sent_log_missing_file` |
| R6 | `plan_reminders`: rules 1–5, sorted, required keys | Met | Tier boundary tests (0, 1, 14, 15, 29, 30, 44, 45), cooldown at 6 vs 7 days, once-per-tier, sort/keys tests |
| R7 | `render_email`: subject has id, body has `1250.00 USD` and days, ValueError for escalate | Met | `test_render_email_contract`, `test_render_email_escalate_raises` |
| R8 | `run`: .eml per email, escalations.csv with exact columns only when needed, log append, summary ints | Met | `test_run_end_to_end_and_idempotent`, `test_no_escalations_file_when_none` |
| R9 | Rule 6: escalate never emailed | Met | E1 (60 days) appears in escalations.csv, with no .eml for it (3 emls for 4 actions) |
| R10 | Rule 7: bad rows skipped with row number and reason, no crash | Met | 16 parametrised bad-row cases, multi-line row numbering test |
| R11 | CLI flags, `--today` defaults to current date, prints summary | Met | `test_cli`, `test_cli_missing_input_is_clean_error` |
| R12 | No duplicates on same-day re-run | Met | Second run returns `emailed: 0, escalated: 0`, still 3 emls and 4 log lines |
| R13 | Safe file names (`../../etc/x`) | Met | `test_path_traversal_ids_stay_inside_out_dir` |
| R14 | No header injection; such rows are bad rows | Met | CR/LF cases in email, id and name are rejected as bad rows, and `render_email` raises |
| R15 | Design-decision note and next steps | Met | This file |
| R16 | Saved in `deliverable/J2/`, only that folder committed and pushed to the session branch | Met | Branch `claude/exciting-cray-4352t8` |

Not met or partial: none. One caveat: the pytest suite was run on Python 3.13 only, because pytest isn't installed for 3.11 in this environment. Under 3.11 the module was only imported and run end to end through the CLI.
