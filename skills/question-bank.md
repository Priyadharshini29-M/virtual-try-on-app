# Question Bank

Categories of architecture questions. Use them as **templates**: fill every `<…>` with real names from `.claude/arch-map.md`. Pick only the categories the feature actually touches.

Each category lists a template, the tempting wrong answers to offer as distractors, and what a good answer shows.

---

## 1. Placement & layering
**Template:** "The new `<feature>` needs `<logic>`. In this repo, `<layer A at path>` handles X and `<layer B at path>` handles Y. Where should it go?"
**Tempting wrong answers:** put business logic in the controller/handler/component; call the DB directly from the route; create a new top-level folder that breaks the existing structure.
**Good answer shows:** they know each layer's responsibility and the direction dependencies flow.

## 2. Reuse vs. new code
**Template:** "`<existing module/helper at path>` already does something similar. Do you extend it, wrap it, or write a new one?"
**Tempting wrong answers:** copy-paste and tweak; modify a shared module in a way that breaks other callers.
**Good answer shows:** they checked for existing code and thought about who else depends on it.

## 3. Data access & modelling
**Template:** "`<feature>` needs `<data>`. The repo accesses data through `<repository/ORM/DAO/query layer at path>`. How do you fetch it, and do you need a schema change?"
**Tempting wrong answers:** raw queries outside the data layer; a query in a loop (N+1); a migration that isn't backward-compatible with running code.
**Good answer shows:** awareness of the data layer, performance and migrations.

## 4. Data flow & contracts
**Template:** "`<module A>` needs data from `<module B>`. Do you call it directly, go through `<API/interface/event at path>`, or share the model?"
**Tempting wrong answers:** reaching into another module's internals; sharing database tables across service boundaries; leaking internal models in a public API.
**Good answer shows:** they respect boundaries and keep contracts explicit.

## 5. Sync vs. async
**Template:** "`<operation>` can be slow or can fail (e.g. calls `<external service>`). The repo has `<queue/job/worker/event bus at path, or none>`. Do it inline or in the background?"
**Tempting wrong answers:** a slow external call inside the request path; fire-and-forget with no retry or visibility; adding a queue to a repo that has none for something trivial.
**Good answer shows:** they weigh latency, reliability, and the infrastructure that actually exists.

## 6. Validation & input trust
**Template:** "Where is input validated in this repo (`<path>`)? Where should validation for `<new field/input>` go?"
**Tempting wrong answers:** validating only in the UI; validating in several layers inconsistently; trusting data from another service.
**Good answer shows:** one clear trust boundary that matches the repo.

## 7. Error handling & failure modes
**Template:** "If `<dependency>` fails during `<feature>`, what should the user/caller see? This repo handles errors via `<pattern at path>`."
**Tempting wrong answers:** swallowing exceptions; returning a 200 with an error body when the repo uses status codes (or vice versa); leaking stack traces.
**Good answer shows:** they follow the repo's error pattern and think about partial failure.

## 8. State management (UI / client repos)
**Template:** "`<new UI state>` is needed by `<components>`. The repo uses `<local state/store/context/server cache at path>`. Where does it live?"
**Tempting wrong answers:** global state for something local; duplicating server data in a client store when the repo uses a server cache; prop-drilling through many levels.
**Good answer shows:** they understand ownership and lifetime of state.

## 9. Configuration & secrets
**Template:** "`<feature>` needs `<API key/URL/flag>`. How does this repo handle config (`<path>`)?"
**Tempting wrong answers:** hardcoding; committing secrets; reading env vars directly in deep business logic when the repo centralises config.
**Good answer shows:** they use the repo's config mechanism and keep secrets out of code.

## 10. Security & access control
**Template:** "Who is allowed to `<action>`? Where does this repo enforce authorization (`<middleware/guard/policy at path>`)?"
**Tempting wrong answers:** checking permissions only in the UI; ad-hoc checks inside business logic that bypass the central mechanism.
**Good answer shows:** they know where auth is enforced and don't create side doors.

## 11. Testing
**Template:** "What tests does `<feature>` need? The repo tests `<layer>` with `<style at path>`."
**Tempting wrong answers:** only end-to-end tests for pure logic; mocking the thing under test; no test for the failure path.
**Good answer shows:** a test plan matching the repo's pyramid that covers the risky parts.

## 12. Scaling & performance
**Template:** "If `<feature>` gets 100x the traffic/data, what breaks first in the current design (`<path>`)?"
**Tempting wrong answers:** premature caching or sharding; ignoring an obvious hot path.
**Good answer shows:** they find the real bottleneck and know when *not* to optimise yet.

## 13. Observability
**Template:** "How would you know `<feature>` is failing in production? The repo logs/metrics via `<path>`."
**Tempting wrong answers:** `print`/`console.log`; logging sensitive data; no logging on the failure path.
**Good answer shows:** they use existing logging and metrics and think about debugging later.

## 14. Change safety & rollout
**Template:** "`<feature>` changes `<shared contract/schema/API>`. How do you ship it without breaking `<consumers>`?"
**Tempting wrong answers:** breaking change in one deploy; no feature flag when the repo uses them.
**Good answer shows:** backward compatibility, migration order, flags.

---

## Quiz-mode extras (existing architecture, no feature)
- "Trace what happens when `<real entry point>` is called. Which files run, in order?"
- "Why do you think the repo separates `<A>` and `<B>`? What would break if they were merged?"
- "The map lists `<inconsistency>`. Which version should new code follow, and why?"
- "If you had to add a new `<module type>`, which existing one would you copy as a template?"
