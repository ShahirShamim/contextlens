"""Vertical registry + shared helpers.

Each vertical module declares the same surface: ID, LABEL, DESCRIPTION,
ENTITY, SEGMENTS, ATTR_SCALE, PARAMS_OVERRIDES, AXES (each axis with a
`polarity` of positive/neutral/negative), SCENARIOS. The engine consumes
these declaratively — nothing downstream knows what a telco is.
"""

from . import fintech, marketplace, telco

VERTICALS = [telco, marketplace, fintech]


def serialize_event(event, drop_field=None):
    """Turn a raw event into the text that gets embedded.

    One compact natural-language line: event type plus every payload field.
    `drop_field` omits a single payload field — used for leave-one-out
    ablation, so each field's contribution to the semantic score is the
    cosine delta caused by removing it.
    """
    parts = []
    for key, value in event["payload"].items():
        if key == drop_field:
            continue
        parts.append(f"{key.replace('_', ' ')}: {value}")
    kind = "mobile app event" if event["source"] == "device" else "cloud event"
    return f"{kind} — {event['event_type'].replace('_', ' ')}. " + "; ".join(parts)


def axis_by_polarity(vertical, polarity):
    return next(ax["id"] for ax in vertical.AXES if ax["polarity"] == polarity)
