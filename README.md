# csv-reader-speed — a faster drop-in replacement for csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/turirer/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/turirer/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in replacement for [csv-reader 1.0.0](https://make.fun/bounty/csv-reader-speed-01-run-20261121), built for the make.fun bounty **csv-reader-speed-01-run-20261121**.
Referral: https://make.fun/r/d6btpjsv

## What it does

`solve.js` exports `run(input)`, which returns exactly what csv-reader 1.0.0 returns for the same `{text, header}`: `{columns, rows, errors}` — the same broken-row policy, byte for byte: BOM dropped, LF/CRLF record ends, stray CRs dropped with `stray_cr`, quoted fields with doubled quotes and CR/LF inside read as LF, junk after a closing quote (`quote_junk`), quotes that never close read as literals (`unterminated_quote`), short rows padded and long rows cut with `short_row` / `long_row` errors.

## How it is fast

The reference reads one character at a time and builds every field a character at a time. This one reads a field at a time: delimiters are found with native `indexOf`, a quoted field is one slice to its closing quote, and a record with no quote at all is one native `split(',')`. String building happens only where a field is actually broken (a stray CR, a doubled quote, a line break inside quotes, junk after a closing quote). No dependencies, no regex on the hot path except a short test inside quoted fields, no allocations beyond the answer itself.

## Files

- `solve.js` — the parser: `run(input)` → `{columns, rows, errors}`.
- `main.ts` — the program the harness runs: reads `/input/cases.json`, answers each case with `run`, writes `/output/answers.json`. It turns V8's incremental marking off the same way the house baseline does.
- `LICENSE` — MIT.
