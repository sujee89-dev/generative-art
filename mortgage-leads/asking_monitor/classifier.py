"""Rule-based intent detection: is this person asking something a broker can help with?

Cheap, fast and explainable, so it runs on every post. Claude only gets called
(when drafting) for posts that clear the threshold.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# intent -> (label, weight, patterns)
INTENTS: dict[str, tuple[str, int, list[str]]] = {
    "renewal": ("Renewal coming up", 35, [
        r"\brenew(al|ing)?\b[^.?!]{0,60}\bmortgage", r"\bmortgage\b[^.?!]{0,60}\brenew",
        r"renewal (offer|letter|rate)", r"\bterm (is )?(up|ending|expir)", r"\bmaturity date\b",
    ]),
    "break_penalty": ("Breaking a mortgage / penalty", 35, [
        r"\bbreak(ing)? (my|our|the) mortgage", r"prepayment (penalty|charge)",
        r"\bIRD\b", r"interest rate differential", r"penalty (to|for) break",
        r"3 months'? interest",
    ]),
    "first_time_buyer": ("First-time buyer", 30, [
        r"first[- ]time (home ?)?buyer", r"\bFTHB\b", r"\bFHSA\b", r"home buyers'? plan", r"\bHBP\b",
        r"\bpre-?approv", r"down ?payment", r"how much (house|home|mortgage) can (i|we) afford",
    ]),
    "refinance": ("Refinance / equity / debt consolidation", 30, [
        r"\brefinanc", r"\bHELOC\b", r"home equity", r"equity take[- ]?out",
        r"consolidat\w* (my |our )?(debt|credit)", r"second mortgage",
    ]),
    "rate_choice": ("Rate / product choice", 25, [
        r"fixed (vs\.?|or|versus) variable", r"variable (vs\.?|or|versus) fixed",
        r"(best|good|lowest) (mortgage )?rates?\b", r"\brate hold\b", r"\bmortgage rates?\b",
        r"(3|5)[- ]year fixed", r"\bamorti[sz]ation\b",
    ]),
    "switch_lender": ("Switching lenders", 30, [
        r"switch(ing)? (lenders?|banks?|my mortgage)", r"transfer (my|our) mortgage",
        r"\bport(ing)? (my|our|the) mortgage", r"\bstress test\b",
    ]),
    "tough_approval": ("Self-employed / credit / declined", 30, [
        r"self[- ]employed", r"bad credit", r"\bB[- ]lender\b", r"private (lender|mortgage)",
        r"(declined|denied|rejected) (for|by)[^.?!]{0,40}(mortgage|bank)", r"stated income",
        r"\bconsumer proposal\b", r"\bbankruptcy\b", r"new (to canada|immigrant)",
    ]),
    "payment_shock": ("Payment shock", 30, [
        r"payments? (is |are )?(going|went) up", r"\btrigger rate\b", r"negative amorti[sz]ation",
        r"can'?t afford (my|our|the) (mortgage|payments?)", r"payment (shock|increase)",
    ]),
}

MORTGAGE_CONTEXT = re.compile(
    r"\b(mortgage|lender|bank|broker|renewal|house|home|condo|townhouse|property|FHSA|HELOC)\b", re.I)

ASKING = [r"\?", r"\bshould (i|we)\b", r"\bany (advice|tips|suggestions)\b", r"\bhelp\b",
          r"\bconfused\b", r"\bwhat (do|would|should) (i|we|you)\b", r"\bis it worth\b",
          r"\bdoes anyone\b", r"\banyone (know|have|recommend)\b", r"\bELI5\b", r"\bstressed\b"]

# Terms that suggest the poster is outside Canada (r/durham is mostly Durham, NC).
NON_CANADIAN = [r"\b401\(?k\)?\b", r"\bFHA\b", r"\bVA loan\b", r"\bescrow\b", r"\bHOA\b",
                r"\bnorth carolina\b", r"\bRaleigh\b", r"\bChapel Hill\b", r"\bNC\b",
                r"\bUSDA loan\b", r"\bPMI\b", r"\bRoth IRA\b", r"\bFannie\b", r"\bFreddie\b"]

# Industry posts, promos and job ads.
SKIP = [r"\bi'?m a (mortgage )?(broker|agent)\b", r"\bdm me\b", r"\bhiring\b", r"\b\[?promo",
        r"\bwe'?re a (mortgage )?brokerage\b"]

DEFAULT_LOCAL_TERMS = ["Durham Region", "Whitby", "Ajax", "Pickering", "Oshawa", "Scarborough",
                       "Brooklin", "Courtice", "Bowmanville", "Clarington", "Uxbridge", "GTA",
                       "Toronto", "Markham"]


@dataclass
class Match:
    score: int
    intents: list[str] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)
    local: bool = False
    skip_reason: str = ""


def _any(patterns: list[str], text: str) -> str | None:
    for p in patterns:
        m = re.search(p, text, re.I)
        if m:
            return m.group(0)
    return None


def classify(title: str, body: str, *, community: str = "",
             local_terms: list[str] | None = None, extra_keywords: list[str] | None = None) -> Match:
    text = f"{title}\n{body}"
    skip = _any(SKIP, text)
    if skip:
        return Match(0, skip_reason=f"looks promotional ({skip!r})")

    m = Match(0)
    intent_pts = 0
    for key, (label, weight, pats) in INTENTS.items():
        hit = _any(pats, text)
        if hit:
            m.intents.append(key)
            m.reasons.append(f"{label}: “{hit}”")
            intent_pts = max(intent_pts, weight) if not intent_pts else intent_pts + 10
    for kw in extra_keywords or []:
        if re.search(re.escape(kw), text, re.I):
            m.reasons.append(f"keyword: “{kw}”")
            intent_pts += 10
    if not intent_pts:
        return m
    if not MORTGAGE_CONTEXT.search(text):
        intent_pts //= 2
        m.reasons.append("no clear housing context")

    ask = _any(ASKING, text)
    ask_pts = 20 if ask else 0
    if ask:
        m.reasons.append("asking for help")

    local_pts = 0
    for term in local_terms if local_terms is not None else DEFAULT_LOCAL_TERMS:
        if re.search(rf"\b{re.escape(term)}\b", f"{text} {community}", re.I):
            m.local = True
            local_pts = 20
            m.reasons.append(f"local: {term}")
            break
    if not m.local and re.search(r"canad|ontario|/r/?(personalfinancecanada|ontario|askTO)|\bPFC\b",
                                 f"{text} {community}", re.I):
        local_pts = 8

    foreign = _any(NON_CANADIAN, text)
    penalty = 0
    if foreign:
        penalty = 50
        m.reasons.append(f"probably not in Canada (“{foreign}”)")

    m.score = max(0, min(100, intent_pts + ask_pts + local_pts - penalty))
    return m
