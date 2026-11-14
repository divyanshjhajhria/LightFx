#!/usr/bin/env python3
"""Turn a price CSV into public/earth.json: one mid price per minute, for the app to replay.

Examples:
    python3 scripts/convert_sgx.py prices.csv --time-col timestamp --bid-col bid --ask-col ask
    python3 scripts/convert_sgx.py prices.csv --time-col time --mid-col price --start 2000 --minutes 600

Timestamps may be ISO 8601 text or epoch seconds/milliseconds. Uses only the standard library.
"""
import argparse
import csv
import json
from datetime import datetime, timezone


def to_epoch_seconds(raw: str) -> float:
    raw = raw.strip()
    try:
        value = float(raw)
        return value / 1000 if value > 1e11 else value
    except ValueError:
        stamp = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        return stamp.timestamp()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv_path")
    ap.add_argument("--time-col", required=True)
    ap.add_argument("--mid-col")
    ap.add_argument("--bid-col")
    ap.add_argument("--ask-col")
    ap.add_argument("--start", type=int, default=0, help="minutes to skip from the first row")
    ap.add_argument("--minutes", type=int, default=1440, help="how many minutes to keep")
    ap.add_argument("--out", default="public/earth.json")
    args = ap.parse_args()
    if not args.mid_col and not (args.bid_col and args.ask_col):
        ap.error("give --mid-col, or both --bid-col and --ask-col")

    last_in_minute: dict[int, float] = {}
    with open(args.csv_path, newline="") as f:
        for row in csv.DictReader(f):
            try:
                minute = int(to_epoch_seconds(row[args.time_col]) // 60)
                if args.mid_col:
                    mid = float(row[args.mid_col])
                else:
                    mid = (float(row[args.bid_col]) + float(row[args.ask_col])) / 2
            except (ValueError, KeyError):
                continue
            if mid > 0:
                last_in_minute[minute] = mid
    if not last_in_minute:
        raise SystemExit("No usable rows. Check the column names.")

    first, last = min(last_in_minute), max(last_in_minute)
    mids, current = [], last_in_minute[first]
    for minute in range(first, last + 1):  # carry the last price forward across gaps
        current = last_in_minute.get(minute, current)
        mids.append(round(current, 6))
    mids = mids[args.start : args.start + args.minutes]
    if len(mids) < 2:
        raise SystemExit("Fewer than two minutes left after --start/--minutes.")

    with open(args.out, "w") as f:
        json.dump(mids, f)
    print(f"Wrote {len(mids)} minutes to {args.out} (first {mids[0]}, last {mids[-1]})")


if __name__ == "__main__":
    main()
