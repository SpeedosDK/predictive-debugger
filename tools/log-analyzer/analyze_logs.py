#!/usr/bin/env python3
"""Flag anomalous lines in a log file.

Deliberately dependency-free: no numpy, no API client, no credentials. The
previous version called an embeddings endpoint, which defeated the point of an
extension that borrows the CLI's sign-in instead of holding its own key.

Scoring combines two signals:
  * severity  - how alarming the line's log level is
  * rarity    - how unusual the line's vocabulary is versus the rest of the file

Usage:  analyze_logs.py <log-file> [--threshold 0.5]
Output: one JSON object on stdout
"""

import json
import math
import re
import sys
from collections import Counter

SEVERITY = {
    "FATAL": 1.0,
    "CRITICAL": 1.0,
    "CRIT": 1.0,
    "PANIC": 1.0,
    "ERROR": 0.85,
    "ERR": 0.85,
    "SEVERE": 0.85,
    "EXCEPTION": 0.85,
    "WARNING": 0.5,
    "WARN": 0.5,
    "INFO": 0.0,
    "DEBUG": 0.0,
    "TRACE": 0.0,
}

TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]+")
# Numbers, hex ids, timestamps and quoted payloads vary per line and would
# otherwise make every line look equally rare.
NOISE_RE = re.compile(r"\b(?:0x[0-9a-fA-F]+|\d[\d:.\-/T]*)\b")

DEFAULT_THRESHOLD = 0.5


def severity_of(line):
    upper = line.upper()
    for name, weight in SEVERITY.items():
        if re.search(r"\b" + name + r"\b", upper):
            return name, weight
    return None, 0.0


def tokenize(line):
    return TOKEN_RE.findall(NOISE_RE.sub(" ", line).lower())


def analyze_lines(lines):
    counts = Counter()
    tokens_per_line = []

    for line in lines:
        tokens = tokenize(line)
        tokens_per_line.append(tokens)
        counts.update(set(tokens))

    total = max(len(lines), 1)
    results = []

    for index, (line, tokens) in enumerate(zip(lines, tokens_per_line), start=1):
        level, severity = severity_of(line)

        if tokens:
            # Mean inverse document frequency, normalised to [0, 1].
            idf = sum(math.log(total / counts[t]) for t in set(tokens)) / len(set(tokens))
            rarity = min(1.0, idf / math.log(total + 1)) if total > 1 else 0.0
        else:
            rarity = 0.0

        score = min(1.0, 0.7 * severity + 0.3 * rarity)

        reasons = []
        if level and severity > 0:
            reasons.append("level %s" % level)
        if rarity >= 0.5:
            reasons.append("unusual wording for this file")

        results.append(
            {
                "line": index,
                "text": line.strip(),
                "score": round(score, 3),
                "reason": ", ".join(reasons) or "nothing notable",
            }
        )

    return results


def main(argv):
    if len(argv) < 2:
        print(json.dumps({"error": "usage: analyze_logs.py <log-file> [--threshold N]"}))
        return 2

    threshold = DEFAULT_THRESHOLD
    if "--threshold" in argv:
        try:
            threshold = float(argv[argv.index("--threshold") + 1])
        except (IndexError, ValueError):
            print(json.dumps({"error": "--threshold needs a number"}))
            return 2

    try:
        with open(argv[1], "r", encoding="utf-8", errors="replace") as handle:
            lines = [line for line in handle.read().splitlines() if line.strip()]
    except OSError as exc:
        print(json.dumps({"error": "could not read log file: %s" % exc}))
        return 1

    scored = analyze_lines(lines)
    anomalies = [entry for entry in scored if entry["score"] >= threshold]
    anomalies.sort(key=lambda entry: entry["score"], reverse=True)

    print(
        json.dumps(
            {
                "total_lines": len(lines),
                "threshold": threshold,
                "anomaly_count": len(anomalies),
                "anomalies": anomalies,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
