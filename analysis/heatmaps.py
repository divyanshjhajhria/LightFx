"""Slide figures from the survival map sweep.

Reads public/sweep.json and writes docs/figures/{calm,panic,imbalance}.png and docs/figures/summary.md.
matplotlib and the standard library only. The figures use the app's own scales and colours, and the summary
is computed the same way as src/ui/sweepSummary.ts (storm cells only; served weighted by runs).

    python3 analysis/heatmaps.py            # write the figures
    python3 analysis/heatmaps.py --json     # print the summary as JSON (to check against the app)
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SWEEP = ROOT / "public" / "sweep.json"
OUT = ROOT / "docs" / "figures"

MARKETS = ["calm", "panic", "imbalance"]
MARKET_NAME = {"calm": "Calm market", "panic": "Panic", "imbalance": "One-way customers"}
BANKS = ["leased", "naive", "central"]
BANK_NAME = {"leased": "Our bank", "naive": "The bank that trusts old news", "central": "The bank that asks Earth"}
SEPARATIONS = [0, 30, 60, 90, 120, 150]
STORM_MINUTES = [0, 30, 60, 90, 120, 180, 240, 360]

# The app's tokens (src/ui/theme.ts and styles.css).
INK = (10 / 255, 11 / 255, 13 / 255)
WARM = (243 / 255, 239 / 255, 230 / 255)
ALERT = (232 / 255, 105 / 255, 93 / 255)


def storm_label(m):
    if m == 0:
        return "No storm"
    if m < 60:
        return f"{m} min"
    h = round(m / 60, 1)
    return f"{int(h) if h == int(h) else h} h"


def figures(cells):
    runs = sum(c["runs"] for c in cells)

    def weighted(f):
        return sum(f(c) * c["runs"] for c in cells) / runs if runs else 0

    banks = {}
    for b in BANKS:
        breached = sum(c["banks"][b]["breachedRuns"] for c in cells)
        banks[b] = {
            "breachedRuns": breached,
            "breachedPct": 100 * breached / runs if runs else 0,
            "worstPeak": round(max([0] + [c["banks"][b]["peakOverLimitMax"] for c in cells]), 1),
            "servedPct": weighted(lambda c, b=b: c["banks"][b]["servedPctMean"]),
        }
    return {
        "runs": runs,
        "ticksMillions": round(sum(c["ticks"] for c in cells) / 1e6, 1),
        "banks": banks,
        "marsServedInStorm": {
            "leased": weighted(lambda c: c["banks"]["leased"]["marsServedInStormMean"]),
            "central": weighted(lambda c: c["banks"]["central"]["marsServedInStormMean"]),
        },
    }


def summarise(data):
    storms = [c for c in data["cells"] if c["stormMinutes"] > 0]
    return {
        "seedsPerCell": data["seedsPerCell"],
        "overall": figures(storms),
        "byMarket": {m: figures([c for c in storms if c["market"] == m]) for m in MARKETS},
    }


def heatmap(ax, cells, bank, measure, max_minutes):
    from matplotlib.patches import FancyBboxPatch

    at = {(c["separationDeg"], c["stormMinutes"]): c for c in cells}
    rows = sorted(SEPARATIONS, reverse=True)  # farthest at the top, closest at the bottom
    gap = 0.06
    for i, sep in enumerate(rows):
        y = len(rows) - 1 - i
        for j, m in enumerate(STORM_MINUTES):
            r = at[(sep, m)]["banks"][bank]
            if measure == "minutes":
                v = r["minutesOverMean"]
                text = "<1" if 0 < v < 0.5 else str(round(v))
                if v > 0:
                    face, edge = (*ALERT, 0.85 * v / max(max_minutes, 1e-9)), "none"
                else:
                    face, edge = (0, 0, 0, 0), (*WARM, 0.22)
                colour = WARM if v > 0 else (*WARM, 0.6)
            else:
                op = 0.05 + 0.55 * r["servedPctMean"] / 100
                face, edge = (*WARM, op), "none"
                text = f"{round(r['servedPctMean'])}%"
                colour = INK if op >= 0.45 else WARM
            ax.add_patch(
                FancyBboxPatch(
                    (j + gap, y + gap),
                    1 - 2 * gap,
                    1 - 2 * gap,
                    boxstyle="round,pad=0,rounding_size=0.12",
                    facecolor=face,
                    edgecolor=edge,
                    linewidth=0.8,
                )
            )
            ax.text(j + 0.5, y + 0.5, text, ha="center", va="center", fontsize=9, color=colour)
    ax.set_xlim(0, len(STORM_MINUTES))
    ax.set_ylim(0, len(rows))
    ax.set_xticks([j + 0.5 for j in range(len(STORM_MINUTES))], [storm_label(m) for m in STORM_MINUTES])
    ax.set_yticks(
        [len(rows) - 1 - i + 0.5 for i in range(len(rows))],
        [f"{round(at[(sep, 0)]['delayMin'])} min" for sep in rows],
    )
    ax.xaxis.tick_top()
    ax.tick_params(length=0, colors=(*WARM, 0.6), labelsize=8.5)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_aspect("auto")


def draw(data, summary, market, path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    cells = [c for c in data["cells"] if c["market"] == market]
    max_minutes = max([0] + [c["banks"][b]["minutesOverMean"] for c in cells for b in BANKS])
    f = summary["byMarket"][market]

    fig, axes = plt.subplots(3, 2, figsize=(16, 9), dpi=150)
    fig.patch.set_facecolor(INK)
    fig.subplots_adjust(left=0.07, right=0.98, top=0.83, bottom=0.03, hspace=0.42, wspace=0.08)
    ours, old = f["banks"]["leased"], f["banks"]["naive"]
    first = (
        f"our bank was never over its limit"
        if ours["breachedRuns"] == 0
        else f"our bank was over its limit in {ours['breachedRuns']:,} of them ({round(ours['breachedPct'])}%)"
    )
    fig.text(
        0.07,
        0.95,
        f"{MARKET_NAME[market]}: across {f['runs']:,} simulated storms, {first}.",
        color=ALERT if ours["breachedRuns"] else WARM,
        fontsize=17,
        fontweight="medium",
    )
    fig.text(
        0.07,
        0.915,
        f"The bank that trusts old news was over in {round(old['breachedPct'])}% of them. "
        f"{data['seedsPerCell']} storms with different customers in each square. "
        "Storm length across, how far Mars is (light-minutes) up the side.",
        color=(*WARM, 0.6),
        fontsize=10.5,
    )
    for i, b in enumerate(BANKS):
        for k, measure in enumerate(["minutes", "served"]):
            ax = axes[i][k]
            ax.set_facecolor(INK)
            heatmap(ax, cells, b, measure, max_minutes)
            label = "Minutes over the limit" if measure == "minutes" else "Customers served"
            ax.set_title(f"{BANK_NAME[b]}: {label.lower()}", loc="left", color=WARM, fontsize=11, pad=18)
    fig.savefig(path, facecolor=INK)
    plt.close(fig)


def table(summary):
    lines = [
        "| Market | Storms | Bank | Over its limit | Worst peak (x limit) | Customers served |",
        "|---|---:|---|---:|---:|---:|",
    ]
    for key, f in [("All markets", summary["overall"])] + [(MARKET_NAME[m], summary["byMarket"][m]) for m in MARKETS]:
        for b in BANKS:
            x = f["banks"][b]
            lines.append(
                f"| {key} | {f['runs']:,} | {BANK_NAME[b]} | {x['breachedRuns']:,} ({x['breachedPct']:.1f}%) "
                f"| {x['worstPeak']:.1f} | {x['servedPct']:.1f}% |"
            )
    return "\n".join(lines)


def main():
    data = json.loads(SWEEP.read_text())
    summary = summarise(data)
    if "--json" in sys.argv:
        print(json.dumps(summary, sort_keys=True))
        return
    OUT.mkdir(parents=True, exist_ok=True)
    for m in MARKETS:
        draw(data, summary, m, OUT / f"{m}.png")
    o = summary["overall"]
    md = [
        "# Survival map: summary",
        "",
        "Generated by `python3 analysis/heatmaps.py` from `public/sweep.json`. Do not edit by hand.",
        "",
        f"{data['totalRuns']:,} runs in all: {len(data['cells'])} squares x {data['seedsPerCell']} seeds. "
        f"The figures below count only the squares with a storm ({o['runs']:,} storms, "
        f"{o['ticksMillions']} million simulation steps); the no-storm column is the baseline.",
        "",
        table(summary),
        "",
        "Customers the Mars desk served during the storm, on average per storm: "
        f"our bank {o['marsServedInStorm']['leased']:.1f}, the bank that asks Earth "
        f"{o['marsServedInStorm']['central']:.1f}.",
        "",
        "Figures: [calm.png](calm.png), [panic.png](panic.png), [imbalance.png](imbalance.png).",
        "",
    ]
    (OUT / "summary.md").write_text("\n".join(md))
    print(f"wrote {', '.join(m + '.png' for m in MARKETS)} and summary.md to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
