"""Figures for the fresh v0.7.1-vs-v0.8.0-candidate comparison on the 37-case corpus.

The main report charts live in plot-workflows.py. These figures support the full
analysis, including new dependency cases and repeated clean-control scores.
"""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter, MaxNLocator

here = Path(__file__).resolve().parent
data = json.loads((here / 'workflow-summary-v072-full.json').read_text(encoding='utf-8'))
rows = data['arms']
groups = data['groups']
out = here / 'charts'
out.mkdir(exist_ok=True)
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11,
                     'axes.spines.top': False, 'axes.spines.right': False,
                     'axes.spines.left': False, 'axes.edgecolor': '#d5dae0',
                     'text.color': '#172b3a', 'axes.labelcolor': '#172b3a',
                     'xtick.color': '#526473', 'ytick.color': '#172b3a',
                     'svg.fonttype': 'none', 'savefig.facecolor': 'white'})
labels = ['Direct reading', 'v0.7.1 (released)', 'v0.8.0 candidate']
colors = ['#8593a3', '#bd8745', '#178974']
ARMS = ['read', 'previous', 'current']


def finish(fig, name, note):
    fig.text(.06, .025, note, fontsize=9, color='#526473')
    fig.savefig(out / (name + '.svg'), bbox_inches='tight')
    svg = out / (name + '.svg')
    svg.write_text('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines()) + '\n', encoding='utf-8')
    plt.close(fig)


def detection_figure(series, name, title, note):
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.2), gridspec_kw={'width_ratios': [1.5, 1]})
    fig.subplots_adjust(left=.16, right=.94, bottom=.23, top=.76, wspace=.62)
    fig.suptitle(title, x=.06, y=.96, ha='left', fontsize=21, weight='bold')
    for ax, key, denom, sub in [(axes[0], 'detected', 'bugs', 'Planted defects identified · higher is better'),
                                (axes[1], 'falseAlarms', 'controls', 'False alarms · lower is better')]:
        vals = [r[key] for r in series]
        ax.barh(labels, vals, color=colors, height=.53)
        ax.invert_yaxis()
        limit = max(series[0][denom], 1) if key == 'detected' else max(3, max(vals) + 1)
        ax.set_xlim(0, limit * 1.2)
        ax.set_title(sub, fontsize=10, loc='left', pad=18)
        ax.xaxis.set_major_locator(MaxNLocator(integer=True, nbins=4))
        ax.grid(axis='x', color='#e8ecef')
        ax.set_axisbelow(True)
        ax.tick_params(axis='y', length=0)
        for y, r in enumerate(series):
            ax.text(r[key] + limit * .025, y, f"{r[key]}/{r[denom]}", va='center', weight='bold')
    alternatives = ', '.join(f"{lab}: {row.get('otherVerified', 0)}" for lab, row in zip(labels, series))
    finish(fig, name, note + '\nOther verified findings, counted separately: ' + alternatives + '.')


detection_figure(rows, 'detection-v072-full', 'What did each build find?',
                 'Sonnet · all 37 cases · 3 trials each, every session run fresh. Repeated trials are not independent bugs.')

detection_figure([groups['added'][a] for a in ARMS], 'newcases-v072-full',
                 'The 9 new dependency cases',
                 'Wildcard barrels, forwarded re-exports, late-bound members, constructed readings · 3 trials each.\n'
                 'These are the cases where the two builds can differ: the original 28 produce identical tool prompts.')

fig, ax = plt.subplots(figsize=(10, 4.5))
fig.subplots_adjust(left=.23, right=.94, bottom=.28, top=.76)
fig.suptitle('Tokens used by each complete workflow', x=.06, y=.96, ha='left', fontsize=19, weight='bold')
caller = [r['caller']['total'] for r in rows]
internal = [r['internal']['total'] for r in rows]
ax.barh(labels, caller, color='#617b9a', height=.53, label='Caller agent')
ax.barh(labels, internal, left=caller, color='#178974', height=.53, label='Inside the tool')
ax.invert_yaxis()
ax.set_title('Reported tokens including cache reads and writes', fontsize=10, loc='left', pad=18)
total = [a + b for a, b in zip(caller, internal)]
maximum = max(total)
ax.set_xlim(0, maximum * 1.23)
ax.grid(axis='x', color='#e8ecef')
ax.set_axisbelow(True)
ax.tick_params(axis='y', length=0)
ax.xaxis.set_major_locator(MaxNLocator(nbins=4))
ax.xaxis.set_major_formatter(FuncFormatter(lambda v, p: f'{v/1000:.0f}k'))
for y, v in enumerate(total):
    ax.text(v + maximum * .025, y, f'{v/1000:,.1f}k', va='center', weight='bold')
ax.legend(loc='upper left', bbox_to_anchor=(0, -.16), ncol=2, frameon=False, fontsize=9)
finish(fig, 'usage-v072-full', 'Totals across 3 sessions per workflow. Includes fresh input, output, cache writes and cache reads.')

# Per-trial dots rather than bars: with three trials per source, a mean would hide exactly
# the run-to-run swing this figure exists to show.
fp = data['falsePositives']
files = list(fp['files'].items())
if files:
    sources = fp['sources']
    palette = ['#8593a3', '#c9a46b', '#bd8745', '#178974']
    height = 1.8 + 1.7 * len(files)
    fig, axes = plt.subplots(len(files), 1, figsize=(11.5, height), squeeze=False)
    # Fixed inches at the bottom for tick labels, the x label and finish()'s two-line note.
    fig.subplots_adjust(left=.27, right=.95, top=1 - .9 / height, bottom=1.25 / height, hspace=.9)
    fig.suptitle('Same prompt, different answer', x=.06, y=.995, ha='left', fontsize=19, weight='bold')
    for ax, (file, series) in zip(axes[:, 0], files):
        for y, (source, color) in enumerate(zip(sources, palette)):
            scores = [s for s in series.get(source['key'], []) if s is not None]
            ax.scatter(scores, [y] * len(scores), s=70, color=color, zorder=3, edgecolor='white', linewidth=.8)
        ax.axvline(fp['actionable'], color='#b3261e', linestyle='--', linewidth=1.2)
        ax.text(fp['actionable'] + .01, len(sources) - .45, 'actionable', color='#b3261e', fontsize=9)
        ax.set_yticks(range(len(sources)))
        ax.set_yticklabels([s['label'] for s in sources], fontsize=10)
        ax.set_ylim(len(sources) - .4, -.6)
        ax.set_xlim(0, 1)
        ax.set_title(file.split('/')[-1] + ' · clean control', fontsize=10, loc='left', pad=8)
        ax.grid(axis='x', color='#e8ecef')
        ax.set_axisbelow(True)
        ax.tick_params(axis='y', length=0)
    axes[-1, 0].set_xlabel("Tool's internal model score for this file (one dot per trial)")
    finish(fig, 'falsepositives-v072-full',
           f"Every source here sends a byte-identical prompt for these files ({fp['identical']}/{fp['originalCount']} original cases identical).\n"
           'A dot moving across the line between runs is the model answering the same input differently.')
