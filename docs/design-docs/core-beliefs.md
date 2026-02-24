# Core Beliefs

Operating principles for this project's documentation and agent workflow.

## Repository Is the System of Record

Anything an agent can't access in-context while running effectively doesn't exist.
Knowledge that lives in chat threads, documents, or people's heads is not accessible.
Repository-local, versioned artifacts (code, markdown, schemas, executable plans) are all the agent can see.

## CLAUDE.md Is a Map, Not a Manual

CLAUDE.md stays under 120 lines. It tells agents WHERE to look, not HOW to do things.
Detailed guidance lives in Tier 2 summaries and Tier 3 deep docs.

## Plans Are Living Documents

Execution plans accumulate progress, surprises, decisions, and drift during implementation.
They are updated at every stopping point, not reconstructed after the fact.

## Reflect Early and Often

Lightweight reflection runs after each task to catch stale docs immediately.
Full reflection runs at completion to mine for deeper learnings.

## Structure Prevents Decay

Semantic categories (architecture, design, plans, references) tell agents and humans
what belongs where. A flat "guides/" directory decays into a junk drawer.
