"""Telco vertical — upgrade propensity vs churn (the original ContextLens domain).

Content is byte-identical to the pre-refactor anchors.py/scenarios.py so the
calibrated story shapes reproduce.
"""

ID = "telco"
LABEL = "Telco"
DESCRIPTION = "Subscriber upgrade propensity vs churn — marketing activation"

ENTITY = {
    "id": "sub_88231",
    "summary": "Mid 20GB / mo · tenure 26mo · urban-5g",
}

SEGMENTS = {
    "positive": "High-Value Upgrade Propensity (Unlimited 5G)",
    "negative": "Churn Risk — Retention Route",
    "indeterminate": "Indeterminate — General Baseline",
}

ATTR_SCALE = {"left": "churn evidence", "right": "upgrade evidence"}

PARAMS_OVERRIDES = {}

_POLARITY = {"upgrade_intent": "positive", "engagement_depth": "neutral", "churn_risk": "negative"}

AXES = [
    {
        "id": "upgrade_intent",
        "label": "Upgrade Intent",
        "short": "Intent",
        "phrases": [
            "comparing unlimited premium plan tiers and pricing",
            "checking device upgrade eligibility in the account app",
            "viewing 5G unlimited plan pricing page",
            "estimating the monthly cost of upgrading my plan",
            "browsing new phone deals and trade-in offers",
            "adding a premium data add-on to the cart",
            "checking trade-in value for my current phone",
            "reading about unlimited plan benefits and perks",
            "reviewing a plan upgrade order at checkout",
        ],
    },
    {
        "id": "engagement_depth",
        "label": "Engagement Depth",
        "short": "Engagement",
        "phrases": [
            "long focused session inside the carrier account app",
            "opening the mobile app every day this week",
            "running a network speed test from the app",
            "exploring the 5G coverage map in detail",
            "reading support documentation thoroughly",
            "reviewing data usage on the account dashboard",
            "configuring account settings and preferences",
            "heavy mobile data usage streaming video",
        ],
    },
    {
        "id": "churn_risk",
        "label": "Churn Risk",
        "short": "Churn",
        "phrases": [
            "contacting support asking how to cancel service",
            "complaining about poor network quality and dropped calls",
            "monthly bill payment failed and is overdue",
            "comparing competitor carrier prices and offers",
            "requesting the account number needed to port out",
            "disputing unexpected charges on the bill",
            "downgrading to a cheaper plan tier",
            "reading how to cancel my contract without fees",
        ],
    },
]

for _ax in AXES:
    _ax["polarity"] = _POLARITY[_ax["id"]]

BUSINESS = {
    "problem": (
        "Churn is usually discovered at the cancellation call, and upsell offers are "
        "sprayed at static segments refreshed quarterly. Both burn agent time on the "
        "wrong customers at the wrong moment."
    ),
    "approach": (
        "Score every behavioral signal as it happens, act only above the 70% confidence "
        "floor, and hand agents a briefed conversation instead of a cold list."
    ),
    "rows": [
        {"metric": "Detecting the moment", "traditional": "Quarterly batch segments + outbound call lists ($8–12 per retention attempt)", "contextlens": "Continuous scoring at ≈$0.003 per 1,000 signals, marginal inference ≈$0"},
        {"metric": "Wasted outreach", "traditional": "Blanket campaigns, ~1–2% hit rate; agents dial uninterested subscribers", "contextlens": "Suppressed below the confidence floor — no evidence, no call"},
        {"metric": "Churn discovery", "traditional": "At the cancellation call, when the decision is already made", "contextlens": "Days earlier, from live behavior — retention plays while they're still deciding"},
    ],
    "math_note": (
        "Order-of-magnitude: replacing a lost subscriber typically costs 5×+ what a "
        "retention save costs. One briefed save per 100 scored sessions pays for "
        "millions of inferences."
    ),
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

