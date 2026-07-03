#!/usr/bin/env python3
"""Regenerate galaxy/data.json from yc_market_map.xlsx (Companies sheet).

Run from the yc_map1 folder after updating the spreadsheet:
    python3 galaxy/build_data.py
"""
import json
import os

# openpyxl chokes on the float tabRatio this workbook carries (Google Sheets
# export artifact) — coerce floats to int where an int is expected.
import openpyxl.descriptors.base as _b
_orig = _b._convert
def _patched(expected_type, value):
    try:
        return _orig(expected_type, value)
    except TypeError:
        if expected_type is int:
            return int(float(value))
        raise
_b._convert = _patched

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
XLSX = os.path.join(HERE, '..', 'yc_market_map.xlsx')
OUT = os.path.join(HERE, 'data.json')

SEASON = {'Winter': 0, 'Spring': 1, 'Summer': 2, 'Fall': 3}

def batch_key(b):
    season, year = b.split()
    return (int(year), SEASON[season])

wb = openpyxl.load_workbook(XLSX, read_only=True)
ws = wb['Companies']
rows = ws.iter_rows(values_only=True)
hdr = [str(h).strip() if h else '' for h in next(rows)]
idx = {h: i for i, h in enumerate(hdr) if h}

def get(r, name):
    i = idx.get(name)
    if i is None or i >= len(r) or r[i] is None:
        return ''
    s = str(r[i]).strip()
    return '' if not s or s.startswith('=') else s

raw = []
for r in rows:
    name = get(r, 'Company')
    batch = get(r, 'Batch')
    if not name or not batch:
        continue
    raw.append((name, batch, r))

batches = sorted({b for _, b, _ in raw}, key=batch_key)
bidx = {b: i for i, b in enumerate(batches)}

companies = []
for name, batch, r in raw:
    companies.append({
        'n': name, 'b': bidx[batch],
        'o': get(r, 'One-liner'), 'w': get(r, 'Website'),
        'h': get(r, 'HQ location'), 'st': get(r, 'YC status') or 'Active',
        'ai': get(r, 'AI?') or 'Non-AI', 'ly': get(r, 'Layer'),
        'hv': get(r, 'Horizontal/Vertical'), 'se': get(r, 'Sector'),
        'su': get(r, 'Sub-sector'), 'fn': get(r, 'Function (if horizontal)'),
        'cu': get(r, 'Customer'), 'mo': get(r, 'Business model'),
    })

with open(OUT, 'w') as f:
    json.dump({'batches': batches, 'companies': companies}, f, separators=(',', ':'))

print(f'Wrote {len(companies)} companies across {len(batches)} batches to {OUT}')
