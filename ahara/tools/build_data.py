#!/usr/bin/env python3
"""Build ahara/data/words.js from the word lists in tools/src.

Run from anywhere:  python3 ahara/tools/build_data.py

Each word is stored with its syllables joined by "|", e.g. "but|ter|fly".
A source word may already contain "|" to override the automatic split.
French and Tamil words carry their English meaning after "~" (from
src/gloss-*.txt, or from pictures.tsv for picture words).
"""
import json
import re
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "src"
OUT = HERE.parent / "data" / "words.js"


# ---------------------------------------------------------------- English

EN_BLENDS = {"bl", "br", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "pl", "pr", "sc", "sk",
             "sl", "sm", "sn", "sp", "st", "sw", "tr", "tw", "ch", "sh", "th", "ph", "wh"}
EN_RIGHT_DIGRAPHS = {"ch", "sh", "th", "ph", "wh"}
EN_LEFT_DIGRAPHS = {"ck", "ng"}
EN_SPLIT_PAIRS = {"io", "ia", "ua"}


def en_vowel_mask(w):
    mask = []
    for i, ch in enumerate(w):
        prev = w[i - 1] if i else ""
        nxt = w[i + 1] if i + 1 < len(w) else ""
        if ch in "aeiou":
            v = not (ch == "u" and prev == "q")
        elif ch == "y":
            v = i > 0
        elif ch == "w":
            v = prev in ("a", "e", "o") and nxt not in "aeiouy"
        else:
            v = False
        mask.append(v)
    return mask


def en_nuclei(w):
    mask = en_vowel_mask(w)
    groups, i = [], 0
    while i < len(w):
        if mask[i]:
            j = i
            while j + 1 < len(w) and mask[j + 1]:
                j += 1
            groups.append([i, j])
            i = j + 1
        else:
            i += 1
    # split vowel pairs that are usually two sounds (li-on, pi-a-no)
    out = []
    for s, e in groups:
        k = s
        while k < e:
            if w[k:k + 2] in EN_SPLIT_PAIRS:
                out.append([s, k])
                s = k + 1
            k += 1
        out.append([s, e])
    groups = out
    if len(groups) > 1:
        last = groups[-1]
        n = len(w)
        # silent final e (cake, horse), but consonant + le is a syllable (ta-ble)
        if last == [n - 1, n - 1] and w[-1] == "e":
            if not (w.endswith("le") and n >= 3 and not en_vowel_mask(w)[n - 3]):
                groups.pop()
        # silent -es / -ed (cakes, jumped); kept after s x z ch sh / t d
        elif last == [n - 2, n - 2] and w[-2] == "e" and w[-1] in "sd" and n >= 4:
            before = w[:-2]
            if w[-1] == "s" and not before.endswith(("s", "x", "z", "ch", "sh", "g", "c")):
                groups.pop()
            elif w[-1] == "d" and not before.endswith(("t", "d")) and not re.search(r"[^aeiou][rl]$", before):
                groups.pop()
    return groups


def en_split_cluster(w, a, b):
    """Consonants w[a:b] sit between two vowel groups. Return split index."""
    c = w[a:b]
    n = len(c)
    if n == 0:
        return a
    # consonant + le at the end: split before that consonant (ap-ple, ta-ble)
    if w.endswith("le") and b == len(w) - 1:
        return max(a, b - 2)
    if n == 1:
        return a + 1 if c == "x" else a
    if n == 2:
        if c in EN_LEFT_DIGRAPHS:
            return b
        if c in EN_RIGHT_DIGRAPHS or (c[1] in "lr" and c in EN_BLENDS):
            return a
        return a + 1
    if c[-2:] in EN_BLENDS:
        return b - 2
    if c[-3:] in ("chr", "thr", "shr", "str", "spr", "scr", "spl"):
        return b - 3
    return a + 2 if n >= 3 else a + 1


def en_syllables(word):
    low = word.lower()
    if not re.fullmatch(r"[a-z]+", low):
        return [word]
    g = en_nuclei(low)
    if len(g) <= 1:
        return [word]
    cuts = [en_split_cluster(low, g[i][1] + 1, g[i + 1][0]) for i in range(len(g) - 1)]
    parts, start = [], 0
    for c in cuts:
        if c <= start:
            continue
        parts.append(word[start:c])
        start = c
    parts.append(word[start:])
    return [p for p in parts if p]


# ---------------------------------------------------------------- French

FR_VOWELS = set("aeiouyàâäéèêëîïôöùûüœæ")
FR_KEEP = {"bl", "cl", "fl", "gl", "pl", "br", "cr", "dr", "fr", "gr", "pr", "tr", "vr",
           "ch", "ph", "gn", "th"}


def fr_units(w):
    """Split a lowercase French word into (text, is_vowel) units."""
    units, i = [], 0
    while i < len(w):
        two = w[i:i + 2]
        if two in ("qu",) or (two == "gu" and i + 2 < len(w) and w[i + 2] in "eéèêiy"):
            units.append((two, False)); i += 2; continue
        if w[i] in FR_VOWELS:
            j = i
            while j + 1 < len(w) and w[j + 1] in FR_VOWELS:
                j += 1
            units.append((w[i:j + 1], True)); i = j + 1; continue
        units.append((w[i], False)); i += 1
    return units


def fr_part(word):
    low = word.lower()
    units = fr_units(low)
    vidx = [k for k, u in enumerate(units) if u[1]]
    if len(vidx) <= 1:
        return [word]
    cut_units = []
    for a, b in zip(vidx, vidx[1:]):
        cons = [units[k][0] for k in range(a + 1, b)]
        n = len(cons)
        if n == 0:
            cut = a + 1
        elif n == 1:
            cut = a + 1
        elif n == 2:
            cut = a + 1 if (cons[0] + cons[1]) in FR_KEEP else a + 2
        elif n == 3:
            cut = a + 2 if (cons[1] + cons[2]) in FR_KEEP else a + 3
        else:
            cut = a + 3
        cut_units.append(cut)
    # final lone consonants like "-s" stay with the last syllable automatically
    pos, offsets = 0, []
    for u in units:
        offsets.append(pos)
        pos += len(u[0])
    offsets.append(pos)
    parts, start = [], 0
    for cu in cut_units:
        c = offsets[cu]
        if c > start:
            parts.append(word[start:c]); start = c
    parts.append(word[start:])
    # a final syllable with no vowel (e.g. "-ts") joins the previous one
    if len(parts) > 1 and not any(ch in FR_VOWELS for ch in parts[-1].lower()):
        parts[-2] += parts.pop()
    return parts


def fr_syllables(word):
    out = []
    for piece in re.split(r"(?<=[-'’])", word):
        if piece:
            out += fr_part(piece)
    return out


# ---------------------------------------------------------------- Tamil

TA_PULLI = "்"


def ta_letters(word):
    letters = []
    for ch in word:
        cat = unicodedata.category(ch)
        if letters and (cat.startswith("M") or ch == "்"):
            letters[-1] += ch
        else:
            letters.append(ch)
    return letters


def ta_syllables(word):
    """Group Tamil letters into spoken beats: a dead consonant (with pulli)
    closes the beat before it, e.g. அம்மா -> அம் + மா."""
    out, carry = [], ""
    for L in ta_letters(word):
        if L.endswith(TA_PULLI) or L == "ஃ":
            if out:
                out[-1] += L
            else:
                carry += L
        else:
            out.append(carry + L)
            carry = ""
    if carry:
        if out:
            out[-1] += carry
        else:
            out.append(carry)
    return out or [word]


SPLIT = {"en": en_syllables, "fr": fr_syllables, "ta": ta_syllables}


def syllabify(lang, word):
    if "|" in word:
        return word
    return "|".join(SPLIT[lang](word))


# ---------------------------------------------------------------- build

def read_words(lang):
    seen, words = set(), []
    for line in (SRC / f"words-{lang}.txt").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        for w in line.split():
            key = w.replace("|", "").lower()
            if key in seen:
                continue
            seen.add(key)
            words.append(w)
    return words, seen


def read_pictures():
    rows, seen = [], set()
    for line in (SRC / "pictures.tsv").read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        cols = (line.split("\t") + [""] * 6)[:6]
        emoji, en, fr, g, ta, cat = (c.strip() for c in cols)
        if emoji in seen:
            continue
        seen.add(emoji)
        row = {"e": emoji, "c": cat}
        if en:
            row["en"] = en.rstrip("*")
            if en.endswith("*"):
                row["enm"] = 1
        if fr:
            row["fr"] = fr
            row["g"] = g.rstrip("*") or "m"
            if g.endswith("*"):
                row["frm"] = 1
        if ta:
            row["ta"] = ta
        rows.append(row)
    return rows


def read_gloss(lang):
    path = SRC / f"gloss-{lang}.txt"
    g = {}
    if not path.exists():
        return g
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        for entry in line.split(";"):
            if "=" in entry:
                k, v = entry.split("=", 1)
                g[k.strip()] = v.strip()
    return g


def main():
    pictures = read_pictures()
    data = {"pictures": pictures, "words": {}}
    for lang in ("en", "fr", "ta"):
        words, seen = read_words(lang)
        # every picture word is also a reading word
        for p in pictures:
            w = p.get(lang)
            if w and " " not in w and w.lower() not in seen:
                seen.add(w.lower())
                words.append(w)
        gloss = read_gloss(lang)
        for p in pictures:
            if p.get(lang) and p.get("en"):
                gloss.setdefault(p[lang], p["en"])
        out, missing = [], []
        for w in words:
            plain = w.replace("|", "")
            entry = syllabify(lang, w)
            if lang != "en":
                meaning = gloss.get(plain) or gloss.get(plain.lower())
                if meaning:
                    entry += "~" + meaning
                else:
                    missing.append(plain)
            out.append(entry)
        data["words"][lang] = out
        print(f"{lang}: {len(words)} words" + (f", {len(missing)} without meaning: {' '.join(missing[:20])}" if missing else ""))
    print(f"pictures: {len(pictures)}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text("// Generated by tools/build_data.py. Edit tools/src/*, then rebuild.\n"
                   f"window.AHARA_DATA = {body};\n", encoding="utf-8")


if __name__ == "__main__":
    main()
