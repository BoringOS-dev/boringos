# BoringOS
### The harness is the brain. Everything else is a plugin.

---

## The Shift Nobody Has Seen Yet

Every company in enterprise software is making the same mistake: **bolting AI onto product.**

Salesforce added Einstein. HubSpot added AI. Notion added AI. ServiceNow added AI. Every incumbent took their existing product and asked: *where does AI fit inside this?*

That is the wrong question. And it will cost all of them.

**The right question is: what happens when the harness becomes the product?**

Claude CLI, Codex, Gemini CLI — these are not features. They are reasoning engines. And the moment a business points one of these harnesses at its operations and says *"run"* — the apps become irrelevant as systems. They become context. They become plugins.

The harness does not live inside your CRM. **Your CRM lives inside the harness.**

---

## What This Looks Like in Practice

A task is created. Instead of a human opening an app to work on it — the task opens a harness session. The harness gets full business context: the task, the history, the memory, the relevant data from every connected app. It reasons. It acts. It comes back only when a human decision is required.

The harness is not locked to one model. Businesses choose theirs — Claude, Codex, Gemini, Ollama, their own. The harness is swappable. What is not swappable is the infrastructure that connects the harness to the business: the sessions, the memory, the workflows, the event bus, the app context.

**That infrastructure is BoringOS.**

```
Business process
    │
    ▼
Task → Harness session opens
    │
    ├── Harness receives full business context
    ├── Harness reasons, acts, delegates
    ├── DAG workflows sequence multi-step, multi-harness work
    ├── Events flow between processes automatically
    ├── Memory persists — harness knows the business, not just the task
    │
    ▼
Human receives decision point only
    │
    ▼
Human responds → harness continues
    │
    ▼
Done.
```

Apps — CRM, Accounts, Finance, HR — are plugins that provide context to the harness and receive actions back. They are not the system. The harness is the system.

---

## Why Broad Beats Niche — And Why Everyone Else Is Getting This Wrong

Every AI startup is picking a niche. AI for CRM. AI for finance. AI for legal. AI for HR.

This is the wrong move. Here is why:

The harness does not care about niche. When a business gives a harness access to its CRM data, its financial data, its HR data, its email, its calendar — the harness reasons across all of it simultaneously. The AI-for-CRM company just lost. Because the harness already covers CRM, and ten other domains, with no additional cost.

**The company that owns the harness orchestration layer — the OS that connects any harness to any business process — wins all the niches at once.** Without building any of them.

The incumbents cannot respond. Salesforce cannot strip out Salesforce and lead with harness. They are the product. They cannot become the platform. They will spend the next five years adding AI features to a fundamentally app-centric architecture while businesses quietly migrate to a harness-first model and use Salesforce as a context plugin.

---

## What We Are Building

BoringOS is the operating layer that connects harnesses to business operations.

- **Runtime:** Any harness — Claude CLI, Codex, Gemini, Ollama, custom — plugs in as an adapter. Businesses are not locked to one model.
- **Sessions:** Every task becomes a harness session with full persistent context. Memory survives across runs.
- **Orchestration:** DAG workflows sequence multi-step, multi-harness processes. Events trigger sessions automatically. Approvals surface only when human judgment is required.
- **Apps as plugins:** CRM, Accounts, Finance, HR — each is a context provider and action surface for the harness. They install into the OS, not the other way around.
- **Hosted platform:** BoringOS ships as a hosted product. Shell live. Apps install from a marketplace. Third-party developers build on the same SDK.

---

## The Timing

Harnesses are production-ready today. Claude CLI, Codex — businesses are already running them on real work. What does not exist is the infrastructure that makes them safe, persistent, auditable, and connected to business operations at scale.

That infrastructure will be built in the next 18 months. It will be built once. **The company that builds it first, broadly, wins permanently.**

All others are focused on niche. Nobody is focused on the layer beneath the niche. That is the gap. That is where we are.

---

## Traction

- Harness runtime live: 6 adapters (Claude, Codex, Gemini, Ollama, command, webhook), DAG engine, event bus, session memory, multi-tenant
- CRM running as first plugin in private beta
- [X] design partners running harness sessions on real business work
- Platform SDK v1 drafted; marketplace architecture complete

---

## The Ask

Raising **$[X]M seed.** Ship the shell (Q2). CRM public beta (Q3). Two additional plugins (Q4). Open marketplace (Q1 next year).

Goal by end of year: **businesses running BoringOS as their primary operating layer** — not as one tool among many, but as the OS the harness runs on.

---

## The Endgame

Windows did not compete with Word. Word ran on Windows.

iOS did not compete with Instagram. Instagram ran on iOS.

**BoringOS does not compete with Salesforce. Salesforce runs on BoringOS.**

---

*BoringOS — parag@dpsn.org*
