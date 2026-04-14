# [Feature Title]

**Spec file:** `_specs/[feature-slug].md`  
**Branch:** `claude/feature/[feature-slug]`  
**Status:** Draft  
**Created:** [Date]  
**Author:** [Author]

---

## 1. Overview

> One paragraph. What is this feature, why does it exist, and what problem does it solve for the user. 
> Do not describe implementation — describe the outcome.

---

## 2. Context & Motivation

> Why now? What user pain or product gap is this addressing? Reference the persona(s) it serves.
> If this feature is tied to a specific product principle (advisory-first, read-only, deterministic analyzers, etc.), call it out here.

**Persona(s) affected:**
- [ ] On-call engineer (incident response)
- [ ] Database administrator (daily health check)
- [ ] Engineering manager (fleet overview)
- [ ] Platform engineer (100+ clusters)

**Product principle this touches:**
- [ ] Advisory-first (recommendations, never automation)
- [ ] Read-only and push-based (no infrastructure access)
- [ ] Deterministic analyzers find the truth (LLM explains only)
- [ ] No raw data storage (baselines and verdicts only)
- [ ] Insight over metrics (explain state, don't chart raw data)

---

## 3. User Stories

> Write from the user's perspective. Be specific about what they see, do, and get.

**Primary story:**
> As a [persona], I want to [action] so that [outcome].

**Supporting stories:**
> As a [persona], I want to [action] so that [outcome].
> As a [persona], I want to [action] so that [outcome].

---

## 4. Scope

### In scope
- [What this spec covers]

### Out of scope
- [What is explicitly not being built here]
- [What belongs in a future spec]

---

## 5. Functional Requirements

> Describe behaviour from the user's perspective. No code. No implementation details.
> Use MoSCoW prioritisation: Must Have / Should Have / Nice to Have / Out of Scope.

| Requirement | Priority | Notes |
|-------------|----------|-------|
| [Requirement description] | Must Have | |
| [Requirement description] | Should Have | |
| [Requirement description] | Nice to Have | |

---

## 6. UX & Interaction Design

> Describe what the user sees and how they interact. Reference existing UI patterns in the product where possible.
> If a Figma link was provided, paste it here and summarise the key design details.

**Figma reference:** [Link or "Not provided"]

**Design notes:**
- [Key layout or interaction detail]
- [Error states and edge cases]
- [Empty states]
- [Loading states]

**Entry points (how does the user get to this feature):**
- [Where in the app does this appear]

**Exit points (what happens after the user completes the action):**
- [Where does the user end up]

---

## 7. Data & Backend Considerations

> Describe what data is needed, what already exists, and what gaps exist.
> Reference existing tables, schemas, and API endpoints where relevant.
> Do NOT write code or implementation specifics — describe the need.

**Data this feature reads:**
- [Existing table/field or "New data required: [description]"]

**Data this feature writes:**
- [Existing table/field or "New data required: [description]"]

**API endpoints involved:**
- [Existing endpoint or "New endpoint needed: [description]"]

**Does this touch the data plane / control plane boundary?**
- [ ] Yes — describe what crosses the boundary and confirm it complies with the privacy principle
- [ ] No — purely control plane or purely UI

**Analyzer / verdict involvement:**
- [ ] This feature reads verdicts — which analyzers are involved?
- [ ] This feature writes verdicts — does it follow the append-only pattern?
- [ ] This feature triggers the LLM — confirm it only triggers on status change
- [ ] Not applicable

---

## 8. Non-Functional Requirements

| Requirement | Target | Notes |
|-------------|--------|-------|
| Latency | [e.g. "Verdict list must load in < 500ms"] | |
| Availability | [e.g. "Feature must degrade gracefully if backend is unavailable"] | |
| Privacy | [e.g. "No raw log content may be stored or displayed"] | |
| Backward compatibility | [e.g. "Must not break existing verdict display"] | |

---

## 9. Open Questions

> List anything that needs a decision before implementation can begin.
> Include who owns the decision and when it's needed by.

| Question | Owner | Needed by |
|----------|-------|-----------|
| [Question] | [Person/team] | [Phase / date] |

---

## 10. Acceptance Criteria

> How do we know this feature is done and working correctly?
> Write as testable statements: "Given X, when Y, then Z."

- [ ] Given [condition], when [action], then [expected result]
- [ ] Given [condition], when [action], then [expected result]
- [ ] Given [condition], when [action], then [expected result]
- [ ] All existing tests continue to pass
- [ ] Feature works in both light and dark mode
- [ ] Feature is accessible via keyboard navigation (if UI)

---

## 11. Dependencies

**Depends on (must be built first):**
- [Other spec or component this feature requires]

**Blocks (cannot be built until this is done):**
- [Other spec or component that depends on this]

---

## 12. Related Specs

- [Link to related spec files in _specs/]

---

*DB Intelligence Platform — Internal use only*
