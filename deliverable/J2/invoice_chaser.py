#!/usr/bin/env python3
"""Invoice Chaser: decide who needs a payment reminder today and write draft emails.

Reads an invoice CSV export and a JSON Lines "sent log", then writes:
  * one ready-to-review .eml draft per reminder (tiers gentle / firm / final),
  * escalations.csv for invoices 45+ days overdue (never emailed to the customer),
  * skipped_rows.csv listing rows that could not be used, with the reason,
and appends one line per action to the sent log.

It NEVER sends email. It has no network code at all. Python 3.11+, standard library only.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import unicodedata
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from email.message import EmailMessage
from email.policy import SMTP

# --------------------------------------------------------------------------- constants

REQUIRED_FIELDS = (
    "invoice_id",
    "customer_name",
    "customer_email",
    "amount",
    "currency",
    "due_date",
    "status",
)
OPTIONAL_FIELDS = ("amount_paid",)
VALID_STATUSES = ("open", "paid", "void")

TIER_GENTLE, TIER_FIRM, TIER_FINAL, TIER_ESCALATE = "gentle", "firm", "final", "escalate"
TIERS = (TIER_GENTLE, TIER_FIRM, TIER_FINAL, TIER_ESCALATE)
EMAIL_TIERS = (TIER_GENTLE, TIER_FIRM, TIER_FINAL)

COOLDOWN_DAYS = 7  # rule 5: no reminder if any reminder logged fewer than 7 days ago

ESCALATIONS_FILE = "escalations.csv"
ESCALATION_COLUMNS = ("invoice_id", "customer_name", "balance", "currency", "days_overdue")
SKIPPED_ROWS_FILE = "skipped_rows.csv"

_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
_NUMBER_RE = re.compile(r"[+-]?(\d+(\.\d*)?|\.\d+)")  # plain decimal: no exponent, commas, symbols
_CURRENCY_RE = re.compile(r"[A-Z]{3}")
# Pragmatic address check: one @, no spaces/quotes/brackets/commas/semicolons, dotted domain.
_EMAIL_RE = re.compile(
    r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
    r"@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,63}"
)
_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
_CENT = Decimal("0.01")

# Fields that can end up in an email header or a file name. Control characters
# (CR, LF, NUL, tab, ...) and Unicode line/paragraph separators are rejected in them.
_HEADER_BOUND_FIELDS = ("invoice_id", "customer_name", "customer_email", "currency")


# --------------------------------------------------------------------------- helpers

def _has_unsafe_chars(value: str) -> bool:
    """True if value contains CR/LF or any other control / line-separator character."""
    for ch in value:
        if ch in "\r\n" or unicodedata.category(ch) in ("Cc", "Zl", "Zp"):
            return True
    return False


def _has_bad_utf8(value: str) -> bool:
    """Bytes that were not valid UTF-8 are decoded as lone surrogates (surrogateescape)."""
    return any("\udc80" <= ch <= "\udcff" for ch in value)


def _parse_decimal(text: str) -> Decimal:
    if not _NUMBER_RE.fullmatch(text):
        raise ValueError(text)
    return Decimal(text)


def _parse_date(text: str) -> date:
    if not _DATE_RE.fullmatch(text):
        raise ValueError(text)
    return date.fromisoformat(text)  # raises ValueError for e.g. 2026-02-30


def _is_valid_email(text: str) -> bool:
    return len(text) <= 254 and _EMAIL_RE.fullmatch(text) is not None


def _money(value: Decimal) -> str:
    """Format with exactly two decimals, rounding half up (e.g. 1250 -> '1250.00')."""
    return f"{value.quantize(_CENT, rounding=ROUND_HALF_UP):.2f}"


def _validate_row(raw: dict) -> tuple[dict | None, str | None]:
    """Validate one CSV row (already mapped header->value). Returns (invoice, None) or (None, reason)."""
    for name, value in raw.items():
        if value is not None and _has_bad_utf8(value):
            return None, f"invalid UTF-8 in field '{name}'"

    # Header injection guard: check raw values BEFORE stripping whitespace, so a
    # trailing "\r\n" cannot be silently stripped away.
    for name in _HEADER_BOUND_FIELDS:
        value = raw.get(name)
        if value is not None and _has_unsafe_chars(value):
            return None, f"line break or control character in '{name}'"

    values = {k: (raw.get(k) or "").strip() for k in REQUIRED_FIELDS + OPTIONAL_FIELDS}

    missing = [k for k in REQUIRED_FIELDS if not values[k]]
    if missing:
        return None, "missing required field: " + ", ".join(missing)

    try:
        amount = _parse_decimal(values["amount"])
    except (ValueError, InvalidOperation):
        return None, f"unparseable amount: {values['amount']!r}"
    try:
        amount_paid = _parse_decimal(values["amount_paid"]) if values["amount_paid"] else Decimal("0")
    except (ValueError, InvalidOperation):
        return None, f"unparseable amount_paid: {values['amount_paid']!r}"
    if amount < 0:
        return None, f"negative amount: {values['amount']}"
    if amount_paid < 0:
        return None, f"negative amount_paid: {values['amount_paid']}"

    try:
        due_date = _parse_date(values["due_date"])
    except ValueError:
        return None, f"unparseable due_date (expected YYYY-MM-DD): {values['due_date']!r}"

    status = values["status"].lower()
    if status not in VALID_STATUSES:
        return None, f"unknown status: {values['status']!r}"

    currency = values["currency"].upper()
    if not _CURRENCY_RE.fullmatch(currency):
        return None, f"invalid currency code: {values['currency']!r}"

    email = values["customer_email"]
    if not _is_valid_email(email):
        return None, f"invalid email address: {email!r}"

    return {
        "invoice_id": values["invoice_id"],
        "customer_name": values["customer_name"],
        "customer_email": email,
        "amount": amount,
        "amount_paid": amount_paid,
        "currency": currency,
        "due_date": due_date,
        "status": status,
    }, None


# --------------------------------------------------------------------------- public API

def load_invoices(path: str) -> tuple[list[dict], list[dict]]:
    """Return (invoices, errors).

    Each invoice dict has keys: invoice_id (str), customer_name (str), customer_email (str),
    amount (decimal.Decimal), amount_paid (decimal.Decimal), currency (str, upper-case),
    due_date (datetime.date), status (str, lower-case).
    Each error dict has keys: row (int), reason (str).

    Row numbers count CSV records: header = row 1, first data row = row 2 (a quoted
    field spanning several lines is still one row). Completely empty rows are ignored.
    Rows sharing an invoice_id are all rejected, because we cannot tell which one is right.
    """
    candidates: list[tuple[int, dict]] = []
    errors: list[dict] = []

    # utf-8-sig strips an Excel BOM; surrogateescape turns invalid bytes into a
    # per-row error instead of crashing the whole run.
    with open(path, encoding="utf-8-sig", errors="surrogateescape", newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader, None)
        if header is None:
            return [], []
        columns = [h.strip().lower() for h in header]

        for row_number, row in enumerate(reader, start=2):
            if not any(cell.strip() for cell in row):
                continue  # blank line / all-empty row from a spreadsheet export
            raw: dict = {}
            for i, name in enumerate(columns):
                if name and name not in raw:  # first occurrence wins; extra columns ignored later
                    raw[name] = row[i] if i < len(row) else None
            invoice, reason = _validate_row(raw)
            if reason:
                errors.append({"row": row_number, "reason": reason})
            else:
                candidates.append((row_number, invoice))

    rows_by_id: dict[str, list[int]] = {}
    for row_number, inv in candidates:
        rows_by_id.setdefault(inv["invoice_id"], []).append(row_number)

    invoices: list[dict] = []
    for row_number, inv in candidates:
        rows = rows_by_id[inv["invoice_id"]]
        if len(rows) > 1:
            others = ", ".join(str(r) for r in rows if r != row_number)
            errors.append({
                "row": row_number,
                "reason": f"duplicate invoice_id {inv['invoice_id']!r} (also on row {others})",
            })
        else:
            invoices.append(inv)

    errors.sort(key=lambda e: e["row"])
    return invoices, errors


def load_sent_log(path: str) -> list[dict]:
    """Return list of {"invoice_id": str, "tier": str, "date": datetime.date}. Missing file -> [].

    Blank lines are ignored. A malformed line raises ValueError naming the line: if we
    cannot read the log we cannot guarantee "no duplicate reminders", so we fail closed.
    """
    if not os.path.exists(path):
        return []
    entries: list[dict] = []
    with open(path, encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, start=1):
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
                invoice_id = obj["invoice_id"]
                tier = obj["tier"]
                logged = _parse_date(obj["date"])
                if not isinstance(invoice_id, str) or tier not in TIERS:
                    raise ValueError("bad invoice_id or tier")
            except (ValueError, KeyError, TypeError) as exc:
                raise ValueError(
                    f"sent log {path!r} line {line_no} is malformed ({exc}); "
                    "fix or remove that line and re-run"
                ) from exc
            entries.append({"invoice_id": invoice_id, "tier": tier, "date": logged})
    return entries


def tier_for(days_overdue: int) -> str | None:
    """Rule 3: map days overdue to a tier, or None for no action."""
    if days_overdue <= 0:
        return None
    if days_overdue <= 14:
        return TIER_GENTLE
    if days_overdue <= 29:
        return TIER_FIRM
    if days_overdue <= 44:
        return TIER_FINAL
    return TIER_ESCALATE


def plan_reminders(invoices: list[dict], today: date, sent_log: list[dict]) -> list[dict]:
    """Return actions for today, sorted by invoice_id. Each action dict has keys:
    invoice_id, tier, days_overdue (int), balance (Decimal), customer_name, customer_email, currency.

    Rules 4 and 5 (once per tier, 7-day cooldown) apply to every tier including escalate,
    because every action, escalations included, is written to the sent log.
    """
    history: dict[str, list[dict]] = {}
    for entry in sent_log:
        history.setdefault(entry["invoice_id"], []).append(entry)

    actions: list[dict] = []
    for inv in invoices:
        if inv["status"] != "open":
            continue
        balance = inv["amount"] - inv["amount_paid"]
        if balance <= 0:
            continue
        days_overdue = (today - inv["due_date"]).days
        tier = tier_for(days_overdue)
        if tier is None:
            continue
        past = history.get(inv["invoice_id"], [])
        if any(e["tier"] == tier for e in past):
            continue  # rule 4: at most one reminder per tier, ever
        if any((today - e["date"]).days < COOLDOWN_DAYS for e in past):
            continue  # rule 5: cooldown (future-dated entries also block)
        actions.append({
            "invoice_id": inv["invoice_id"],
            "tier": tier,
            "days_overdue": days_overdue,
            "balance": balance,
            "customer_name": inv["customer_name"],
            "customer_email": inv["customer_email"],
            "currency": inv["currency"],
        })
    actions.sort(key=lambda a: a["invoice_id"])
    return actions


_SUBJECTS = {
    TIER_GENTLE: "Friendly reminder: invoice {invoice_id} is past due",
    TIER_FIRM: "Second reminder: invoice {invoice_id} is {days_text} overdue",
    TIER_FINAL: "FINAL NOTICE: invoice {invoice_id} is {days_text} overdue",
}

_BODIES = {
    TIER_GENTLE: (
        "Hi {customer_name},\n\n"
        "This is a friendly reminder that invoice {invoice_id} is now {days_text} past its due date. "
        "The outstanding balance is {balance_text}.\n\n"
        "If you have already sent payment, thank you, and please disregard this note. "
        "Otherwise, we would appreciate payment at your earliest convenience. "
        "If you have any questions about this invoice, just reply to this email.\n\n"
        "Best regards,\n{sender_name}\n"
    ),
    TIER_FIRM: (
        "Hi {customer_name},\n\n"
        "We have not yet received payment for invoice {invoice_id}, which is now {days_text} overdue. "
        "The outstanding balance is {balance_text}.\n\n"
        "Please arrange payment within the next 7 days, or reply to let us know when we can expect it. "
        "If there is a problem with the invoice, please tell us so we can resolve it.\n\n"
        "If payment is already on its way, please disregard this message.\n\n"
        "Regards,\n{sender_name}\n"
    ),
    TIER_FINAL: (
        "Hi {customer_name},\n\n"
        "Despite our earlier reminders, invoice {invoice_id} remains unpaid and is now {days_text} overdue. "
        "The outstanding balance is {balance_text}.\n\n"
        "Please pay the full balance within 7 days of this notice. If we do not receive payment "
        "or hear from you by then, this account will be referred to our management for further action.\n\n"
        "If you have already paid, please reply with the payment details so we can update our records.\n\n"
        "Regards,\n{sender_name}\n"
    ),
}


def render_email(action: dict, sender_name: str) -> dict:
    """For gentle/firm/final actions return {"to", "subject", "body"}.

    subject contains the invoice_id; body contains the balance formatted with exactly 2
    decimals followed by a space and the currency code (e.g. '1250.00 USD') and the days
    overdue. Raises ValueError for tier 'escalate' (escalations never go to the customer),
    for an unknown tier, and for header values containing line breaks.
    """
    tier = action["tier"]
    if tier == TIER_ESCALATE:
        raise ValueError("escalate actions are never emailed to the customer")
    if tier not in EMAIL_TIERS:
        raise ValueError(f"unknown tier: {tier!r}")

    to = str(action["customer_email"])
    invoice_id = str(action["invoice_id"])
    # Defence in depth: load_invoices already rejects these rows, but render_email can be
    # called with hand-built actions, so never let CR/LF reach a header.
    for label, value in (("customer_email", to), ("invoice_id", invoice_id)):
        if _has_unsafe_chars(value):
            raise ValueError(f"unsafe characters in {label}")
    if not _is_valid_email(to):
        raise ValueError(f"invalid email address: {to!r}")

    days = int(action["days_overdue"])
    fields = {
        "invoice_id": invoice_id,
        "customer_name": action["customer_name"],
        "days_text": f"{days} day" if days == 1 else f"{days} days",
        "balance_text": f"{_money(Decimal(action['balance']))} {action['currency']}",
        "sender_name": sender_name,
    }
    subject = _SUBJECTS[tier].format(**fields)
    if _has_unsafe_chars(subject):
        raise ValueError("unsafe characters in subject")
    return {"to": to, "subject": subject, "body": _BODIES[tier].format(**fields)}


# --------------------------------------------------------------------------- run

def _safe_filename(out_dir: str, today: date, invoice_id: str, tier: str, taken: set[str]) -> str:
    """Build a file name that can only ever live directly inside out_dir."""
    safe_id = _SAFE_NAME_RE.sub("_", invoice_id).strip("._")[:80] or "invoice"
    base = f"{today.isoformat()}_{safe_id}_{tier}"
    if safe_id != invoice_id:
        # Sanitising can merge distinct ids ("a/b" vs "a_b"); a short hash keeps them apart.
        base += "_" + hashlib.sha256(invoice_id.encode("utf-8", "surrogatepass")).hexdigest()[:8]
    name, n = f"{base}.eml", 2
    while name in taken or os.path.exists(os.path.join(out_dir, name)):
        name, n = f"{base}_{n}.eml", n + 1
    path = os.path.join(out_dir, name)
    # Final guard: the resolved path must be a direct child of out_dir.
    if os.path.dirname(os.path.realpath(path)) != os.path.realpath(out_dir):
        raise ValueError(f"refusing to write outside {out_dir!r}: {name!r}")
    taken.add(name)
    return path


def _write_eml(path: str, email: dict) -> None:
    msg = EmailMessage(policy=SMTP)  # policy rejects CR/LF in header values as a last guard
    msg["To"] = email["to"]
    msg["Subject"] = email["subject"]
    msg["X-Unsent"] = "1"  # Outlook opens the file as an unsent draft
    msg.set_content(email["body"], charset="utf-8", cte="8bit")  # readable raw file, no QP wrapping
    with open(path, "xb") as fh:  # "x": never overwrite an existing file
        fh.write(msg.as_bytes())


def _csv_cell(value) -> str:
    """Neutralise spreadsheet formula injection for text cells opened in Excel/Sheets."""
    text = str(value)
    if text and text[0] in "=+-@\t\r":
        return "'" + text
    return text


def _append_log(log_path: str, action: dict, today: date) -> None:
    line = json.dumps({"invoice_id": action["invoice_id"], "tier": action["tier"],
                       "date": today.isoformat()})
    needs_newline = False
    if os.path.exists(log_path) and os.path.getsize(log_path) > 0:
        with open(log_path, "rb") as fh:
            fh.seek(-1, os.SEEK_END)
            needs_newline = fh.read(1) != b"\n"
    with open(log_path, "a", encoding="utf-8") as fh:
        fh.write(("\n" if needs_newline else "") + line + "\n")
        fh.flush()
        os.fsync(fh.fileno())


def _run(invoices_path: str, log_path: str, out_dir: str, today: date,
         sender_name: str) -> tuple[dict, list[dict]]:
    invoices, errors = load_invoices(invoices_path)
    sent_log = load_sent_log(log_path)  # raises before anything is written if the log is corrupt
    actions = plan_reminders(invoices, today, sent_log)

    os.makedirs(out_dir, exist_ok=True)
    log_dir = os.path.dirname(os.path.abspath(log_path))
    os.makedirs(log_dir, exist_ok=True)

    emailed = escalated = 0
    escalations: list[dict] = []
    taken: set[str] = set()
    for action in actions:
        if action["tier"] == TIER_ESCALATE:
            escalations.append(action)
            continue
        email = render_email(action, sender_name)
        _write_eml(_safe_filename(out_dir, today, action["invoice_id"], action["tier"], taken), email)
        # Log only after the draft is on disk: a crash can at worst cause a visible
        # duplicate draft, never a reminder that is logged but silently missing.
        _append_log(log_path, action, today)
        emailed += 1

    if escalations:
        esc_path = os.path.join(out_dir, ESCALATIONS_FILE)
        new_file = not os.path.exists(esc_path) or os.path.getsize(esc_path) == 0
        with open(esc_path, "a", encoding="utf-8", newline="") as fh:
            writer = csv.writer(fh)
            if new_file:
                writer.writerow(ESCALATION_COLUMNS)
            for a in escalations:
                writer.writerow([_csv_cell(a["invoice_id"]), _csv_cell(a["customer_name"]),
                                 _money(a["balance"]), a["currency"], a["days_overdue"]])
        for a in escalations:
            _append_log(log_path, a, today)
            escalated += 1

    if errors:
        with open(os.path.join(out_dir, SKIPPED_ROWS_FILE), "w", encoding="utf-8", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(("row", "reason"))
            for e in errors:
                writer.writerow((e["row"], _csv_cell(e["reason"])))

    return {"emailed": emailed, "escalated": escalated, "skipped_rows": len(errors)}, errors


def run(invoices_path: str, log_path: str, out_dir: str, today: date, sender_name: str) -> dict:
    """Do a full run: write one .eml file per emailed action into out_dir, write
    out_dir/escalations.csv (columns: invoice_id, customer_name, balance, currency, days_overdue)
    when there is at least one escalation, append one line per action (emailed or escalated)
    to the sent log, and return a summary dict with integer keys:
    emailed, escalated, skipped_rows.

    Also writes out_dir/skipped_rows.csv (row, reason) when any input row was rejected.
    """
    summary, _ = _run(invoices_path, log_path, out_dir, today, sender_name)
    return summary


# --------------------------------------------------------------------------- CLI

def _iso_date(text: str) -> date:
    try:
        return _parse_date(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM-DD, got {text!r}") from None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Write draft payment-reminder emails for overdue invoices. Never sends email.")
    parser.add_argument("--invoices", required=True, help="invoice CSV export")
    parser.add_argument("--log", required=True, help="sent log (JSON Lines); created if missing")
    parser.add_argument("--out", required=True, help="folder for .eml drafts and reports")
    parser.add_argument("--today", type=_iso_date, default=None,
                        help="run date YYYY-MM-DD (default: today's local date)")
    parser.add_argument("--sender", required=True, help="name used to sign the emails")
    args = parser.parse_args(argv)
    today = args.today or date.today()

    try:
        summary, errors = _run(args.invoices, args.log, args.out, today, args.sender)
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    for e in errors:
        print(f"skipped row {e['row']}: {e['reason']}", file=sys.stderr)
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
