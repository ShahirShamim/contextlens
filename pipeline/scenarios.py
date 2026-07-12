"""Authored signal scripts for the three demo scenarios.

Every event is a raw telemetry payload for one mock subscriber. The payloads
are authored (this is a simulation), but everything computed FROM them —
embeddings, axis affinities, field ablations, projections — is real math.

Event fields:
  id           stable identifier, referenced by the UI
  t_offset_ms  playback timing inside the scenario feed
  source       "device" (on-device SDK) | "cloud" (server-side webhook)
  source_label the system name shown in the raw JSON feed
  event_type   telemetry event name
  age_days     how stale the signal is; drives exponential time decay
  payload      the raw fields; each field is independently ablatable
"""

SUBSCRIBER = {
    "user_id": "sub_88231",
    "plan": "Mid 20GB / mo",
    "tenure_months": 26,
    "region": "urban-5g",
}

SCENARIOS = [
    {
        "id": "baseline",
        "label": "Baseline session",
        "button": "▶ Play baseline session",
        "description": (
            "A fresh, coherent session: on-device plan research plus a cloud "
            "billing overage. Signals agree — high-confidence upgrade propensity."
        ),
        "events": [
            {
                "id": "b1",
                "t_offset_ms": 400,
                "source": "device",
                "source_label": "ios_sdk_edge",
                "event_type": "app_screen_dwell",
                "age_days": 0,
                "payload": {
                    "screen": "plan upgrade comparison — unlimited premium 5G tiers",
                    "compared": "premium unlimited vs current 20GB plan",
                    "dwell_seconds": 340,
                },
            },
            {
                "id": "b2",
                "t_offset_ms": 2200,
                "source": "cloud",
                "source_label": "billing_webhook_cloud",
                "event_type": "billing_event",
                "age_days": 1,
                "payload": {
                    "type": "data cap overage — monthly allowance exceeded",
                    "overage_gb": 4.2,
                    "recommended_plan": "unlimited 5G upgrade",
                },
            },
            {
                "id": "b3",
                "t_offset_ms": 4000,
                "source": "device",
                "source_label": "ios_sdk_edge",
                "event_type": "network_probe",
                "age_days": 0,
                "payload": {
                    "action": "ran network speed test",
                    "result_mbps": 48,
                    "follow_up": "checked 5G coverage before choosing plan upgrade",
                },
            },
            {
                "id": "b4",
                "t_offset_ms": 5800,
                "source": "device",
                "source_label": "ios_sdk_edge",
                "event_type": "app_screen_dwell",
                "age_days": 0,
                "payload": {
                    "screen": "device upgrade eligibility checker",
                    "action": "checked trade-in value for current phone",
                },
            },
            {
                "id": "b5",
                "t_offset_ms": 7600,
                "source": "cloud",
                "source_label": "segment_webhook_cloud",
                "event_type": "web_visit",
                "age_days": 2,
                "payload": {
                    "url": "/plans/unlimited-premium-benefits",
                    "referrer": "google search — best unlimited 5g plan upgrade",
                    "pages_in_session": 3,
                },
            },
            {
                # A stale churn whisper: shows the signed attribution (red
                # counterweight) in the default scenario without flipping it.
                "id": "b6",
                "t_offset_ms": 9200,
                "source": "cloud",
                "source_label": "support_webhook_cloud",
                "event_type": "support_ticket",
                "age_days": 12,
                "payload": {
                    "topic": "asked about cancellation fees when leaving",
                    "channel": "chat",
                    "resolved": "closed — no action taken",
                },
            },
        ],
    },
    {
        "id": "conflict",
        "label": "Asynchronous conflict",
        "button": "⚡ Inject conflicting signals",
        "description": (
            "Fresh on-device signals scream upgrade; stale cloud signals say "
            "churn (a cancel enquiry and a failed payment from last week). "
            "Time decay resolves the tie — and honestly lowers confidence."
        ),
        "events": [
            {
                "id": "c1",
                "t_offset_ms": 400,
                "source": "device",
                "source_label": "ios_sdk_edge",
                "event_type": "app_screen_dwell",
                "age_days": 0,
                "payload": {
                    "screen": "unlimited premium plan pricing",
                    "dwell_seconds": 420,
                    "local_velocity": "high",
                },
            },
            {
                "id": "c2",
                "t_offset_ms": 2200,
                "source": "cloud",
                "source_label": "support_webhook_cloud",
                "event_type": "support_ticket",
                "age_days": 9,
                "payload": {
                    "topic": "asked how to cancel service",
                    "sentiment": "negative",
                    "channel": "chat",
                },
            },
            {
                "id": "c3",
                "t_offset_ms": 4000,
                "source": "device",
                "source_label": "ios_sdk_edge",
                "event_type": "cart_event",
                "age_days": 0,
                "payload": {
                    "action": "added premium data add-on to cart",
                    "value_usd": 25,
                },
            },
            {
                "id": "c4",
                "t_offset_ms": 5800,
                "source": "cloud",
                "source_label": "billing_webhook_cloud",
                "event_type": "billing_event",
                "age_days": 6,
                "payload": {
                    "type": "payment failed",
                    "amount_usd": 68.50,
                    "retry": "pending",
                },
            },
            {
                "id": "c5",
                "t_offset_ms": 7600,
                "source": "device",
                "source_label": "ios_sdk_edge",
                "event_type": "app_screen_dwell",
                "age_days": 0,
                "payload": {
                    "screen": "checkout — plan upgrade review order",
                    "step": "review order",
                },
            },
            {
                "id": "c6",
                "t_offset_ms": 9400,
                "source": "cloud",
                "source_label": "segment_webhook_cloud",
                "event_type": "web_visit",
                "age_days": 9,
                "payload": {
                    "url": "/support/how-to-cancel",
                    "referrer": "direct",
                },
            },
        ],
    },
    {
        "id": "sparse",
        "label": "Sparse / drifting signals",
        "button": "🛑 Feed sparse, drifting signals",
        "description": (
            "Weak, stale, contradictory signals. The honest answer is \"we "
            "don't know\" — confidence falls below the 70% floor and the "
            "system refuses to emit a segment. Guardrails over guesses."
        ),
        "events": [
            {
                "id": "s1",
                "t_offset_ms": 400,
                "source": "device",
                "source_label": "ios_sdk_edge",
                "event_type": "app_open",
                "age_days": 4,
                "payload": {
                    "screen": "home dashboard",
                    "dwell_seconds": 12,
                },
            },
            {
                "id": "s2",
                "t_offset_ms": 2200,
                "source": "cloud",
                "source_label": "segment_webhook_cloud",
                "event_type": "web_visit",
                "age_days": 11,
                "payload": {
                    "url": "/support/articles/roaming-charges",
                    "referrer": "email",
                },
            },
            {
                "id": "s3",
                "t_offset_ms": 4000,
                "source": "device",
                "source_label": "ios_sdk_edge",
                "event_type": "app_screen_dwell",
                "age_days": 7,
                "payload": {
                    "screen": "bill summary",
                    "dwell_seconds": 25,
                },
            },
            {
                "id": "s4",
                "t_offset_ms": 5800,
                "source": "cloud",
                "source_label": "marketing_webhook_cloud",
                "event_type": "marketing_event",
                "age_days": 13,
                "payload": {
                    "type": "email opened",
                    "campaign": "competitor price match offer",
                },
            },
            {
                "id": "s5",
                "t_offset_ms": 7600,
                "source": "device",
                "source_label": "ios_sdk_edge",
                "event_type": "app_open",
                "age_days": 5,
                "payload": {
                    "screen": "coverage map",
                    "dwell_seconds": 18,
                },
            },
        ],
    },
]


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
