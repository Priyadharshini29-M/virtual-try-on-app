# Principles for Feedback

General architecture principles used in Phase 3. They apply to any stack.

**Priority order when judging an answer:**
1. Correctness and security
2. Consistency with this repo's conventions
3. The general principles below
4. Personal preference (never grade on this)

When the repo and a principle conflict, explain both and recommend. Don't just override the repo.

---

## Structure
- **Single responsibility.** Each module, layer or component has one reason to change. Signal of trouble: a file that both parses HTTP and writes SQL.
- **Dependency direction.** High-level policy shouldn't depend on low-level details. Inner layers (domain/business) don't import outer layers (web, DB, UI frameworks).
- **Cohesion over scattering.** Code that changes together lives together. Feature-based and layer-based folders are both valid; mixing them randomly is not.
- **Explicit boundaries.** Modules talk through defined interfaces, APIs or events, not by reaching into each other's internals or tables.

## Change
- **Don't Repeat Yourself, but don't over-abstract.** Duplicate twice before abstracting; abstract when the third copy appears or the rules are truly shared.
- **Backward compatibility.** Shared contracts (APIs, schemas, events, public functions) change additively first; remove later.
- **Smallest change that fits the design.** Prefer extending existing patterns over introducing new frameworks, layers or infrastructure.

## Data
- **One owner per piece of data.** One module or service is the source of truth; others ask or subscribe.
- **Validate at the trust boundary.** Validate once where untrusted data enters; inner code can then trust it.
- **Watch the access pattern.** Queries in loops, unbounded result sets and missing indexes are the most common performance bugs.

## Reliability
- **Fail loudly, recover deliberately.** Don't swallow errors. Handle them where you can actually do something; otherwise propagate them.
- **External calls fail.** Every network or third-party call needs a timeout and a decision about retries and what the user sees.
- **Slow or unreliable work leaves the request path** when the repo has the infrastructure for it and the latency matters.
- **Idempotency** for anything retried (jobs, webhooks, payments).

## Security
- **Never trust the client.** Authorization is enforced server-side, in the repo's central mechanism.
- **Secrets never in code or logs.** Use the repo's config/secret mechanism.
- **Least privilege** for services, tokens and DB users.

## Testability
- **Business logic should be testable without the framework, network or database.** If it isn't, it's probably in the wrong layer.
- **Test the risky paths:** failure cases, boundaries and permissions, not just the happy path.

## Pragmatism
- **YAGNI.** Don't add caching, queues, microservices or generic frameworks for problems the feature doesn't have yet.
- **Context beats dogma.** A small script, a prototype and a payments system deserve different rigor. Calibrate feedback to what the repo is.
- **Consistency is a feature.** A slightly worse pattern used everywhere is often better than a better pattern used in one place. Say this explicitly when it applies.

---

## Verdict guide
- ✅ **Fits:** matches repo conventions and violates no principle above.
- ⚠️ **Works but risky:** functional but adds coupling, inconsistency, a performance trap or a future-maintenance cost. Name the specific risk.
- ❌ **Breaks the design:** violates correctness, security, a layer boundary or data ownership, or will cause bugs. Explain the concrete failure.
