"""Join official population counts into apps/frontend/data/municipalities.json.

argv: <municipalities.json> <ČSÚ 1300722503.xlsx> <ŠÚ SR om7014rr json>
Sources and matching rules: data/README.md, "Population".
"""
import json
import sys
import unicodedata
from collections import Counter, defaultdict

import openpyxl

MUNI, CZ_XLSX, SK_JSON = sys.argv[1:4]


def norm(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return ' '.join(s.lower().replace('–', '-').split()).replace(' - ', '-')


data = json.load(open(MUNI, encoding='utf-8'))

# --- Czechia ---------------------------------------------------------------
cz = {}  # (name, district) -> population
cz_by_name = defaultdict(list)
district = None
wb = openpyxl.load_workbook(CZ_XLSX, read_only=True)
for row in wb.worksheets[0].iter_rows(values_only=True):
    a, code, name, pop = row[0], row[1], row[2], row[3]
    if isinstance(a, str) and a.startswith('Okres ') and code is None:
        district = a[len('Okres '):].strip()
        continue
    if isinstance(code, int) and isinstance(pop, int) and name:
        d = 'Praha' if name == 'Praha' else district
        cz[(norm(name), norm(d))] = pop
        cz_by_name[norm(name)].append(pop)

# --- Slovakia --------------------------------------------------------------
sk = json.load(open(SK_JSON, encoding='utf-8'))
dims = sk['dimension']
obc = dims['om7014rr_obc']['category']
ukaz = dims['om7014rr_ukaz']['category']['index']
pop_idx = ukaz['IN010052']
n_ukaz = len(ukaz)
values = sk['value']
sk_rows = []  # (okres code, name, population)
for code, i in obc['index'].items():
    v = values[i * n_ukaz + pop_idx] if isinstance(values, list) else values.get(str(i * n_ukaz + pop_idx))
    if v is None:
        continue
    sk_rows.append((code[:6], obc['label'][code], round(v)))

# Bratislava and Košice come as city districts; our file has each city once.
cities = Counter()
rest = []
for okres, name, pop in sk_rows:
    for city in ('Bratislava', 'Košice'):
        if name.startswith(city + ' - '):
            cities[city] += pop
            break
    else:
        rest.append((okres, name, pop))

# Map ŠÚ okres codes to our district names: the district where most of the
# code's municipality names are found.
ours_sk = [m for m in data if m['country'] == 'SK']
names_by_district = defaultdict(set)
for m in ours_sk:
    names_by_district[m['district']].add(norm(m['name']))
okres_votes = defaultdict(Counter)
for okres, name, _ in rest:
    for d, names in names_by_district.items():
        if norm(name) in names:
            okres_votes[okres][d] += 1
okres_name = {o: v.most_common(1)[0][0] for o, v in okres_votes.items()}
sk_map = {(norm(n), norm(okres_name[o])): p for o, n, p in rest if o in okres_name}

cz_names = Counter(norm(m['name']) for m in data if m['country'] == 'CZ')

# --- Join ------------------------------------------------------------------
missing = []
for m in data:
    key = (norm(m['name']), norm(m['district']))
    if m['country'] == 'CZ':
        pop = cz.get(key)
        if pop is None and len(cz_by_name.get(key[0], [])) == 1 and cz_names[key[0]] == 1:
            # Our district source predates a few okres boundary changes; a
            # name that is unique in both datasets is the same municipality.
            pop = cz_by_name[key[0]][0]
    else:
        pop = cities.get(m['name']) or sk_map.get(key)
    if pop is None:
        missing.append(f"{m['country']} {m['name']} ({m['district']})")
    m['population'] = pop

with open(MUNI, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))

by_country = Counter(m['country'] for m in data if m['population'] is not None)
big = Counter(m['country'] for m in data if (m['population'] or 0) >= 10000)
print('matched', dict(by_country), 'of', dict(Counter(m['country'] for m in data)))
print('10k+', dict(big))
print('missing', len(missing))
print('\n'.join(missing[:40]))
