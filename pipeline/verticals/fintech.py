"""Fintech vertical — dispute/complaint escalation routing.

Predicts "this case will escalate" from live in-app distress (retry loops,
card freezes) versus historical resolution confidence, so senior-agent
routing happens before the angry call, and calm cases stay self-serve.
"""

ID = "fintech"
LABEL = "Fintech"
DESCRIPTION = "Case escalation risk vs self-serve resolution — service routing"

ENTITY = {
    "id": "cust_20981",
    "summary": "dispute #D-4432 · opened 2d ago · premium account",
}

SEGMENTS = {
    "positive": "Escalation Likely — Senior-Agent Routing",
    "negative": "Self-Serve Track — Automated Resolution",
    "indeterminate": "Indeterminate — Standard Queue",
}

ATTR_SCALE = {"left": "resolution confidence", "right": "escalation risk"}

PARAMS_OVERRIDES = {}

AXES = [
    {
        "id": "escalation_risk",
        "label": "Escalation Risk",
        "short": "Escalation",
        "polarity": "positive",
        "phrases": [
            "retried the failed transfer multiple times",
            "froze the card after a disputed charge",
            "typed a complaint mentioning the ombudsman",
            "demanded to speak to a manager",
            "threatened to close the account over the dispute",
            "repeated failed payment attempts causing frustration",
            "angry message about money being stuck",
            "disputed charge still unresolved and escalating",
        ],
    },
    {
        "id": "case_engagement",
        "label": "Case Engagement",
        "short": "Engagement",
        "polarity": "neutral",
        "phrases": [
            "checked the dispute status in the app",
            "read the resolution FAQ",
            "uploaded a document for the case",
            "reviewed recent transactions calmly",
            "opened the support chat to ask a question",
            "checked the account balance",
            "browsed help center articles",
            "updated contact details on the account",
        ],
    },
    {
        "id": "resolution_confidence",
        "label": "Resolution Confidence",
        "short": "Resolution",
        "polarity": "negative",
        "phrases": [
            "accepted the proposed refund timeline",
            "similar dispute resolved smoothly last time",
            "completed the self-serve resolution flow",
            "thanked support after a quick fix",
            "case marked resolved with positive feedback",
            "provisional credit applied and acknowledged",
            "customer satisfied with the resolution plan",
            "no further contact needed after resolution steps",
        ],
    },
]

BUSINESS = {
    "problem": (
        "Disputes are routed first-in-first-out, so the customer about to file a formal "
        "complaint waits behind the one who's fine with self-serve. Misroutes mean "
        "repeat contacts, escalations, and regulator complaints that cost hundreds per case."
    ),
    "approach": (
        "Read live distress against resolution history, route escalation risk to a "
        "briefed senior agent before the angry call, and leave calm cases in the "
        "cheaper self-serve flow."
    ),
    "rows": [
        {"metric": "Escalation detection", "traditional": "After the angry call or the formal complaint lands", "contextlens": "From live behavior — retry loops and card freezes, before the call"},
        {"metric": "Queue strategy", "traditional": "FIFO — seniority assigned by luck; every case costs a full triage contact ($8–12)", "contextlens": "Evidence-gated routing; self-serve cases never consume an agent"},
        {"metric": "Cost of a misroute", "traditional": "Repeat contacts + formal complaint handling (hundreds per case) + premium churn", "contextlens": "One briefed conversation at the right seniority, first time"},
    ],
    "math_note": (
        "Order-of-magnitude: preventing a single formal complaint (typically hundreds "
        "of dollars in case handling) covers the inference cost of scoring every case "
        "the platform sees that year."
    ),
}

SCENARIOS = [
    {
        "id": "baseline",
        "label": "Distress cluster",
        "button": "▶ Play distress session",
        "description": (
            "A retry loop, a card freeze, and a chargeback land together. "
            "High-confidence escalation — route to a senior agent with the "
            "brief before the angry call happens."
        ),
        "events": [
            {
                "id": "f_b1",
                "t_offset_ms": 400,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "transfer_retry",
                "age_days": 0,
                "payload": {
                    "action": "retried failed transfer",
                    "attempts_today": 3,
                    "amount_usd": 1200,
                },
            },
            {
                "id": "f_b2",
                "t_offset_ms": 2200,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "card_action",
                "age_days": 0,
                "payload": {
                    "action": "froze card after disputed charge",
                    "screen": "card security",
                },
            },
            {
                "id": "f_b3",
                "t_offset_ms": 4000,
                "source": "cloud",
                "source_label": "dispute_webhook_cloud",
                "event_type": "dispute_webhook",
                "age_days": 0,
                "payload": {
                    "type": "chargeback filed",
                    "merchant": "online electronics store",
                    "amount_usd": 480,
                },
            },
            {
                "id": "f_b4",
                "t_offset_ms": 5800,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "app_screen_dwell",
                "age_days": 0,
                "payload": {
                    "screen": "dispute status — case D-4432",
                    "views_today": 4,
                },
            },
            {
                "id": "f_b5",
                "t_offset_ms": 7600,
                "source": "cloud",
                "source_label": "support_webhook_cloud",
                "event_type": "support_ticket",
                "age_days": 1,
                "payload": {
                    "topic": "asked why the transfer keeps failing",
                    "sentiment": "frustrated",
                    "channel": "chat",
                },
            },
        ],
    },
    {
        "id": "conflict",
        "label": "History says patient, behavior says not",
        "button": "⚡ Inject conflicting signals",
        "description": (
            "The record says this customer resolves things amicably — refund "
            "accepted, 9/10 CSAT. Their live behavior says otherwise. Decay "
            "sides with today; automation holds while sources disagree."
        ),
        "events": [
            {
                "id": "f_c1",
                "t_offset_ms": 400,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "transfer_retry",
                "age_days": 0,
                "payload": {
                    "action": "retried failed transfer",
                    "attempts_today": 2,
                },
            },
            {
                "id": "f_c2",
                "t_offset_ms": 2200,
                "source": "cloud",
                "source_label": "case_history_cloud",
                "event_type": "case_history",
                "age_days": 11,
                "payload": {
                    "type": "previous dispute resolved amicably",
                    "outcome": "refund accepted, positive feedback",
                },
            },
            {
                "id": "f_c3",
                "t_offset_ms": 4000,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "card_action",
                "age_days": 0,
                "payload": {
                    "action": "froze card after disputed charge",
                },
            },
            {
                "id": "f_c4",
                "t_offset_ms": 5800,
                "source": "cloud",
                "source_label": "case_history_cloud",
                "event_type": "case_history",
                "age_days": 9,
                "payload": {
                    "type": "refund timeline accepted",
                    "note": "customer thanked support for the quick fix",
                },
            },
            {
                "id": "f_c5",
                "t_offset_ms": 7600,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "app_screen_dwell",
                "age_days": 0,
                "payload": {
                    "screen": "dispute status — checked twice this hour",
                },
            },
            {
                "id": "f_c6",
                "t_offset_ms": 9400,
                "source": "cloud",
                "source_label": "survey_webhook_cloud",
                "event_type": "survey_event",
                "age_days": 12,
                "payload": {
                    "type": "csat submitted",
                    "score": "9 of 10",
                    "note": "smooth resolution last time",
                },
            },
        ],
    },
    {
        "id": "sparse",
        "label": "Sparse / quiet case",
        "button": "🛑 Feed sparse, quiet signals",
        "description": (
            "Case open, merchant hasn't responded, customer barely active. "
            "No basis to jump the queue in either direction — standard track."
        ),
        "events": [
            {
                "id": "f_s1",
                "t_offset_ms": 400,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "app_open",
                "age_days": 4,
                "payload": {
                    "screen": "home",
                    "dwell_seconds": 10,
                },
            },
            {
                "id": "f_s2",
                "t_offset_ms": 2200,
                "source": "cloud",
                "source_label": "dispute_webhook_cloud",
                "event_type": "dispute_webhook",
                "age_days": 8,
                "payload": {
                    "type": "case opened",
                    "status": "awaiting merchant response",
                },
            },
            {
                "id": "f_s3",
                "t_offset_ms": 4000,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "app_screen_dwell",
                "age_days": 6,
                "payload": {
                    "screen": "transaction list",
                    "dwell_seconds": 22,
                },
            },
            {
                "id": "f_s4",
                "t_offset_ms": 5800,
                "source": "cloud",
                "source_label": "marketing_webhook_cloud",
                "event_type": "marketing_event",
                "age_days": 10,
                "payload": {
                    "type": "email opened",
                    "campaign": "savings account offer",
                },
            },
        ],
    },
]
