"""Tests for invoice_chaser. Run from the deliverable folder: python -m pytest -q"""

import csv
import json
import os
import subprocess
import sys
from datetime import date, timedelta
from decimal import Decimal
from email import message_from_bytes, policy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import invoice_chaser as ic  # noqa: E402

TODAY = date(2026, 11, 24)
HEADER = "invoice_id,customer_name,customer_email,amount,amount_paid,currency,due_date,status\n"


def due(days_overdue: int) -> str:
    return (TODAY - timedelta(days=days_overdue)).isoformat()


def write_csv(tmp_path, body: str, header: str = HEADER, name="invoices.csv") -> str:
    p = tmp_path / name
    p.write_text(header + body, encoding="utf-8", newline="")
    return str(p)


def inv(invoice_id="INV-1", days=5, amount="100.00", paid="0", status="open", **kw):
    d = {
        "invoice_id": invoice_id, "customer_name": "Acme", "customer_email": "ap@acme.com",
        "amount": Decimal(amount), "amount_paid": Decimal(paid), "currency": "USD",
        "due_date": TODAY - timedelta(days=days), "status": status,
    }
    d.update(kw)
    return d


def log(invoice_id, tier, days_ago):
    return {"invoice_id": invoice_id, "tier": tier, "date": TODAY - timedelta(days=days_ago)}


# ------------------------------------------------------------------ load_invoices

def test_load_valid_row_types_and_normalisation(tmp_path):
    path = write_csv(tmp_path, f"INV-1,Acme Ltd,ap@acme.com,1250,,usd,{due(3)},  OPEN \n")
    invoices, errors = ic.load_invoices(path)
    assert errors == []
    (i,) = invoices
    assert i["amount"] == Decimal("1250") and isinstance(i["amount"], Decimal)
    assert i["amount_paid"] == Decimal("0")
    assert i["currency"] == "USD"
    assert i["status"] == "open"
    assert i["due_date"] == TODAY - timedelta(days=3)


def test_column_order_extra_columns_and_bom(tmp_path):
    p = tmp_path / "x.csv"
    content = ("status,notes,due_date,currency,amount_paid,amount,customer_email,customer_name,invoice_id\n"
               f"open,whatever,{due(3)},EUR,10.5,20,b@c.io,Bob,A1\n")
    p.write_bytes(b"\xef\xbb\xbf" + content.encode("utf-8"))
    invoices, errors = ic.load_invoices(str(p))
    assert errors == []
    assert invoices[0]["invoice_id"] == "A1"
    assert "notes" not in invoices[0]
    assert invoices[0]["amount_paid"] == Decimal("10.5")


@pytest.mark.parametrize("row,reason_part", [
    (f",Acme,a@b.com,10,,USD,{due(3)},open", "missing required field"),
    (f"X,Acme,a@b.com,ten,,USD,{due(3)},open", "unparseable amount"),
    (f"X,Acme,a@b.com,1e3,,USD,{due(3)},open", "unparseable amount"),
    (f"X,Acme,a@b.com,NaN,,USD,{due(3)},open", "unparseable amount"),
    (f"X,Acme,a@b.com,10,abc,USD,{due(3)},open", "unparseable amount_paid"),
    (f"X,Acme,a@b.com,10,-5,USD,{due(3)},open", "negative amount_paid"),
    ("X,Acme,a@b.com,10,,USD,2026-02-30,open", "unparseable due_date"),
    ("X,Acme,a@b.com,10,,USD,24/11/2026,open", "unparseable due_date"),
    (f"X,Acme,a@b.com,10,,USD,{due(3)},pending", "unknown status"),
    (f"X,Acme,not-an-email,10,,USD,{due(3)},open", "invalid email"),
    (f"X,Acme,a@b.com;c@d.com,10,,USD,{due(3)},open", "invalid email"),
    (f"X,Acme,a@b.com,10,,US,{due(3)},open", "invalid currency"),
    (f'X,Acme,"a@b.com\r\nBcc: victim@evil.com",10,,USD,{due(3)},open', "line break"),
    (f'"X\r\nBcc: v@evil.com",Acme,a@b.com,10,,USD,{due(3)},open', "line break"),
    (f'X,"Acme\nInc",a@b.com,10,,USD,{due(3)},open', "line break"),
    ("X,Acme,a@b.com,10", "missing required field"),  # short row
])
def test_bad_rows_are_reported_not_raised(tmp_path, row, reason_part):
    path = write_csv(tmp_path, f"GOOD,Acme,a@b.com,10,,USD,{due(3)},open\n" + row + "\n")
    invoices, errors = ic.load_invoices(path)
    assert [i["invoice_id"] for i in invoices] == ["GOOD"]
    assert len(errors) == 1
    assert errors[0]["row"] == 3
    assert reason_part in errors[0]["reason"]


def test_row_numbers_count_records_not_lines(tmp_path):
    body = (f'A,"Multi\nline name",a@b.com,10,,USD,{due(3)},open\n'  # row 2 (bad: newline in name)
            f"B,Acme,a@b.com,zz,,USD,{due(3)},open\n")               # row 3
    _, errors = ic.load_invoices(write_csv(tmp_path, body))
    assert [e["row"] for e in errors] == [2, 3]


def test_blank_rows_ignored(tmp_path):
    body = f"\n,,,,,,,\nA,Acme,a@b.com,10,,USD,{due(3)},open\n"
    invoices, errors = ic.load_invoices(write_csv(tmp_path, body))
    assert errors == [] and len(invoices) == 1


def test_duplicate_ids_all_rejected(tmp_path):
    body = (f"A,Acme,a@b.com,10,,USD,{due(3)},open\n"
            f"A,Acme,a@b.com,10,10,USD,{due(3)},paid\n")
    invoices, errors = ic.load_invoices(write_csv(tmp_path, body))
    assert invoices == []
    assert [e["row"] for e in errors] == [2, 3]
    assert all("duplicate" in e["reason"] for e in errors)


def test_invalid_utf8_is_a_row_error(tmp_path):
    p = tmp_path / "x.csv"
    p.write_bytes(HEADER.encode() + b"A,Acme \xff,a@b.com,10,,USD," + due(3).encode() + b",open\n"
                  + b"B,Acme,a@b.com,10,,USD," + due(3).encode() + b",open\n")
    invoices, errors = ic.load_invoices(str(p))
    assert [i["invoice_id"] for i in invoices] == ["B"]
    assert errors[0]["row"] == 2 and "UTF-8" in errors[0]["reason"]


# ------------------------------------------------------------------ load_sent_log

def test_sent_log_missing_file(tmp_path):
    assert ic.load_sent_log(str(tmp_path / "nope.jsonl")) == []


def test_sent_log_parses_dates_and_skips_blank_lines(tmp_path):
    p = tmp_path / "log.jsonl"
    p.write_text('{"invoice_id": "A", "tier": "gentle", "date": "2026-11-01"}\n\n')
    assert ic.load_sent_log(str(p)) == [{"invoice_id": "A", "tier": "gentle", "date": date(2026, 11, 1)}]


def test_sent_log_corrupt_line_fails_closed(tmp_path):
    p = tmp_path / "log.jsonl"
    p.write_text('{"invoice_id": "A", "tier": "gentle", "date": "2026-11-01"}\n{"invoice_id": "B"\n')
    with pytest.raises(ValueError, match="line 2"):
        ic.load_sent_log(str(p))


# ------------------------------------------------------------------ plan_reminders

@pytest.mark.parametrize("days,tier", [
    (-3, None), (0, None), (1, "gentle"), (14, "gentle"), (15, "firm"), (29, "firm"),
    (30, "final"), (44, "final"), (45, "escalate"), (400, "escalate"),
])
def test_tier_boundaries(days, tier):
    actions = ic.plan_reminders([inv(days=days)], TODAY, [])
    assert [a["tier"] for a in actions] == ([tier] if tier else [])
    if tier:
        assert actions[0]["days_overdue"] == days and isinstance(actions[0]["days_overdue"], int)


def test_only_open_with_positive_balance():
    invoices = [
        inv("A", status="paid"), inv("B", status="void"),
        inv("C", paid="100.00"), inv("D", paid="150.00"),
        inv("E", paid="40.00"),
    ]
    actions = ic.plan_reminders(invoices, TODAY, [])
    assert [a["invoice_id"] for a in actions] == ["E"]
    assert actions[0]["balance"] == Decimal("60.00")


def test_once_per_tier_ever():
    assert ic.plan_reminders([inv(days=10)], TODAY, [log("INV-1", "gentle", 30)]) == []
    # moved to a new tier and cooldown passed -> reminder
    assert ic.plan_reminders([inv(days=20)], TODAY, [log("INV-1", "gentle", 10)])[0]["tier"] == "firm"


def test_seven_day_cooldown():
    assert ic.plan_reminders([inv(days=20)], TODAY, [log("INV-1", "gentle", 6)]) == []
    assert len(ic.plan_reminders([inv(days=20)], TODAY, [log("INV-1", "gentle", 7)])) == 1
    # cooldown also applies to escalation, and to log lines for the same invoice only
    assert ic.plan_reminders([inv(days=50)], TODAY, [log("INV-1", "final", 2)]) == []
    assert len(ic.plan_reminders([inv(days=20)], TODAY, [log("OTHER", "gentle", 1)])) == 1


def test_skipped_tier_is_not_backfilled():
    # first time we see it, it is already 35 days late: send final only
    actions = ic.plan_reminders([inv(days=35)], TODAY, [])
    assert [a["tier"] for a in actions] == ["final"]


def test_actions_sorted_and_keys():
    actions = ic.plan_reminders([inv("B"), inv("A"), inv("C")], TODAY, [])
    assert [a["invoice_id"] for a in actions] == ["A", "B", "C"]
    assert set(actions[0]) == {"invoice_id", "tier", "days_overdue", "balance",
                               "customer_name", "customer_email", "currency"}


# ------------------------------------------------------------------ render_email

def action(**kw):
    a = {"invoice_id": "INV-9", "tier": "gentle", "days_overdue": 12, "balance": Decimal("1250"),
         "customer_name": "Acme", "customer_email": "ap@acme.com", "currency": "USD"}
    a.update(kw)
    return a


@pytest.mark.parametrize("tier", ["gentle", "firm", "final"])
def test_render_email_contract(tier):
    e = ic.render_email(action(tier=tier), "Jane Doe")
    assert set(e) == {"to", "subject", "body"}
    assert e["to"] == "ap@acme.com"
    assert "INV-9" in e["subject"]
    assert "1250.00 USD" in e["body"]
    assert "12" in e["body"]
    assert "Jane Doe" in e["body"]


def test_render_email_money_rounding():
    assert "0.13 EUR" in ic.render_email(action(balance=Decimal("0.125"), currency="EUR"), "x")["body"]
    assert "1.10 USD" in ic.render_email(action(balance=Decimal("1.1")), "x")["body"]


def test_render_email_escalate_raises():
    with pytest.raises(ValueError):
        ic.render_email(action(tier="escalate"), "x")


def test_render_email_rejects_header_injection():
    with pytest.raises(ValueError):
        ic.render_email(action(customer_email="a@b.com\r\nBcc: x@y.com"), "x")
    with pytest.raises(ValueError):
        ic.render_email(action(invoice_id="I\nBcc: x@y.com"), "x")


# ------------------------------------------------------------------ run (end to end)

def full_csv(tmp_path):
    body = (
        f"G1,Gina,g@x.com,100,,USD,{due(5)},open\n"
        f"F1,Fred,f@x.com,200,50,EUR,{due(20)},open\n"
        f"L1,Lara,l@x.com,300.5,,GBP,{due(31)},Open\n"
        f"E1,=Evil Corp,e@x.com,400,,USD,{due(60)},open\n"
        f"P1,Paid,p@x.com,100,100,USD,{due(60)},paid\n"
        f"N1,NotDue,n@x.com,100,,USD,{due(-2)},open\n"
        f"BAD,Bad,bad-email,100,,USD,{due(5)},open\n"
    )
    return write_csv(tmp_path, body)


def test_run_end_to_end_and_idempotent(tmp_path):
    out = tmp_path / "out"
    log_path = tmp_path / "state" / "sent.jsonl"
    summary = ic.run(full_csv(tmp_path), str(log_path), str(out), TODAY, "Jane")
    assert summary == {"emailed": 3, "escalated": 1, "skipped_rows": 1}

    emls = sorted(out.glob("*.eml"))
    assert len(emls) == 3
    msgs = {m["Subject"]: m for m in (message_from_bytes(p.read_bytes(), policy=policy.default)
                                       for p in emls)}
    firm = next(m for s, m in msgs.items() if "F1" in s)
    assert firm["To"] == "f@x.com"
    assert "150.00 EUR" in firm.get_content()
    assert "150.00 EUR" in next(p for p in emls if "F1" in p.name).read_text()  # raw file readable

    with open(out / "escalations.csv", newline="") as fh:
        rows = list(csv.DictReader(fh))
    assert rows == [{"invoice_id": "E1", "customer_name": "'=Evil Corp", "balance": "400.00",
                     "currency": "USD", "days_overdue": "60"}]

    skipped = (out / "skipped_rows.csv").read_text()
    assert "8" in skipped and "invalid email" in skipped

    lines = [json.loads(x) for x in log_path.read_text().splitlines()]
    assert sorted((x["invoice_id"], x["tier"]) for x in lines) == [
        ("E1", "escalate"), ("F1", "firm"), ("G1", "gentle"), ("L1", "final")]
    assert {x["date"] for x in lines} == {"2026-11-24"}

    # second run, same day, same inputs -> nothing new
    summary2 = ic.run(full_csv(tmp_path), str(log_path), str(out), TODAY, "Jane")
    assert summary2 == {"emailed": 0, "escalated": 0, "skipped_rows": 1}
    assert len(list(out.glob("*.eml"))) == 3
    assert len(log_path.read_text().splitlines()) == 4


def test_no_escalations_file_when_none(tmp_path):
    path = write_csv(tmp_path, f"G1,Gina,g@x.com,100,,USD,{due(5)},open\n")
    out = tmp_path / "out"
    ic.run(path, str(tmp_path / "log.jsonl"), str(out), TODAY, "Jane")
    assert not (out / "escalations.csv").exists()
    assert not (out / "skipped_rows.csv").exists()


def test_path_traversal_ids_stay_inside_out_dir(tmp_path):
    body = (f"../../etc/x,A,a@x.com,10,,USD,{due(5)},open\n"
            f"..,B,b@x.com,10,,USD,{due(5)},open\n"
            f"/abs/path,C,c@x.com,10,,USD,{due(5)},open\n"
            f"..\\..\\win,D,d@x.com,10,,USD,{due(5)},open\n"
            f"a/b,E,e@x.com,10,,USD,{due(5)},open\n"
            f"a_b,F,f@x.com,10,,USD,{due(5)},open\n")
    work = tmp_path / "work"
    out = work / "out"
    summary = ic.run(write_csv(tmp_path, body), str(tmp_path / "log.jsonl"), str(out), TODAY, "J")
    assert summary["emailed"] == 6
    written = [p for p in tmp_path.rglob("*") if p.is_file() and p.suffix == ".eml"]
    assert len(written) == 6
    assert all(p.parent == out for p in written)
    assert not (tmp_path / "etc").exists()


def test_appends_to_existing_log_without_trailing_newline(tmp_path):
    log_path = tmp_path / "log.jsonl"
    log_path.write_text('{"invoice_id": "OLD", "tier": "gentle", "date": "2026-01-01"}')
    path = write_csv(tmp_path, f"G1,Gina,g@x.com,100,,USD,{due(5)},open\n")
    ic.run(path, str(log_path), str(tmp_path / "out"), TODAY, "Jane")
    assert len(ic.load_sent_log(str(log_path))) == 2


def test_corrupt_log_writes_nothing(tmp_path):
    log_path = tmp_path / "log.jsonl"
    log_path.write_text("not json\n")
    path = write_csv(tmp_path, f"G1,Gina,g@x.com,100,,USD,{due(5)},open\n")
    with pytest.raises(ValueError):
        ic.run(path, str(log_path), str(tmp_path / "out"), TODAY, "Jane")
    assert not (tmp_path / "out").exists()


# ------------------------------------------------------------------ CLI

def test_cli(tmp_path):
    out = tmp_path / "out"
    proc = subprocess.run(
        [sys.executable, str(ROOT / "invoice_chaser.py"), "--invoices", full_csv(tmp_path),
         "--log", str(tmp_path / "log.jsonl"), "--out", str(out), "--today", "2026-11-24",
         "--sender", "Jane Doe"],
        capture_output=True, text=True, check=False)
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout) == {"emailed": 3, "escalated": 1, "skipped_rows": 1}
    assert "skipped row 8" in proc.stderr


def test_cli_missing_input_is_clean_error(tmp_path):
    proc = subprocess.run(
        [sys.executable, str(ROOT / "invoice_chaser.py"), "--invoices", str(tmp_path / "nope.csv"),
         "--log", str(tmp_path / "log.jsonl"), "--out", str(tmp_path / "out"), "--sender", "J"],
        capture_output=True, text=True, check=False)
    assert proc.returncode == 2
    assert "error:" in proc.stderr and "Traceback" not in proc.stderr
