"""Generate shareable figures from validated workflow-summary.json."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter, MaxNLocator

here = Path(__file__).resolve().parent
data = json.loads((here / 'workflow-summary.json').read_text())
rows = data['arms']
out = here / 'charts'
out.mkdir(exist_ok=True)
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11,
                     'axes.spines.top': False, 'axes.spines.right': False,
                     'axes.spines.left': False, 'axes.edgecolor': '#d5dae0',
                     'text.color': '#172b3a', 'axes.labelcolor': '#172b3a',
                     'xtick.color': '#526473', 'ytick.color': '#172b3a',
                     'svg.fonttype': 'none', 'savefig.facecolor': 'white'})
labels = ['Direct reading', 'v0.6 master', 'v0.7 candidate']
colors = ['#8593a3', '#bd8745', '#178974']

def finish(fig, name, note):
    fig.text(.06, .025, note, fontsize=9, color='#526473')
    fig.savefig(out / (name + '.svg'), bbox_inches='tight')
    svg = out / (name + '.svg')
    svg.write_text('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines()) + '\n', encoding='utf-8')
    plt.close(fig)

fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.2), gridspec_kw={'width_ratios': [1.5, 1]})
fig.subplots_adjust(left=.16, right=.94, bottom=.23, top=.76, wspace=.62)
fig.suptitle('What did each workflow find?', x=.06, y=.96, ha='left', fontsize=21, weight='bold')
for ax, key, denom, title in [(axes[0], 'detected', 'bugs', 'Planted defects identified · higher is better'),
                              (axes[1], 'falseAlarms', 'controls', 'False alarms · lower is better')]:
    vals = [r[key] for r in rows]
    ax.barh(labels, vals, color=colors, height=.53)
    ax.invert_yaxis()
    limit = rows[0][denom] if key == 'detected' else max(3, max(vals) + 1)
    ax.set_xlim(0, limit * 1.2)
    ax.set_title(title, fontsize=10, loc='left', pad=18)
    ax.xaxis.set_major_locator(MaxNLocator(integer=True, nbins=4))
    if key == 'detected': ax.set_xticks([0, 13, 26, 39])
    ax.grid(axis='x', color='#e8ecef'); ax.set_axisbelow(True); ax.tick_params(axis='y', length=0)
    for y, r in enumerate(rows): ax.text(r[key] + limit * .025, y, f"{r[key]}/{r[denom]}", va='center', weight='bold')
alternatives = ', '.join(f"{label}: {row.get('otherVerified', 0)}" for label, row in zip(labels, rows))
finish(fig, 'detection', 'Sonnet · 28 development cases · 3 trials each. Repeated trials are not independent bugs.\n'
       + 'Other verified findings, counted separately: ' + alternatives + '.')

fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.5))
fig.subplots_adjust(left=.16, right=.94, bottom=.25, top=.75, wspace=.6)
fig.suptitle('What each complete workflow used', x=.06, y=.96, ha='left', fontsize=19, weight='bold')
for ax, key, title in [(axes[0], 'total', 'Reported tokens · includes cache reads and writes'),
                        (axes[1], 'cost', 'CLI-estimated cost · USD')]:
    caller = [r['caller'][key] for r in rows]; internal = [r['internal'][key] for r in rows]
    ax.barh(labels, caller, color='#617b9a', height=.53, label='Caller agent')
    ax.barh(labels, internal, left=caller, color='#178974', height=.53, label='Inside the tool')
    ax.invert_yaxis(); ax.set_title(title, fontsize=10, loc='left', pad=18)
    total = [a+b for a,b in zip(caller,internal)]; maximum = max(total)
    ax.set_xlim(0, maximum*1.3); ax.grid(axis='x', color='#e8ecef'); ax.set_axisbelow(True)
    ax.tick_params(axis='y', length=0)
    ax.xaxis.set_major_locator(MaxNLocator(nbins=4))
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v,p, metric=key: f'{v/1000:.0f}k' if metric=='total' else f'${v:.2f}'))
    for y, v in enumerate(total): ax.text(v+maximum*.025, y, f'{v/1000:,.1f}k' if key=='total' else f'${v:.3f}', va='center', weight='bold')
axes[0].legend(loc='upper left', bbox_to_anchor=(0,-.16), ncol=2, frameon=False, fontsize=9)
provenance = 'Master and reading sessions reused; candidate sessions fresh. ' if data.get('reusedBaselines') else ''
finish(fig, 'usage', 'Totals across 3 sessions per workflow. CLI estimates are not subscription invoices.\n'
       + provenance + 'Cache state affects cost.')
