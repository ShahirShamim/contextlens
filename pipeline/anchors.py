"""Semantic axis definitions for the ContextLens intent space.

Each axis is defined by a set of anchor phrases. The pipeline embeds every
phrase, averages them into an axis centroid, and scores incoming signals by
cosine similarity to each centroid. The phrases below are authored for a
telco subscriber domain; swapping this file re-targets the whole demo to a
different vertical without touching the engine.
"""

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
