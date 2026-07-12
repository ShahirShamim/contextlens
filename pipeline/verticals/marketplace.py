"""Marketplace vertical — WISMO deflection (where-is-my-order).

Predicts "buyer is about to contact support about their order" from anxious
on-device behavior + carrier/CRM webhooks, so outreach can happen before the
ticket exists. Note the domain-specific decay: delivery context goes stale in
hours, not weeks — the half-life is a product decision per vertical.
"""

ID = "marketplace"
LABEL = "Marketplace"
DESCRIPTION = "Buyer WISMO risk vs delivery confidence — logistics outcomes"

ENTITY = {
    "id": "buyer_74112",
    "summary": "order #A-8817 · promised Jul 15 · 3 prior orders",
}

SEGMENTS = {
    "positive": "WISMO Imminent — Proactive Outreach",
    "negative": "On Track — Don't Interfere",
    "indeterminate": "Indeterminate — General Queue",
}

ATTR_SCALE = {"left": "delivery confidence", "right": "WISMO risk"}

# Delivery context decays in hours/days, not weeks.
PARAMS_OVERRIDES = {"lambda_decay_per_day": 0.45, "sigmoid_k": 10.0, "drift_scale": 0.155}

AXES = [
    {
        "id": "wismo_risk",
        "label": "WISMO Risk",
        "short": "WISMO",
        "polarity": "positive",
        "phrases": [
            "checking the order tracking page again and again",
            "asked where is my order",
            "searching how to contact the courier",
            "worried the package is delayed",
            "refreshing the delivery status repeatedly",
            "complained about a late delivery",
            "opened the courier contact support page",
            "package still not arrived and getting impatient",
        ],
    },
    {
        "id": "order_engagement",
        "label": "Order Engagement",
        "short": "Engagement",
        "polarity": "neutral",
        "phrases": [
            "opened the order details page",
            "browsing the store while waiting for a delivery",
            "viewed the past orders list",
            "read the returns policy casually",
            "added items to the wishlist",
            "opened the app from a promotion",
            "checked loyalty points balance",
            "normal shopping session in the app",
        ],
    },
    {
        "id": "delivery_confidence",
        "label": "Delivery Confidence",
        "short": "Confidence",
        "polarity": "negative",
        "phrases": [
            "carrier scan shows the package on schedule",
            "out for delivery and arriving on time",
            "delivery notifications are enabled and working",
            "package picked up on time by the courier",
            "previous orders all arrived on time",
            "estimated delivery date confirmed",
            "buyer opted into automatic delivery updates",
            "smooth delivery experience with no issues",
        ],
    },
]

BUSINESS = {
    "problem": (
        "WISMO (“where is my order?”) is commonly cited at 30–40% of all e-commerce "
        "support tickets, and every one is a human conversation about information the "
        "platform already had."
    ),
    "approach": (
        "Spot the anxiety before the ticket exists and answer proactively; stay silent "
        "for confident buyers so outreach never creates the worry it prevents."
    ),
    "rows": [
        {"metric": "Cost per WISMO contact", "traditional": "$4–6 per human-handled ticket (chat/email), more by phone", "contextlens": "≈$0: one push notification, triggered by a fraction-of-a-cent inference"},
        {"metric": "Timing", "traditional": "Reactive — after the buyer is already frustrated", "contextlens": "Proactive — at the anxiety signal, before the contact form"},
        {"metric": "Blast risk", "traditional": "Mass “it's on its way!” emails to everyone, training buyers to ignore them", "contextlens": "Suppressed when delivery confidence dominates — silence is a feature"},
    ],
    "econ": {"traditional_cost_usd": 5.0, "traditional_unit": "human-handled WISMO ticket", "resolution_label": "deflection decisions"},
    "math_note": (
        "Order-of-magnitude: 10k orders/month at an 8% WISMO rate is ~800 tickets ≈ "
        "$4,000/month of handling; deflecting 40% of them saves ~$1,600/month per 10k "
        "orders — against pennies of inference."
    ),
}

SCENARIOS = [
    {
        "id": "baseline",
        "label": "Delivery delay session",
        "button": "▶ Play delivery-delay session",
        "description": (
            "A carrier delay lands while the buyer is already refreshing the "
            "tracking page. Signals agree — WISMO contact is imminent, so the "
            "system moves before the ticket exists."
        ),
        "events": [
            {
                "id": "m_b1",
                "t_offset_ms": 400,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "tracking_page_view",
                "age_days": 0,
                "payload": {
                    "screen": "order tracking — where is my package",
                    "action": "asked where is my order",
                    "views_today": 4,
                    "dwell_seconds": 95,
                },
            },
            {
                "id": "m_b2",
                "t_offset_ms": 2200,
                "source": "cloud",
                "source_label": "carrier_webhook_cloud",
                "event_type": "carrier_webhook",
                "age_days": 0,
                "payload": {
                    "status": "exception — package delayed at sort facility",
                    "carrier": "regional express",
                    "new_eta": "2 days late",
                },
            },
            {
                "id": "m_b3",
                "t_offset_ms": 4000,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "app_search",
                "age_days": 0,
                "payload": {
                    "query": "contact courier about delayed order",
                    "results_clicked": 2,
                },
            },
            {
                "id": "m_b4",
                "t_offset_ms": 5800,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "tracking_page_view",
                "age_days": 0,
                "payload": {
                    "screen": "order tracking — refreshed again within the hour",
                    "concern": "worried the package might be lost",
                    "views_today": 5,
                },
            },
            {
                "id": "m_b5",
                "t_offset_ms": 7600,
                "source": "cloud",
                "source_label": "crm_webhook_cloud",
                "event_type": "crm_event",
                "age_days": 1,
                "payload": {
                    "type": "delivery feedback from last order",
                    "note": "buyer rated delivery speed 2 of 5 stars",
                },
            },
        ],
    },
    {
        "id": "conflict",
        "label": "Anxious buyer, calm carrier",
        "button": "⚡ Inject conflicting signals",
        "description": (
            "The carrier's day-old scans say everything is on time; the buyer's "
            "live behavior says they're getting anxious anyway. Fast decay sides "
            "with the fresh anxiety — but automation is muted while sources disagree."
        ),
        "events": [
            {
                "id": "m_c1",
                "t_offset_ms": 400,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "tracking_page_view",
                "age_days": 0,
                "payload": {
                    "screen": "order tracking — checked again this morning",
                    "concern": "starting to worry about the delay",
                    "views_today": 3,
                },
            },
            {
                "id": "m_c2",
                "t_offset_ms": 2200,
                "source": "cloud",
                "source_label": "carrier_webhook_cloud",
                "event_type": "carrier_webhook",
                "age_days": 2,
                "payload": {
                    "status": "scan on schedule — arriving on time",
                    "checkpoint": "regional hub departure",
                },
            },
            {
                "id": "m_c3",
                "t_offset_ms": 4000,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "app_search",
                "age_days": 0,
                "payload": {
                    "query": "how to contact courier support",
                },
            },
            {
                "id": "m_c4",
                "t_offset_ms": 5800,
                "source": "cloud",
                "source_label": "carrier_webhook_cloud",
                "event_type": "carrier_webhook",
                "age_days": 2,
                "payload": {
                    "status": "picked up on time by the courier",
                    "checkpoint": "origin scan",
                },
            },
            {
                "id": "m_c5",
                "t_offset_ms": 7600,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "tracking_page_view",
                "age_days": 0,
                "payload": {
                    "screen": "order tracking — courier contact page opened",
                },
            },
            {
                "id": "m_c6",
                "t_offset_ms": 9400,
                "source": "cloud",
                "source_label": "crm_webhook_cloud",
                "event_type": "crm_event",
                "age_days": 2,
                "payload": {
                    "type": "notification opt-in confirmed",
                    "note": "buyer receives automatic delivery updates",
                },
            },
        ],
    },
    {
        "id": "sparse",
        "label": "Sparse / early order",
        "button": "🛑 Feed sparse, early signals",
        "description": (
            "Label barely created, one casual app open. Nothing to infer from — "
            "the honest answer is the general queue, not a guessed intervention."
        ),
        "events": [
            {
                "id": "m_s1",
                "t_offset_ms": 400,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "app_open",
                "age_days": 1,
                "payload": {
                    "screen": "home",
                    "dwell_seconds": 8,
                },
            },
            {
                "id": "m_s2",
                "t_offset_ms": 2200,
                "source": "cloud",
                "source_label": "carrier_webhook_cloud",
                "event_type": "carrier_webhook",
                "age_days": 3,
                "payload": {
                    "status": "label created",
                    "checkpoint": "pre-transit",
                },
            },
            {
                "id": "m_s3",
                "t_offset_ms": 4000,
                "source": "device",
                "source_label": "app_sdk_edge",
                "event_type": "order_history_view",
                "age_days": 2,
                "payload": {
                    "screen": "past orders list",
                    "dwell_seconds": 20,
                },
            },
            {
                "id": "m_s4",
                "t_offset_ms": 5800,
                "source": "cloud",
                "source_label": "marketing_webhook_cloud",
                "event_type": "marketing_event",
                "age_days": 4,
                "payload": {
                    "type": "email opened",
                    "campaign": "weekend deals",
                },
            },
        ],
    },
]
