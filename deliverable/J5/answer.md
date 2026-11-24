# SQL Window Functions in 45 Minutes

**What this is:** a crash course to take you from basic SQL to answering real analytics questions with window functions. Every query was run on **SQLite 3.25.0** (the first version with window functions) and **PostgreSQL 16.15**, and the output shown is real. Where the two engines differ, it says so.

**Suggested time plan:** sections 1-6 (25 min), sections 7-10 (10 min), practice problems (10 min). Type the queries yourself. That is how it sticks.

---

## 0. The sample table

Every example uses this table. Ten sales, four reps, two regions, three months.

```sql
CREATE TABLE sales (
  id        INTEGER PRIMARY KEY,
  rep       TEXT,
  region    TEXT,
  sale_date TEXT,      -- ISO 'YYYY-MM-DD'
  amount    INTEGER
);
INSERT INTO sales (id, rep, region, sale_date, amount) VALUES
  (1,  'Ana',  'East', '2024-01-05', 100),
  (2,  'Ben',  'East', '2024-01-12', 300),
  (3,  'Ana',  'East', '2024-02-03', 200),
  (4,  'Cara', 'West', '2024-01-08', 300),
  (5,  'Dev',  'West', '2024-01-20', 150),
  (6,  'Cara', 'West', '2024-02-14', 250),
  (7,  'Dev',  'West', '2024-02-25', 300),
  (8,  'Ben',  'East', '2024-03-02', 200),
  (9,  'Cara', 'West', '2024-03-10', 100),
  (10, 'Ana',  'East', '2024-03-18', 400);
```

Useful totals to keep in your head: East = 1200, West = 1100, everything = 2300.

---

## 1. The big idea: GROUP BY collapses rows, window functions keep them

**Plain language:** `GROUP BY` squashes many rows into one row per group. You get the region total, but you lose the individual sales.

A **window function** calculates the same kind of thing (a sum, a count, a rank), but it **keeps every row** and writes the answer in a new column next to each row. The "window" is just the set of related rows each row is allowed to look at.

GROUP BY: one row per region.

```sql
SELECT region, SUM(amount) AS region_total
FROM sales
GROUP BY region
ORDER BY region;
```
```
region | region_total
-------+-------------
East   | 1200
West   | 1100
```

Window function: all 10 rows stay, each one gets its region's total.

```sql
SELECT id, rep, region, amount,
       SUM(amount) OVER (PARTITION BY region) AS region_total
FROM sales
ORDER BY region, id;
```
```
id | rep  | region | amount | region_total
---+------+--------+--------+-------------
1  | Ana  | East   | 100    | 1200
2  | Ben  | East   | 300    | 1200
3  | Ana  | East   | 200    | 1200
8  | Ben  | East   | 200    | 1200
10 | Ana  | East   | 400    | 1200
4  | Cara | West   | 300    | 1100
5  | Dev  | West   | 150    | 1100
6  | Cara | West   | 250    | 1100
7  | Dev  | West   | 300    | 1100
9  | Cara | West   | 100    | 1100
```

**Why this matters:** now you can compare each row with its group (share of total, above or below average, rank within group) in one query, with no self-join.

| | GROUP BY | Window function |
|---|---|---|
| Rows out | One per group | Same as rows in |
| Can show row detail next to group value | No | Yes |
| Keyword | `GROUP BY col` | `OVER (PARTITION BY col)` |
| Can filter on result in same query | `HAVING` | No, wrap in a CTE (section 6) |

---

## 2. Anatomy of `OVER (...)`

Any aggregate (`SUM`, `AVG`, `COUNT`, `MIN`, `MAX`) becomes a window function when you add `OVER (...)`. Inside the parentheses are up to three optional parts:

```sql
function(...) OVER (
  PARTITION BY ...   -- 1. split rows into groups (like GROUP BY, but no collapsing)
  ORDER BY ...       -- 2. order rows inside each group (needed for running totals, ranks, LAG)
  ROWS BETWEEN ...   -- 3. "frame": exactly which rows around the current row to use
)
```

- No `PARTITION BY`: the whole table is one group.
- No `ORDER BY`: every row in the group sees the whole group.
- `ORDER BY` present: the default becomes "from the start of the group up to the current row". That is what makes running totals work (section 4).

**Important:** the `ORDER BY` inside `OVER` does not sort your output. Always add a normal `ORDER BY` at the end of the query.

---

## 3. `OVER ()`: grand totals and percent of total

Empty parentheses mean "the window is the whole result". The classic use is percent of total.

```sql
SELECT id, rep, region, amount,
       SUM(amount) OVER ()                    AS grand_total,
       ROUND(100.0 * amount / SUM(amount) OVER (), 1) AS pct_of_all,
       ROUND(100.0 * amount / SUM(amount) OVER (PARTITION BY region), 1) AS pct_of_region
FROM sales
ORDER BY region, id;
```
```
id | rep  | region | amount | grand_total | pct_of_all | pct_of_region
---+------+--------+--------+-------------+------------+--------------
1  | Ana  | East   | 100    | 2300        | 4.3        | 8.3
2  | Ben  | East   | 300    | 2300        | 13.0       | 25.0
3  | Ana  | East   | 200    | 2300        | 8.7        | 16.7
8  | Ben  | East   | 200    | 2300        | 8.7        | 16.7
10 | Ana  | East   | 400    | 2300        | 17.4       | 33.3
4  | Cara | West   | 300    | 2300        | 13.0       | 27.3
5  | Dev  | West   | 150    | 2300        | 6.5        | 13.6
6  | Cara | West   | 250    | 2300        | 10.9       | 22.7
7  | Dev  | West   | 300    | 2300        | 13.0       | 27.3
9  | Cara | West   | 100    | 2300        | 4.3        | 9.1
```

**Trap:** write `100.0 *`, not `100 *`. Integer divided by integer is integer division in both SQLite and PostgreSQL (`7/2` returns `3`), so `100 * 100 / 2300` would give 4, and `amount / total` alone would give 0.

---

## 4. Running totals: add `ORDER BY`

Adding `ORDER BY` inside `OVER` turns a total into a running total. Add `PARTITION BY` and the running total restarts for each group.

```sql
SELECT id, region, sale_date, amount,
       SUM(amount) OVER (ORDER BY sale_date) AS running_all,
       SUM(amount) OVER (PARTITION BY region ORDER BY sale_date) AS running_region
FROM sales
ORDER BY sale_date;
```
```
id | region | sale_date  | amount | running_all | running_region
---+--------+------------+--------+-------------+---------------
1  | East   | 2024-01-05 | 100    | 100         | 100
4  | West   | 2024-01-08 | 300    | 400         | 300
2  | East   | 2024-01-12 | 300    | 700         | 400
5  | West   | 2024-01-20 | 150    | 850         | 450
3  | East   | 2024-02-03 | 200    | 1050        | 600
6  | West   | 2024-02-14 | 250    | 1300        | 700
7  | West   | 2024-02-25 | 300    | 1600        | 1000
8  | East   | 2024-03-02 | 200    | 1800        | 800
9  | West   | 2024-03-10 | 100    | 1900        | 1100
10 | East   | 2024-03-18 | 400    | 2300        | 1200
```

Read `running_region` down the East rows only: 100, 400, 600, 800, 1200. It ignores West entirely.

### The tie trap (this bites everyone once)

The default frame with `ORDER BY` is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. "RANGE" means rows with the **same** ORDER BY value (ties, called "peers") are all included together. So tied rows get the same running total, and it jumps.

```sql
SELECT id, amount,
       SUM(amount) OVER (ORDER BY amount) AS default_frame,
       SUM(amount) OVER (ORDER BY amount ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS rows_frame,
       SUM(amount) OVER (ORDER BY amount, id) AS with_tiebreaker
FROM sales
ORDER BY amount, id;
```
```
id | amount | default_frame | rows_frame | with_tiebreaker
---+--------+---------------+------------+----------------
1  | 100    | 200           | 100        | 100
9  | 100    | 200           | 200        | 200
5  | 150    | 350           | 350        | 350
3  | 200    | 750           | 550        | 550
8  | 200    | 750           | 750        | 750
6  | 250    | 1000          | 1000       | 1000
2  | 300    | 1900          | 1300       | 1300
4  | 300    | 1900          | 1600       | 1600
7  | 300    | 1900          | 1900       | 1900
10 | 400    | 2300          | 2300       | 2300
```

**Fix:** make the `ORDER BY` unique (add `id` as a tiebreaker) or say `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. The tiebreaker is safer because it also makes the order repeatable.

---

## 5. Ranking: ROW_NUMBER, RANK, DENSE_RANK

All three need `ORDER BY` inside `OVER`. They differ only on ties:

- `ROW_NUMBER()`: 1, 2, 3, 4... always unique. Ties get an arbitrary order.
- `RANK()`: ties share a number, then it **skips** (1, 2, 2, 2, 5).
- `DENSE_RANK()`: ties share a number, **no skip** (1, 2, 2, 2, 3).

```sql
SELECT id, rep, amount,
       ROW_NUMBER() OVER (ORDER BY amount DESC) AS row_num,
       RANK()       OVER (ORDER BY amount DESC) AS rnk,
       DENSE_RANK() OVER (ORDER BY amount DESC) AS dense_rnk
FROM sales
ORDER BY amount DESC, id;
```
SQLite output:
```
id | rep  | amount | row_num | rnk | dense_rnk
---+------+--------+---------+-----+----------
10 | Ana  | 400    | 1       | 1   | 1
2  | Ben  | 300    | 2       | 2   | 2
4  | Cara | 300    | 3       | 2   | 2
7  | Dev  | 300    | 4       | 2   | 2
6  | Cara | 250    | 5       | 5   | 3
3  | Ana  | 200    | 6       | 6   | 4
8  | Ben  | 200    | 7       | 6   | 4
5  | Dev  | 150    | 8       | 8   | 5
1  | Ana  | 100    | 9       | 9   | 6
9  | Cara | 100    | 10      | 9   | 6
```

**Real proof the "arbitrary" warning matters:** PostgreSQL ran the same query and numbered the three 300s as Dev = 2, Ben = 3, Cara = 4 (and the 200s as Ben = 6, Ana = 7). `RANK` and `DENSE_RANK` were identical in both. If you need `ROW_NUMBER` to be repeatable, add a tiebreaker: `ROW_NUMBER() OVER (ORDER BY amount DESC, id)`. With that, both engines return 2, 3, 4 for Ben, Cara, Dev.

**Which one to use:**
- "Pick exactly one row per group" (latest order, top sale): `ROW_NUMBER` with a tiebreaker.
- "Top 3, ties included": `RANK` or `DENSE_RANK`.
- "Second-highest distinct value": `DENSE_RANK() = 2`.

---

## 6. Top N per group, and why you need a CTE

You **cannot** use a window function in `WHERE`. SQL computes windows after `WHERE` has already filtered rows. Both engines reject it:

```sql
SELECT rep, amount FROM sales
WHERE ROW_NUMBER() OVER (PARTITION BY rep ORDER BY amount DESC) = 1;
-- SQLite:     misuse of window function ROW_NUMBER()
-- PostgreSQL: window functions are not allowed in WHERE
```

Using the alias in `WHERE` fails too (PostgreSQL: `column "rn" does not exist`). The pattern is: **compute in a CTE (or subquery), filter outside.**

Top 2 sales per region:

```sql
WITH ranked AS (
  SELECT id, rep, region, sale_date, amount,
         ROW_NUMBER() OVER (PARTITION BY region
                            ORDER BY amount DESC, sale_date) AS rn
  FROM sales
)
SELECT region, rn, rep, sale_date, amount
FROM ranked
WHERE rn <= 2
ORDER BY region, rn;
```
```
region | rn | rep  | sale_date  | amount
-------+----+------+------------+-------
East   | 1  | Ana  | 2024-03-18 | 400
East   | 2  | Ben  | 2024-01-12 | 300
West   | 1  | Cara | 2024-01-08 | 300
West   | 2  | Dev  | 2024-02-25 | 300
```

This one pattern answers a huge share of real questions: "latest record per customer" (`ORDER BY date DESC`, keep `rn = 1`), "dedupe keeping the newest row", "top 5 products per category".

---

## 7. LAG and LEAD: compare with the previous or next row

**Plain language:** `LAG(col)` grabs the value from the previous row in the window, `LEAD(col)` from the next row. Use them for "change since last time".

```sql
SELECT rep, sale_date, amount,
       LAG(amount)  OVER (PARTITION BY rep ORDER BY sale_date) AS prev_amount,
       amount - LAG(amount) OVER (PARTITION BY rep ORDER BY sale_date) AS change,
       LEAD(sale_date) OVER (PARTITION BY rep ORDER BY sale_date) AS next_sale_date
FROM sales
ORDER BY rep, sale_date;
```
```
rep  | sale_date  | amount | prev_amount | change | next_sale_date
-----+------------+--------+-------------+--------+---------------
Ana  | 2024-01-05 | 100    | NULL        | NULL   | 2024-02-03
Ana  | 2024-02-03 | 200    | 100         | 100    | 2024-03-18
Ana  | 2024-03-18 | 400    | 200         | 200    | NULL
Ben  | 2024-01-12 | 300    | NULL        | NULL   | 2024-03-02
Ben  | 2024-03-02 | 200    | 300         | -100   | NULL
Cara | 2024-01-08 | 300    | NULL        | NULL   | 2024-02-14
Cara | 2024-02-14 | 250    | 300         | -50    | 2024-03-10
Cara | 2024-03-10 | 100    | 250         | -150   | NULL
Dev  | 2024-01-20 | 150    | NULL        | NULL   | 2024-02-25
Dev  | 2024-02-25 | 300    | 150         | 150    | NULL
```

The first row of each rep has no previous row, so `LAG` gives `NULL`. Full form: `LAG(col, offset, default)`. `LAG(amount, 2)` looks two rows back. `LAG(amount, 1, 0)` returns 0 instead of NULL:

```sql
SELECT rep, sale_date, amount,
       LAG(amount, 1, 0) OVER (PARTITION BY rep ORDER BY sale_date) AS prev_or_0
FROM sales
WHERE rep = 'Ana'
ORDER BY sale_date;
```
```
rep | sale_date  | amount | prev_or_0
----+------------+--------+----------
Ana | 2024-01-05 | 100    | 0
Ana | 2024-02-03 | 200    | 100
Ana | 2024-03-18 | 400    | 200
```

Note `WHERE rep = 'Ana'` runs **before** the window, so the window only ever sees Ana's rows. That is fine here; just remember filters change what the window sees.

---

## 8. Windows on top of GROUP BY: monthly trend reports

This is the most common real-world use: aggregate first, then compare periods. Do the `GROUP BY` in a CTE, then window over the result.

```sql
WITH monthly AS (
  SELECT substr(sale_date, 1, 7) AS month,
         SUM(amount)             AS total
  FROM sales
  GROUP BY substr(sale_date, 1, 7)
)
SELECT month, total,
       LAG(total) OVER (ORDER BY month)            AS prev_total,
       total - LAG(total) OVER (ORDER BY month)    AS mom_change,
       ROUND(100.0 * (total - LAG(total) OVER (ORDER BY month))
             / LAG(total) OVER (ORDER BY month), 1) AS mom_pct,
       SUM(total) OVER (ORDER BY month)            AS cumulative
FROM monthly
ORDER BY month;
```
```
month   | total | prev_total | mom_change | mom_pct | cumulative
--------+-------+------------+------------+---------+-----------
2024-01 | 850   | NULL       | NULL       | NULL    | 850
2024-02 | 750   | 850        | -100       | -11.8   | 1600
2024-03 | 700   | 750        | -50        | -6.7    | 2300
```

Check: (750 - 850) / 850 = -11.76%, rounds to -11.8. (700 - 750) / 750 = -6.67%, rounds to -6.7.

Shortcut without a CTE: a window can wrap an aggregate directly, because windows run after `GROUP BY`. It reads oddly but works in both engines:

```sql
SELECT region,
       SUM(amount) AS region_total,
       SUM(SUM(amount)) OVER () AS grand_total
FROM sales
GROUP BY region
ORDER BY region;
```
```
region | region_total | grand_total
-------+--------------+------------
East   | 1200         | 2300
West   | 1100         | 2300
```

Inner `SUM` = per-group total. Outer `SUM ... OVER ()` = sum of those group totals.

---

## 9. Frames: moving averages

A frame says exactly which rows, relative to the current one, go into the calculation. `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW` = "this row and the two before it", i.e. a 3-row moving average.

```sql
SELECT id, sale_date, amount,
       ROUND(AVG(amount) OVER (ORDER BY sale_date
                               ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 1) AS moving_avg_3
FROM sales
ORDER BY sale_date;
```
```
id | sale_date  | amount | moving_avg_3
---+------------+--------+-------------
1  | 2024-01-05 | 100    | 100.0
4  | 2024-01-08 | 300    | 200.0
2  | 2024-01-12 | 300    | 233.3
5  | 2024-01-20 | 150    | 250.0
3  | 2024-02-03 | 200    | 216.7
6  | 2024-02-14 | 250    | 200.0
7  | 2024-02-25 | 300    | 250.0
8  | 2024-03-02 | 200    | 250.0
9  | 2024-03-10 | 100    | 200.0
10 | 2024-03-18 | 400    | 233.3
```

The first two rows average fewer than 3 values (there aren't 3 yet). Row 3: (100 + 300 + 300) / 3 = 233.3.

Frame vocabulary:
- `UNBOUNDED PRECEDING` = start of the partition
- `n PRECEDING` / `n FOLLOWING` = n rows before/after
- `CURRENT ROW`
- `UNBOUNDED FOLLOWING` = end of the partition

Note that "3 rows" is not the same as "3 months" or "7 days". If dates have gaps or duplicates, aggregate to one row per period first (section 8), then use `ROWS`.

### The LAST_VALUE trap

`FIRST_VALUE` works as you'd expect. `LAST_VALUE` with only `ORDER BY` returns the **current** row, because the default frame stops at the current row. Extend the frame to the end:

```sql
SELECT rep, sale_date, amount,
       FIRST_VALUE(amount) OVER (PARTITION BY rep ORDER BY sale_date) AS first_amt,
       LAST_VALUE(amount)  OVER (PARTITION BY rep ORDER BY sale_date) AS last_wrong,
       LAST_VALUE(amount)  OVER (PARTITION BY rep ORDER BY sale_date
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_right
FROM sales
ORDER BY rep, sale_date;
```
```
rep  | sale_date  | amount | first_amt | last_wrong | last_right
-----+------------+--------+-----------+------------+-----------
Ana  | 2024-01-05 | 100    | 100       | 100        | 400
Ana  | 2024-02-03 | 200    | 100       | 200        | 400
Ana  | 2024-03-18 | 400    | 100       | 400        | 400
Ben  | 2024-01-12 | 300    | 300       | 300        | 200
Ben  | 2024-03-02 | 200    | 300       | 200        | 200
Cara | 2024-01-08 | 300    | 300       | 300        | 100
Cara | 2024-02-14 | 250    | 300       | 250        | 100
Cara | 2024-03-10 | 100    | 300       | 100        | 100
Dev  | 2024-01-20 | 150    | 150       | 150        | 300
Dev  | 2024-02-25 | 300    | 150       | 300        | 300
```

Easier alternative: `FIRST_VALUE(amount) OVER (PARTITION BY rep ORDER BY sale_date DESC)` gives the last value with no frame needed.

---

## 10. Handy extras

Group-level facts on every row, plus "which number sale is this":

```sql
SELECT rep, sale_date, amount,
       COUNT(*)    OVER (PARTITION BY rep) AS rep_sales,
       ROW_NUMBER() OVER (PARTITION BY rep ORDER BY sale_date) AS sale_no,
       MAX(amount) OVER (PARTITION BY rep) AS rep_best
FROM sales
ORDER BY rep, sale_date;
```
```
rep  | sale_date  | amount | rep_sales | sale_no | rep_best
-----+------------+--------+-----------+---------+---------
Ana  | 2024-01-05 | 100    | 3         | 1       | 400
Ana  | 2024-02-03 | 200    | 3         | 2       | 400
Ana  | 2024-03-18 | 400    | 3         | 3       | 400
Ben  | 2024-01-12 | 300    | 2         | 1       | 300
Ben  | 2024-03-02 | 200    | 2         | 2       | 300
Cara | 2024-01-08 | 300    | 3         | 1       | 300
Cara | 2024-02-14 | 250    | 3         | 2       | 300
Cara | 2024-03-10 | 100    | 3         | 3       | 300
Dev  | 2024-01-20 | 150    | 2         | 1       | 300
Dev  | 2024-02-25 | 300    | 2         | 2       | 300
```

`NTILE(n)` splits ordered rows into n roughly equal buckets (quartiles, deciles). With 10 rows and 4 buckets, the first two buckets get 3 rows and the last two get 2:

```sql
SELECT id, amount,
       NTILE(4) OVER (ORDER BY amount DESC, id) AS quartile
FROM sales
ORDER BY amount DESC, id;
```
```
id | amount | quartile
---+--------+---------
10 | 400    | 1
2  | 300    | 1
4  | 300    | 1
7  | 300    | 2
6  | 250    | 2
3  | 200    | 2
8  | 200    | 3
5  | 150    | 3
1  | 100    | 4
9  | 100    | 4
```

Notice NTILE splits tied amounts (id 4 and 7, both 300) across buckets. It counts rows, it doesn't respect ties.

Named windows save retyping when several columns use the same window:

```sql
SELECT rep, sale_date, amount,
       SUM(amount) OVER w AS running,
       COUNT(*)    OVER w AS n_so_far
FROM sales
WINDOW w AS (PARTITION BY rep ORDER BY sale_date)
ORDER BY rep, sale_date;
```
```
rep  | sale_date  | amount | running | n_so_far
-----+------------+--------+---------+---------
Ana  | 2024-01-05 | 100    | 100     | 1
Ana  | 2024-02-03 | 200    | 300     | 2
Ana  | 2024-03-18 | 400    | 700     | 3
Ben  | 2024-01-12 | 300    | 300     | 1
Ben  | 2024-03-02 | 200    | 500     | 2
Cara | 2024-01-08 | 300    | 300     | 1
Cara | 2024-02-14 | 250    | 550     | 2
Cara | 2024-03-10 | 100    | 650     | 3
Dev  | 2024-01-20 | 150    | 150     | 1
Dev  | 2024-02-25 | 300    | 450     | 2
```

---

## 11. The order SQL runs things (explains every "why can't I")

```
1. FROM / JOIN
2. WHERE          <- filters raw rows; windows don't exist yet
3. GROUP BY
4. HAVING
5. WINDOW FUNCTIONS  <- computed here, on whatever rows survived 1-4
6. SELECT list / DISTINCT
7. ORDER BY
8. LIMIT
```

Consequences:
- Can't filter on a window result in `WHERE` or `HAVING`. Use a CTE.
- `WHERE` shrinks what the window sees. To rank among all reps but show only Ana, rank in a CTE first, then filter outside.
- Windows can use aggregates (`SUM(SUM(x)) OVER ...`, `RANK() OVER (ORDER BY SUM(x) DESC)`) because GROUP BY already ran.
- `LIMIT` runs last, so it doesn't change window results.

---

## 12. SQLite vs PostgreSQL: differences that matter

Everything above ran with matching results in both, except the deliberate `ROW_NUMBER` tie example. Watch for these:

| Topic | SQLite (3.25+) | PostgreSQL |
|---|---|---|
| `RANGE` with numeric offsets, e.g. `RANGE BETWEEN 100 PRECEDING AND CURRENT ROW` | **Error in 3.25** ("RANGE must use only UNBOUNDED or CURRENT ROW"). Added in 3.28. | Works (tested on PG 16). Use `ROWS` to stay portable. |
| `ROUND(x, 1)` | Works on any number | Works on `numeric` only. `ROUND(double, 1)` errors: "function round(double precision, integer) does not exist". Fix: `ROUND(x::numeric, 1)`. `AVG` of an integer column already returns numeric, so it's fine. |
| Decimal display | `AVG` shows `240.0` | `AVG` shows `240.0000000000000000`. Round for reports. |
| Month from a date | `substr(sale_date, 1, 7)` or `strftime('%Y-%m', sale_date)` | On a real `DATE` column: `to_char(sale_date, 'YYYY-MM')` or `date_trunc('month', sale_date)`. (`substr` only worked here because the column is TEXT.) |
| Days between dates | `julianday(d2) - julianday(d1)` returns `29.0` | `d2::date - d1::date` returns `29` |
| Ties in `ROW_NUMBER` | Arbitrary | Arbitrary, and different from SQLite in our test |

Days since the rep's previous sale, both versions (tested, both give NULL, 29, 44 for Ana):

```sql
-- SQLite
julianday(sale_date) - julianday(LAG(sale_date) OVER (PARTITION BY rep ORDER BY sale_date)) AS days_since_prev
-- PostgreSQL
sale_date::date - LAG(sale_date::date) OVER (PARTITION BY rep ORDER BY sale_date) AS days_since_prev
```

---

## 13. How to attack an unseen question (use this on the test)

Ask four questions, in order:

1. **Do I need to keep the individual rows?** No: plain `GROUP BY`. Yes: window function.
2. **What's the group?** That's `PARTITION BY` (per rep, per region, per customer). Whole table: leave it out.
3. **Does order matter?** Running total, rank, previous/next, first/last, moving average: yes, add `ORDER BY` with a tiebreaker.
4. **Do I need to filter on the result?** (top N, rn = 1, above average) Wrap it in a CTE and filter outside.

Bonus: if the question is about periods (months, weeks), `GROUP BY` the period in a CTE first, then window over it.

### Cheat sheet

| Question sounds like | Use |
|---|---|
| "% of total", "share of region" | `x / SUM(x) OVER (PARTITION BY ...)` with `100.0 *` |
| "running / cumulative total" | `SUM(x) OVER (PARTITION BY ... ORDER BY date, id)` |
| "rank", "top N per group" | `ROW_NUMBER` / `RANK` / `DENSE_RANK` in a CTE, filter outside |
| "latest / first record per X" | `ROW_NUMBER() OVER (PARTITION BY X ORDER BY date DESC)`, keep 1 |
| "change vs previous", "MoM", "growth" | `x - LAG(x) OVER (ORDER BY period)` |
| "moving / rolling average" | `AVG(x) OVER (ORDER BY ... ROWS BETWEEN n-1 PRECEDING AND CURRENT ROW)` |
| "compare to group average" | `AVG(x) OVER (PARTITION BY ...)` in CTE, then `WHERE` |
| "quartile / decile / bucket" | `NTILE(4)` / `NTILE(10)` |
| "rank groups by their total" | `RANK() OVER (ORDER BY SUM(x) DESC)` with `GROUP BY` |

---

## 14. Practice problems

Try each before looking at the answer. All use the `sales` table.

1. For every sale, show the rep's total sales and what percent of that total this sale is (1 decimal).
2. For each region, find the sale(s) with the **second-highest distinct amount**.
3. Show each rep's **most recent** sale only (one row per rep).
4. Show only sales that are **above their region's average**, with the average and how far above it they are.
5. Show monthly totals **per region** and each region's change from its previous month.
6. Total sales per rep, ranked highest to lowest, in **one query without a CTE**.
7. Fix this broken query (goal: each rep's single biggest sale, earliest date wins ties):
   ```sql
   SELECT rep, sale_date, amount,
          ROW_NUMBER() OVER (PARTITION BY rep ORDER BY amount DESC) AS rn
   FROM sales
   WHERE rn = 1;
   ```

---

## 15. Answers

**1.**
```sql
SELECT id, rep, amount,
       SUM(amount) OVER (PARTITION BY rep) AS rep_total,
       ROUND(100.0 * amount / SUM(amount) OVER (PARTITION BY rep), 1) AS pct_of_rep
FROM sales
ORDER BY rep, id;
```
```
id | rep  | amount | rep_total | pct_of_rep
---+------+--------+-----------+-----------
1  | Ana  | 100    | 700       | 14.3
3  | Ana  | 200    | 700       | 28.6
10 | Ana  | 400    | 700       | 57.1
2  | Ben  | 300    | 500       | 60.0
8  | Ben  | 200    | 500       | 40.0
4  | Cara | 300    | 650       | 46.2
6  | Cara | 250    | 650       | 38.5
9  | Cara | 100    | 650       | 15.4
5  | Dev  | 150    | 450       | 33.3
7  | Dev  | 300    | 450       | 66.7
```

**2.** `DENSE_RANK`, because West has two 300s. With `RANK` the West 250 would be rank 3 and you'd get no rank-2 row; with `ROW_NUMBER` you'd wrongly pick a 300.
```sql
WITH r AS (
  SELECT region, rep, amount,
         DENSE_RANK() OVER (PARTITION BY region ORDER BY amount DESC) AS dr
  FROM sales
)
SELECT region, rep, amount
FROM r
WHERE dr = 2
ORDER BY region, rep;
```
```
region | rep  | amount
-------+------+-------
East   | Ben  | 300
West   | Cara | 250
```

**3.**
```sql
WITH r AS (
  SELECT rep, sale_date, amount,
         ROW_NUMBER() OVER (PARTITION BY rep ORDER BY sale_date DESC) AS rn
  FROM sales
)
SELECT rep, sale_date, amount
FROM r
WHERE rn = 1
ORDER BY rep;
```
```
rep  | sale_date  | amount
-----+------------+-------
Ana  | 2024-03-18 | 400
Ben  | 2024-03-02 | 200
Cara | 2024-03-10 | 100
Dev  | 2024-02-25 | 300
```

**4.** East average = 1200 / 5 = 240. West average = 1100 / 5 = 220.
```sql
WITH s AS (
  SELECT id, rep, region, amount,
         AVG(amount) OVER (PARTITION BY region) AS region_avg
  FROM sales
)
SELECT id, rep, region, amount,
       ROUND(region_avg, 1)          AS region_avg,
       ROUND(amount - region_avg, 1) AS above_by
FROM s
WHERE amount > region_avg
ORDER BY region, id;
```
```
id | rep  | region | amount | region_avg | above_by
---+------+--------+--------+------------+---------
2  | Ben  | East   | 300    | 240.0      | 60.0
10 | Ana  | East   | 400    | 240.0      | 160.0
4  | Cara | West   | 300    | 220.0      | 80.0
6  | Cara | West   | 250    | 220.0      | 30.0
7  | Dev  | West   | 300    | 220.0      | 80.0
```

**5.** Group by region and month, then `PARTITION BY region` so East never compares to West.
```sql
WITH m AS (
  SELECT region, substr(sale_date, 1, 7) AS month, SUM(amount) AS total
  FROM sales
  GROUP BY region, substr(sale_date, 1, 7)
)
SELECT region, month, total,
       total - LAG(total) OVER (PARTITION BY region ORDER BY month) AS mom_change
FROM m
ORDER BY region, month;
```
```
region | month   | total | mom_change
-------+---------+-------+-----------
East   | 2024-01 | 400   | NULL
East   | 2024-02 | 200   | -200
East   | 2024-03 | 600   | 400
West   | 2024-01 | 450   | NULL
West   | 2024-02 | 550   | 100
West   | 2024-03 | 100   | -450
```

**6.** Windows run after `GROUP BY`, so you can rank on an aggregate directly.
```sql
SELECT rep,
       SUM(amount) AS rep_total,
       RANK() OVER (ORDER BY SUM(amount) DESC) AS rnk
FROM sales
GROUP BY rep
ORDER BY rnk;
```
```
rep  | rep_total | rnk
-----+-----------+----
Ana  | 700       | 1
Cara | 650       | 2
Ben  | 500       | 3
Dev  | 450       | 4
```

**7.** Two bugs: `WHERE` runs before the window (and before the alias exists), and there's no tiebreaker. Move the window into a subquery and add `sale_date` to the window's `ORDER BY`.
```sql
SELECT rep, sale_date, amount, rn
FROM (
  SELECT rep, sale_date, amount,
         ROW_NUMBER() OVER (PARTITION BY rep ORDER BY amount DESC, sale_date) AS rn
  FROM sales
) t
WHERE rn = 1
ORDER BY rep;
```
```
rep  | sale_date  | amount | rn
-----+------------+--------+---
Ana  | 2024-03-18 | 400    | 1
Ben  | 2024-01-12 | 300    | 1
Cara | 2024-01-08 | 300    | 1
Dev  | 2024-02-25 | 300    | 1
```

---

## How this was checked

- Every query and output above was run on the official SQLite 3.25.0 source build and on PostgreSQL 16.15. All outputs matched after normalizing number formatting (e.g. `240.0` vs `240.0000000000000000`), except the `ROW_NUMBER` tie example, which is shown as a deliberate difference. The two error messages in section 6 and the SQLite `RANGE` error in section 12 are real engine output.
- Default frame ("RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW", ties as "peers") is from the SQLite docs: https://www.sqlite.org/windowfunctions.html (accessed 2026-11-24). PostgreSQL reference: https://www.postgresql.org/docs/current/tutorial-window.html and https://www.postgresql.org/docs/current/functions-window.html (not opened this session; behavior confirmed by running it).
- "RANGE offsets added in SQLite 3.28" comes from the SQLite release notes (https://www.sqlite.org/changes.html) via a summary I couldn't check word for word. The 3.25 error itself was confirmed by running it.
