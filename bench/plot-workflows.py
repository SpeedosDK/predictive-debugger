"""Generate shareable figures from validated workflow-summary.json."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter, MaxNLocator

here = Path(__file__).resolve().parent
data = json.loads((here / 'workflow-summary.json').read_text(encoding='utf-8'))
rows = data['arms']
trials = data['trials']
out = here / 'charts'
out.mkdir(exist_ok=True)
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11,
                     'axes.spines.top': False, 'axes.spines.right': False,
                     'axes.spines.left': False, 'axes.edgecolor': '#d5dae0',
                     'text.color': '#172b3a', 'axes.labelcolor': '#172b3a',
                     'xtick.color': '#526473', 'ytick.color': '#172b3a',
                     'svg.fonttype': 'none', 'savefig.facecolor': 'white'})
labels = ['Direct reading', 'v0.7.1', 'v0.8.0']
colors = ['#8593a3', '#bd8745', '#178974']
arms = ['read', 'previous', 'current']
original = [data['groups']['original'][a] for a in arms]
added = [data['groups']['added'][a] for a in arms]
cases = lambda series: (series[0]['bugs'] + series[0]['controls']) // trials

def finish(fig, name, note):
    fig.text(.06, .025, note, fontsize=9, color='#526473')
    fig.savefig(out / (name + '.svg'), bbox_inches='tight')
    svg = out / (name + '.svg')
    svg.write_text('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines()) + '\n', encoding='utf-8')
    plt.close(fig)

# Found counts are split by case group: the new cases are the only ones where the versions'
# prompts differ, so a single combined bar would hide why v0.7.1's total fell.
fig, axes = plt.subplots(1, 3, figsize=(13, 4.2), gridspec_kw={'width_ratios': [1.35, 1, 1]})
fig.subplots_adjust(left=.12, right=.96, bottom=.23, top=.76, wspace=.35)
fig.suptitle('What did each workflow find?', x=.06, y=.96, ha='left', fontsize=21, weight='bold')
panels = [(original, 'detected', 'bugs', f'Original {cases(original)} cases · defects found'),
          (added, 'detected', 'bugs', f'New {cases(added)} dependency cases · defects found'),
          (rows, 'falseAlarms', 'controls', 'False alarms · lower is better')]
for i, (ax, (series, key, denom, title)) in enumerate(zip(axes, panels)):
    vals = [r[key] for r in series]
    ax.barh(labels, vals, color=colors, height=.53)
    ax.invert_yaxis()
    limit = series[0][denom] if key == 'detected' else max(3, max(vals) + 1)
    ax.set_xlim(0, limit * 1.3)
    ax.set_title(title, fontsize=10, loc='left', pad=18)
    if key == 'detected':
        ax.set_xticks([round(limit * k / 3) for k in range(4)])
    else:
        ax.xaxis.set_major_locator(MaxNLocator(integer=True, nbins=4))
    ax.grid(axis='x', color='#e8ecef'); ax.set_axisbelow(True)
    ax.tick_params(axis='y', length=0, labelleft=i == 0)
    for y, r in enumerate(series): ax.text(r[key] + limit * .025, y, f"{r[key]}/{r[denom]}", va='center', weight='bold')
alternatives = ', '.join(f"{label}: {row.get('otherVerified', 0)}" for label, row in zip(labels, rows))
finish(fig, 'detection', f'Sonnet · {cases(original) + cases(added)} cases · {trials} trials each, every session run fresh. '
       f'The original {cases(original)} are the cases from the previous results.\n'
       'Repeated trials are not independent bugs. Other verified findings, counted separately: ' + alternatives + '.')

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
finish(fig, 'usage', 'Totals across 3 sessions per workflow. Includes fresh input, output, cache writes and cache reads.')
