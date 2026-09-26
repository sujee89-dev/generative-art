"""Draft a genuinely helpful reply with Claude (or a plain template offline).

Drafts are suggestions for you to edit and post yourself. The prompt steers
away from sales pitches: on Reddit especially, unsolicited self-promotion gets
removed and gets you banned, while a useful answer builds the reputation that
makes people DM you.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

MODEL = os.environ.get("ASKING_MONITOR_MODEL", "claude-opus-5")

SYSTEM_PROMPT = """You help a licensed Ontario mortgage agent write replies to people asking \
mortgage questions in public online communities (Reddit, Facebook groups, forums).

The goal is to be the most useful answer in the thread. Reputation comes from \
helping, not pitching.

How to write the reply:
- Answer the person's actual question first, concretely, the way a knowledgeable friend would.
- Use Canadian/Ontario specifics where relevant: stress test, CMHC insurance, prepayment \
penalties (3 months' interest vs. IRD, and why big-bank posted-rate IRD can be large), \
120-day rate holds, renewal timing and switching lenders at maturity, FHSA / RRSP Home \
Buyers' Plan, land transfer tax and first-time buyer rebates, amortization, HELOCs.
- Rules and rates change. Never quote specific current interest rates, and don't state a \
rule's exact thresholds unless you are confident they are current; say "check the current \
rules" when unsure.
- If the answer depends on details they haven't given, say what those details are and why \
they matter, or ask one or two clarifying questions.
- Match the platform: plain conversational text, short paragraphs, no headings, no emoji. \
Reddit replies usually run 80-220 words.
- Do not give legal or tax advice beyond general information; suggest a lawyer or accountant \
where that is the right call.
- No sales language. Don't tell them to DM you or book a call. Don't invent credentials, \
experience or stories.
- If a disclosure line is provided, end with it exactly as written, so readers know the \
writer's professional interest.

Also decide whether replying is a good idea at all. Say no when the post is not really \
about a mortgage or home financing, the person is clearly outside Canada, the thread is \
already well answered, or the community's rules forbid industry participation."""

DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "should_reply": {"type": "boolean"},
        "reason": {"type": "string", "description": "one sentence on why / why not"},
        "reply": {"type": "string", "description": "the reply text, empty if should_reply is false"},
        "follow_up_hint": {"type": "string",
                           "description": "what to listen for if they reply or DM, for the agent only"},
    },
    "required": ["should_reply", "reason", "reply", "follow_up_hint"],
    "additionalProperties": False,
}


@dataclass
class Draft:
    should_reply: bool
    reason: str
    reply: str
    follow_up_hint: str
    model: str


def build_user_prompt(post: dict, intents: list[str], profile: dict) -> str:
    disclosure = profile.get("disclosure", "").strip()
    rules = profile.get("community_rules", {}).get(post.get("community", ""), "")
    parts = [
        f"Platform/community: {post.get('source')} {post.get('community')}",
        f"Detected topics: {', '.join(intents) or 'unclear'}",
        f"Agent's service area: {profile.get('area', 'Durham Region and Scarborough, Ontario')}",
        f"Disclosure line to end with: {disclosure}" if disclosure else "No disclosure line.",
    ]
    if rules:
        parts.append(f"Community rules to respect: {rules}")
    if profile.get("style_notes"):
        parts.append(f"Agent's style notes: {profile['style_notes']}")
    parts.append("<post>\n"
                 f"Title: {post.get('title', '')}\n\n{post.get('body', '')[:6000]}\n"
                 "</post>")
    return "\n".join(parts)


def draft_with_claude(client, post: dict, intents: list[str], profile: dict) -> Draft:
    # Server-side fallbacks: if the primary model declines, the API retries on a
    # fallback model inside the same call instead of returning nothing.
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=4000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        thinking={"type": "adaptive"},
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": DRAFT_SCHEMA}},
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": build_user_prompt(post, intents, profile)}],
    )
    if response.stop_reason == "refusal":
        return Draft(False, "Model declined to draft a reply for this post.", "", "", response.model)
    if response.stop_reason == "max_tokens":
        raise RuntimeError("Draft was cut off (max_tokens); try again.")
    text = next((b.text for b in response.content if b.type == "text"), "")
    data = json.loads(text)
    return Draft(data["should_reply"], data["reason"], data["reply"], data["follow_up_hint"], response.model)


TEMPLATES = {
    "renewal": ("Before you sign the renewal offer, it's worth knowing it's usually not the best rate "
                "your lender will give. You can negotiate, and at maturity you can switch to another "
                "lender without a penalty. Most lenders let you lock a rate about 120 days out, so "
                "start comparing roughly four months before your maturity date."),
    "break_penalty": ("The penalty depends on whether you're fixed or variable. Variable is usually "
                      "3 months' interest. Fixed is the greater of 3 months' interest or the interest "
                      "rate differential (IRD), and how the IRD is calculated varies a lot by lender. "
                      "Ask your lender for a written penalty quote, and compare it with what you'd "
                      "save before deciding."),
    "first_time_buyer": ("A few things worth lining up early: a pre-approval with a rate hold, how "
                         "you'll use an FHSA and/or the RRSP Home Buyers' Plan for the down payment, "
                         "and budgeting closing costs, including land transfer tax (first-time buyers "
                         "get a rebate)."),
}


def draft_offline(post: dict, intents: list[str], profile: dict, why: str = "") -> Draft:
    body = next((TEMPLATES[i] for i in intents if i in TEMPLATES),
                "Happy to help think this through. Could you share a bit more: your current rate "
                "and term, when it matures, and what you're hoping to change?")
    disclosure = profile.get("disclosure", "").strip()
    reply = f"{body}\n\n{disclosure}" if disclosure else body
    return Draft(True, f"Template draft{f' ({why})' if why else ''}. Tailor it before posting.",
                 reply, "", "template")


def draft(post: dict, intents: list[str], profile: dict, *, offline: bool = False) -> Draft:
    if offline:
        return draft_offline(post, intents, profile, "offline mode")
    try:
        import anthropic  # optional dependency
    except ImportError:
        return draft_offline(post, intents, profile, "anthropic package not installed")
    try:
        client = anthropic.Anthropic()
        return draft_with_claude(client, post, intents, profile)
    except TypeError as e:
        # Raised by the SDK when no API key, token or `ant auth login` profile is found.
        if "authentication" not in str(e):
            raise
        return draft_offline(post, intents, profile, "no Claude API credentials configured")
    except anthropic.AuthenticationError:
        return draft_offline(post, intents, profile, "Claude API credentials rejected")
    except anthropic.APIConnectionError:
        return draft_offline(post, intents, profile, "could not reach the Claude API")
    except anthropic.AnthropicError as e:
        if "api_key" in str(e).lower() or "auth" in str(e).lower():
            return draft_offline(post, intents, profile, "no Claude API credentials configured")
        raise
