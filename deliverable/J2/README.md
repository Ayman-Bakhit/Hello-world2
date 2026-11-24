# Invoice Chaser

Run it once each morning. It reads your invoice export, works out who needs a payment reminder today, and writes draft emails (`.eml` files) into a folder. You review the drafts and send them yourself.

**It never sends email.** The code has no networking at all: no SMTP, no HTTP, no API keys.

## Setup

1. Install Python 3.11 or newer (https://www.python.org/downloads/). Nothing else is needed. It uses only the standard library.
2. Copy `invoice_chaser.py` to a folder, for example `C:\invoice-chaser\` or `~/invoice-chaser/`.
3. Optional, for developers: `pip install pytest`, then run `python -m pytest -q` from this folder.

## Running it

```bash
python invoice_chaser.py --invoices exports/invoices.csv --log state/sent_log.jsonl --out reminders/2026-11-24 --sender "Jane Doe, Acme Bookkeeping"
```

| option | meaning |
|---|---|
| `--invoices` | the invoice CSV exported from your spreadsheet (UTF-8) |
| `--log` | the sent log. Created on the first run. **Keep this one file forever and always point at the same one.** It is what stops duplicate reminders. |
| `--out` | folder for the drafts and reports. Created if missing. |
| `--today` | run date `YYYY-MM-DD`. Defaults to today's date on the computer. Use it to re-run or test a specific day. |
| `--sender` | name used to sign the emails |

It prints a summary such as `{"emailed": 3, "escalated": 1, "skipped_rows": 1}`. Each skipped row is also printed with its row number and reason. Exit code is 0 on success and 2 if a file can't be read or the sent log is corrupt (nothing is written in that case).

### What lands in the `--out` folder

* `YYYY-MM-DD_<invoice_id>_<tier>.eml`: one draft per reminder. Double-click to open in Outlook, Apple Mail or Thunderbird. Outlook opens it as an unsent draft. Check it, then send it from your normal mailbox. Any unusual characters in the invoice id are replaced, and a short hash is added to the file name when that happens.
* `escalations.csv`: invoices 45+ days overdue, for the owner. Columns: `invoice_id, customer_name, balance, currency, days_overdue`. Written only when there is at least one escalation.
* `skipped_rows.csv`: rows that could not be used, with their row number (header = row 1) and the reason. Written only when there are bad rows. Fix them in the spreadsheet and they are picked up next run.

Use a new `--out` folder per day (the date in the example above). That way, files from yesterday don't look like today's.

### Daily schedule

The simplest option is a person running it each morning. To automate it:

**Windows (Task Scheduler):** create a `chase.bat` file:

```bat
cd /d C:\invoice-chaser
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set TODAY=%%d
python invoice_chaser.py --invoices exports\invoices.csv --log state\sent_log.jsonl --out reminders\%TODAY% --sender "Jane Doe" >> chase.log 2>&1
```

Then Task Scheduler → Create Basic Task → Daily, 7:30 AM → Start a program → `chase.bat`.

**macOS / Linux (cron):** `crontab -e`, then add:

```bash
30 7 * * 1-5 cd ~/invoice-chaser && python3 invoice_chaser.py --invoices exports/invoices.csv --log state/sent_log.jsonl --out reminders/$(date +\%F) --sender "Jane Doe" >> chase.log 2>&1
```

Export a fresh invoice CSV before it runs. The tool can only see what's in the export.

## Input format

UTF-8 CSV with a header row. Column order doesn't matter and extra columns are ignored. An Excel BOM is fine.

| column | rule |
|---|---|
| `invoice_id` | required, unique. If an id appears on more than one row, **all** of those rows are skipped, because the tool can't tell which one is right. |
| `customer_name` | required |
| `customer_email` | required. Must be a single, plain address (`ap@client.com`). No lists or display names. |
| `amount` | required, plain number such as `1250` or `1250.00`. No `$`, no thousands commas, no negatives. |
| `amount_paid` | optional. Blank means 0. No negatives. |
| `currency` | required, 3 letters (upper-cased automatically) |
| `due_date` | required, `YYYY-MM-DD` |
| `status` | `open`, `paid` or `void`. Case and surrounding spaces are ignored. |

Sent log: one JSON object per line, `{"invoice_id": "...", "tier": "...", "date": "YYYY-MM-DD"}`. The tool appends to it. Don't edit it unless you mean to (see Limitations).

## Rules

1. Only `open` invoices with a balance due (`amount - amount_paid`) above 0 are considered.
2. `days_overdue = today - due_date` in calendar days.
3. Tier: 1–14 days → **gentle**, 15–29 → **firm**, 30–44 → **final**, 45+ → **escalate**. 0 or less → nothing.
4. Each invoice gets at most one reminder per tier, ever. Tiers are not backfilled: an invoice first seen at 35 days gets only the final notice.
5. No reminder for an invoice if any reminder for it was logged fewer than 7 days before today. Exactly 7 days is allowed. This also applies to escalations, so an escalation can come up to 6 days after a final notice.
6. Escalations are never emailed to the customer. They go to `escalations.csv`, once per invoice.
7. Bad rows (missing field, unparseable number or date, unknown status, invalid email, invalid currency, duplicate id, line breaks or control characters in id, name, email or currency, invalid UTF-8) are skipped and reported. They never stop the run. Completely blank rows are ignored silently.

Safety:

* Running twice on the same day doesn't duplicate anything. The first run logs every action dated today, and rule 5 blocks the rest.
* A draft is written to disk before its log line is added. If the computer dies mid-run, the worst case is a duplicate draft you'll see, never a reminder that was logged but not written. Existing files are never overwritten.
* File names are built only from letters, digits, `.`, `_` and `-`, and the final path is checked to be directly inside `--out`. An id like `../../etc/x` can't escape the folder.
* Rows with CR/LF in any field that reaches a header or file name are rejected, `render_email` refuses them again, and the email library is a third guard.
* Text cells in `escalations.csv` starting with `=`, `+`, `-` or `@` get a leading `'` so they open as text, not formulas, in Excel.

## Limitations

* **The CSV is the source of truth.** If a payment isn't in the export yet, the customer still gets chased. Every template includes "if you've already paid, please disregard."
* A corrupt sent log stops the run (fail closed) with the line number. Fix or delete that line by hand. Deleting log lines makes those reminders eligible again.
* Editing a due date doesn't reset history. Rule 4 is per tier, ever. If a due date is pushed out and the invoice drops back to `gentle`, it gets a gentle reminder only if `gentle` was never sent before.
* Don't run two copies at once against the same log. There is no file lock.
* Amounts must be plain numbers. `$1,250.00` and European `1.250,00` are rejected, not guessed.
* Email validation is a practical format check. It can't tell whether the mailbox exists.
* Balances are shown rounded half-up to 2 decimals, so `99.999` shows as `100.00`. Currencies without cents (JPY) still show `.00`.
* One email per invoice. A customer with five overdue invoices gets five drafts.
* "Today" is the local date of the computer running it.
* Templates are English only. Edit `_SUBJECTS` / `_BODIES` in `invoice_chaser.py` to change the wording. Keep `{invoice_id}` in subjects and `{balance_text}` and `{days_text}` in bodies.
