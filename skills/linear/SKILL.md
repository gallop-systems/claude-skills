---
name: linear
description: Create, triage, and manage Linear issues at Gallop Systems following the team's workflow conventions — cycle placement, issue templates, project/milestone hierarchy, and project refresh / cycle rebalance procedures. Use whenever the user asks for Linear work (creating issues, planning cycles, refreshing projects) on a Gallop client.
---

# Linear Project Management — Team Workflow & CLI Guide

## First-time Setup (run once per user)

### Check 1 — Workspace bootstrap config exists

Before running any bash helper from `linear.sh`, verify that the per-user workspace config exists at `~/.config/linctl/workspace.json` (override path with `$LINCTL_WORKSPACE_FILE`). This file holds the team UUID, the Linear member UUIDs that play the Frontend/PM and Backend roles, and the workflow-state and label UUIDs the helpers depend on. Without it, every bash helper that references `$TEAM_ID`, `$MEMBER_FRONTEND`, `$MEMBER_BACKEND`, `$STATE_*`, or `$LABEL_*` will silently misbehave.

```bash
[ -f "${LINCTL_WORKSPACE_FILE:-$HOME/.config/linctl/workspace.json}" ] && echo "ok" || echo "missing"
```

**If missing,** instruct the user to run:

```bash
source linear.sh && linctl_init
```

`linctl_init` calls Linear's GraphQL API, lists the workspace's members, and prompts the user to designate (1) the Frontend/PM lead and (2) the Backend lead by number. It then writes `~/.config/linctl/workspace.json`. After it finishes, re-source `linear.sh` so the new variables are exported.

### Check 2 — Linear MCP server installed and authorized

This skill routes most operations through `mcp__linear-server__*` tools. Before doing any Linear work, verify the MCP server is available:

- **Not installed:** if no `mcp__linear-server__*` tools appear in your toolset, stop and tell the user: *"This skill needs Linear's MCP server. Install it with `claude mcp add --transport sse linear https://mcp.linear.app/sse`, restart Claude Code, then tell me to continue."* Don't try to fall back to `linear.sh` for everything — the bash script only covers a small subset of operations.
- **Installed but not authorized:** if a `mcp__linear-server__*` call returns an auth/OAuth error, tell the user: *"The Linear MCP server is installed but not authorized. The next call will open a browser to sign in — please complete OAuth, then tell me to continue."*

Don't silently skip these checks. A user who hits an MCP error mid-task without context will be confused.

### Check 3 — `LINEAR_API_KEY` for bash fallback helpers

`linear.sh` reads `LINEAR_API_KEY` from the shell environment. Before using any bash helper, check whether it's set:

```bash
[ -n "$LINEAR_API_KEY" ] && echo "set" || echo "missing"
```

**If missing, onboard the user:**

1. Tell them: *"I need a Linear personal API key to run the bash helpers. Create one at https://linear.app/settings/account/security (click 'New API key', name it 'Claude Code', copy the `lin_api_...` token), then paste it here in chat."*
2. When they paste the key, install it into `~/.zshenv` so every future shell — including the ones Claude Code spawns — picks it up automatically:
   ```bash
   echo 'export LINEAR_API_KEY=lin_api_THEIR_KEY_HERE' >> ~/.zshenv
   ```
   (Use `~/.bashrc` instead if the user is on bash.)
3. Export it in the current shell too so the next tool call works without restart:
   ```bash
   export LINEAR_API_KEY=lin_api_THEIR_KEY_HERE
   ```
4. Verify with a harmless call: `source linear.sh && linear_list_members | head`.

**Never commit the key, never write it into `.env` or any project file** — `~/.zshenv` is the single source of truth.

---

## Team Overview

- **Workspace Team Key:** `GAL`
- **Team Size:** 2 members
- **Sprint Cycle:** 2 weeks
- **Stack:** Nuxt 3 / Vue (frontend + Nitro API backend)
- **Work Type:** Client/agency projects

### Team Roles

| Role | Responsibilities |
|------|-----------------|
| **Frontend/PM Lead** | Frontend development, requirement gathering, project design, client communication, light backend (e.g., adding endpoints), issue triage, client IT coordination (DNS, infrastructure requests) |
| **Backend Lead** | Data modeling, database design, backend architecture, API logic |

The Frontend/PM lead triages incoming client requests and translates them into Linear issues.

On first run, `linctl_init` binds these roles to specific Linear members; Claude reads `~/.config/linctl/workspace.json` to know who they are. The shell variables `$MEMBER_FRONTEND` and `$MEMBER_BACKEND` resolve to the corresponding Linear user UUIDs.

---

## Workflow Statuses

| Status | Meaning |
|--------|---------|
| **Backlog** | Captured but not yet planned for a cycle |
| **Todo** | Committed to the current or next cycle |
| **In Progress** | Actively being worked on |
| **In Review** | Code complete, awaiting review or client feedback |
| **Done** | Shipped and verified |
| **Canceled** | Dropped or no longer relevant |

> **Note:** "In Review" is a recommended addition to the default Linear statuses. It provides a clear handoff point for code review between the two team members and for client sign-off.

---

## Priority Levels

| Priority | When to Use |
|----------|-------------|
| **Urgent** | Production issues, client-blocking bugs, deadline-critical items |
| **High** | Current sprint commitments, important client deliverables |
| **Medium** | Planned work, non-blocking improvements |
| **Low** | Nice-to-haves, tech debt, internal tooling |

---

## Labels (Recommended)

### By Type
- `bug` — Something is broken
- `feature` — New functionality
- `improvement` — Enhancement to existing functionality
- `chore` — Maintenance, config, devops, dependencies
- `spike` — Research or investigation task

### By Domain
- `frontend` — UI/UX, Vue components, pages, styling
- `backend` — API, database, data modeling, server logic
- `fullstack` — Touches both frontend and backend

---

## Estimation (T-Shirt Sizes)

| Size | Meaning | Rough Effort |
|------|---------|-------------|
| **S** | Small, well-understood task | A few hours |
| **M** | Medium complexity, clear scope | Half a day to a full day |
| **L** | Large, may span multiple days | 2–3 days |
| **XL** | Very large — consider breaking down | 3+ days, likely needs subtasks |

If an issue is XL, break it into smaller sub-issues before starting work.

---

## Sprint Cycle Process

### Cycle Start (Every 2 Weeks)
1. Review **Backlog** — pull items into **Todo** for the cycle
2. Assign issues to the appropriate team member based on domain (backend vs. frontend)
3. Ensure each issue has: priority, estimate, label(s), and assignee
4. Keep cycle scope realistic — a 2-person team should commit to what's achievable

### During the Cycle
- Move issues to **In Progress** when you start working on them
- Move to **In Review** when code is ready for review or client feedback
- Move to **Done** when merged/deployed and verified
- If scope changes, add new issues to **Backlog** unless they're urgent

### Cycle End
- Review what got done vs. what was planned
- Move incomplete **Todo** / **In Progress** items to the next cycle or back to **Backlog**
- Archive the completed cycle

---

## Linear Tooling — MCP First, `linear.sh` as Fallback

**Default to the Linear MCP server (`mcp__linear__*` tools)** for all standard operations: creating/updating issues, listing projects/milestones/cycles/initiatives/labels/users, comments, etc. The MCP tools take strings directly — pass real markdown with real newlines, no JSON-escaping.

**Use `linear.sh` only for things MCP doesn't expose:**
- `linear_cycle_capacity` — velocity-based capacity % (used in cycle placement & rebalancing)
- `linear_batch_move_to_cycle` / `linear_batch_move_to_milestone` — rate-limit-aware bulk moves
- `linear_add_dependency` / `linear_remove_dependency` / `linear_list_dependencies` — issue relations
- `linear_add_initiative_link` — adding external links to initiatives
- `linear_api` — raw GraphQL escape hatch

**Mapping** of common bash → MCP equivalents lives in `MEMORY.md`. The sections below document the bash CLI for the fallback paths and for reference; prefer the MCP tool whenever one exists.

### Setup (`linear.sh`)
The team's `linear.sh` shell script wraps the Linear GraphQL API.
**Setup:** API key is stored in `.env` as `LINEAR_API_KEY`.

### Loading
```bash
source linear.sh
# Output: "Linear CLI loaded. Workspace config: ~/.config/linctl/workspace.json ..."
```

### Constants (available after sourcing — populated from `workspace.json`)
```bash
# Members (resolved from roles.frontend_lead / roles.backend_lead)
$MEMBER_FRONTEND  # Frontend/PM lead
$MEMBER_BACKEND   # Backend lead

# Workflow states
$STATE_BACKLOG  $STATE_TODO  $STATE_IN_PROGRESS  $STATE_IN_REVIEW  $STATE_DONE  $STATE_CANCELED

# Labels
$LABEL_DISCOVERY  $LABEL_TECH_DEBT  $LABEL_BACKEND  $LABEL_FRONTEND
$LABEL_DB  $LABEL_BUG  $LABEL_FEATURE  $LABEL_IMPROVEMENT
```

### Creating Issues

> **Important:** When assigning an issue to a cycle, always set `stateId=$STATE_TODO`. Issues default to Backlog, which doesn't work with cycles — they must be in Todo status.
>
> **Required placement rule:** Never create an issue without both a `projectId` and a `projectMilestoneId`. If the right project does not exist, create it first. If the project exists but the right milestone does not, create the milestone first. Do not leave issues unscoped or unmilestoned.

```bash
# Use linear_json helper to build JSON, then pass to linear_create_issue
# Note: stateId=$STATE_TODO is required when using cycleId
# Note: projectId and projectMilestoneId are always required
linear_create_issue "$(linear_json \
  title='Add user profile page' \
  description='Create /profile page with user info and settings' \
  priority=2 \
  stateId=$STATE_TODO \
  assigneeId=$MEMBER_FRONTEND \
  labelIds=$LABEL_FEATURE,$LABEL_FRONTEND \
  estimate=3 \
  projectId='project-uuid-here' \
  projectMilestoneId='milestone-uuid-here' \
  cycleId='cycle-uuid-here')"

# Create a bug report
linear_create_issue "$(linear_json \
  title='Fix: login redirect fails on Safari' \
  description='Users on Safari not redirected after login. Reproduced on Safari 17.' \
  priority=1 \
  stateId=$STATE_TODO \
  assigneeId=$MEMBER_FRONTEND \
  labelIds=$LABEL_BUG,$LABEL_FRONTEND \
  projectId='project-uuid-here' \
  projectMilestoneId='milestone-uuid-here' \
  cycleId='cycle-uuid-here')"

# If the project or milestone does not exist yet, create it before the issue
PROJECT_ID="$(linear_create_project "[CLIENT] Feature Area" "" "Short description" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['projectCreate']['project']['id'])")"
MILESTONE_ID="$(linear_create_milestone "$PROJECT_ID" "Phase 1" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['project']['projectMilestones']['nodes'][-1]['id'])")"
linear_create_issue "$(linear_json \
  title='Investigate performance issue' \
  stateId=$STATE_TODO \
  projectId="$PROJECT_ID" \
  projectMilestoneId="$MILESTONE_ID" \
  cycleId='cycle-uuid-here')"
```

### Priority Values
- `0` = No priority
- `1` = Urgent
- `2` = High
- `3` = Medium
- `4` = Low

### Listing & Filtering Issues
```bash
# List all issues (pretty table)
linear_list_issues_pretty

# Filter by state type: backlog, unstarted, started, completed, canceled
linear_list_issues_pretty "started"

# List issues in current cycle
linear_list_cycle_issues | python3 -m json.tool

# Raw JSON output (for piping)
linear_list_issues              # all
linear_list_issues "started"    # filtered by state type
```

### Updating Issues
```bash
# Move issue by status name
linear_move_issue "issue-uuid" "In Progress"
linear_move_issue "issue-uuid" "Done"

# Assign to a team member by role
linear_assign_issue "issue-uuid" "frontend"
linear_assign_issue "issue-uuid" "backend"

# General update (raw JSON)
linear_update_issue "issue-uuid" '{"priority":1,"stateId":"'"$STATE_TODO"'"}'
```

### Issue Dependencies
```bash
# Create a "blocks" dependency (backend blocks frontend)
linear_add_dependency "$BLOCKER_ISSUE_ID" "$BLOCKED_ISSUE_ID"

# List all dependencies for an issue (both directions)
linear_list_dependencies "$ISSUE_ID"

# Remove a dependency by relation UUID (get UUID from linear_list_dependencies)
linear_remove_dependency "$RELATION_ID"
```

### Comments
```bash
# Add a comment to an issue
linear_add_comment "$ISSUE_ID" "Comment body text here"
```

> **Note:** Always use `@` mentions when referring to team members in comments. Use the Linear `@` mention syntax with the team member's display name from `workspace.json`'s `roles` (e.g., `@<Frontend Lead Name>`, `@<Backend Lead Name>`) so they get properly notified.

### Searching
```bash
linear_search_issues "login bug"
```

### Projects & Milestones
```bash
# Create a new project (linked to an initiative)
linear_create_project "[KEY] Project Name" "$INITIATIVE_ID" "Short description"

# List all projects (pretty table with initiative, state, progress)
linear_list_projects_pretty

# List milestones within a project
linear_list_milestones_pretty "$PROJECT_ID"

# List issues grouped by milestone within a project
linear_list_project_issues_pretty "$PROJECT_ID"

# Raw JSON variants (for piping)
linear_list_projects
linear_list_milestones "$PROJECT_ID"
linear_list_project_issues "$PROJECT_ID" [limit]

# Create issue within a project/milestone
linear_create_issue "$(linear_json \
  title='Add feature X' \
  projectId='project-uuid' \
  projectMilestoneId='milestone-uuid' \
  priority=2 \
  assigneeId=$MEMBER_FRONTEND \
  labelIds=$LABEL_FEATURE)"
```

### Initiatives
```bash
# Create a new initiative (= new client)
linear_create_initiative "ClientName" "Short description"

# List all initiatives (pretty table with ID, status, description)
linear_list_initiatives_pretty

# Get full initiative detail by name (case-insensitive)
linear_get_initiative_by_name "Enhanced"

# Get full initiative detail by ID
linear_get_initiative "$INITIATIVE_ID"

# Update initiative content (markdown) or description
linear_update_initiative "$INITIATIVE_ID" '{"content":"# Updated notes\n\nNew content here"}'
linear_update_initiative "$INITIATIVE_ID" '{"description":"Short description"}'

# Add an external link (e.g., repo) as a resource on the initiative
linear_add_initiative_link "$INITIATIVE_ID" "https://github.com/org/repo" "GitHub Repo"

# Raw JSON of all initiatives
linear_list_initiatives
```

### Info Commands
```bash
linear_list_states    # Workflow states
linear_list_members   # Team members
linear_list_labels    # Labels
linear_list_cycles    # All cycles
linear_current_cycle_id  # Current active cycle UUID
```

---

## Issue Templates

> **Tech stack context:** All projects use Nuxt 4 + Nitro + Kysely + PostgreSQL + PrimeVue/Volt + Tailwind CSS v4. See `tech-stack.md` for full details.

### Issue Title Conventions

- **No client prefix** (e.g., ~~[ZLM]~~) — the project name already identifies the client.
- **No domain prefix** (e.g., ~~UI:~~, ~~API:~~) — labels (`frontend`, `backend`) already cover this.
- Titles should be concise and describe the feature/fix directly (e.g., "Add evaluator create form", "Fix login redirect on Safari").

### Client Feature Request — Frontend

> **Important:** Do NOT guess which pages/components need updating. Check the client's repo (`app/pages/`, `app/components/`) to identify the correct files and routes. If the repo is not accessible, add a **## To Determine** section listing what needs to be verified before work begins (e.g., "Which page renders the jobs list? Check repo.").

```
Title: Feature description
Priority: High (2) or Medium (3)
Labels: feature, frontend
Estimate: S/M/L/XL
Description:
  ## Context
  [Why does the client need this?]

  ## Requirements
  - [ ] Requirement 1
  - [ ] Requirement 2

  ## UI Notes
  - Page/route: `/path` ← verified from repo, NOT guessed
  - Components: [Which Volt components are relevant — VoltCard, VoltDataTable, etc.]
  - Follow DESIGN_LANGUAGE.md (zinc palette, no decorative shadows)

  ## To Determine (if repo not checked)
  - [ ] Which page/route handles this feature?
  - [ ] Which existing components need modification?

  ## Acceptance Criteria
  - [ ] What "done" looks like
```

### Client Feature Request — Backend / API

> **Note:** Backend issues should describe *what* functionality is needed, not *how* to implement it. The Backend lead knows which endpoints to create, how to structure handlers, and what validation to add. Focus the description on the functionality the backend needs to support and any business rules or constraints.

```
Title: Feature description
Priority: High (2) or Medium (3)
Labels: feature, backend
Estimate: S/M/L/XL
Description:
  ## Context
  [Why does the client need this? What problem does it solve for the client?]

  ## Functionality
  - [What the backend needs to support — describe the behavior, not the implementation]
  - [Business rules, constraints, edge cases]
  - [What data needs to be stored, returned, or transformed]
  - [Auth considerations if non-standard (e.g., public access, webhook)]

  ## Acceptance Criteria
  - [ ] What "done" looks like from a functionality perspective
  - [ ] Tests written
```

### Fullstack Features — Split Into Separate Issues

When a feature requires both backend and frontend work, **always create separate issues** — one for backend and one for frontend. Link them using **Linear's dependency system** so the frontend issue is blocked by the backend issue.

> **Reminder:** For the frontend issue, verify affected pages/components from the client's repo. Don't guess file paths — check `app/pages/` and `app/components/` in the actual codebase.

This keeps issues focused, enables parallel assignment (the Backend lead on backend, the Frontend/PM lead on frontend), and makes progress tracking clearer. Using Linear dependencies (rather than just mentioning the dependency in the description) makes the blocking relationship visible in the UI, prevents the frontend issue from accidentally being started too early, and keeps the dependency machine-readable.

**Steps:**
1. Create the **backend issue** using the "Client Feature Request — Backend / API" template above (labels: `feature`, `backend`)
2. Create the **frontend issue** using the "Client Feature Request — Frontend" template above (labels: `feature`, `frontend`)
3. **Create the Linear dependency:** use `linear_add_dependency` so the backend issue blocks the frontend issue

```bash
# After creating both issues, link them:
linear_add_dependency "$BACKEND_ISSUE_ID" "$FRONTEND_ISSUE_ID"
# Result: backend blocks frontend (frontend is blocked by backend)
```

**Example:** "Add admin button to complete all job tasks"
- **Backend issue:** Support marking all tasks for a job as complete in a single operation; admin-only, should be atomic
- **Frontend issue:** Admin-only button on job page, confirmation dialog, API call, toast
- **Dependency:** `linear_add_dependency "$BACKEND_ID" "$FRONTEND_ID"`

> **Note:** If the feature is simple enough that the backend is trivial (e.g., a single straightforward CRUD endpoint), it's acceptable to create one combined issue assigned to the person doing both. Use your judgement.

### Bug Report
```
Title: Fix: brief description of the bug
Priority: Urgent (1) or High (2)
Labels: bug, frontend|backend
Description:
  ## Bug
  [What's happening vs. what should happen]

  ## Steps to Reproduce
  1. Step 1
  2. Step 2

  ## Environment
  [Browser, OS, user account, etc.]

  ## Likely Location
  - [File path if known, e.g., server/api/users/[id].get.ts or app/pages/users.vue]
```

### Backend / Data Modeling Task

> **Note:** Focus on *what* data needs to be modeled and *why*, not on prescribing specific schema details or endpoint structures. Include business context and constraints so the Backend lead can make the right design decisions.

```
Title: Description of the task
Priority: as appropriate
Labels: backend
Estimate: S/M/L/XL
Description:
  ## Objective
  [What data model or API change is needed and why]

  ## Requirements
  - [What data needs to be stored/tracked]
  - [Relationships to existing data (e.g., "each job has many tasks")]
  - [Business rules and constraints]
  - [Any existing data that needs migrating]

  ## Acceptance Criteria
  - [ ] What "done" looks like
  - [ ] Tests written
```

### Chore / Maintenance
```
Title: Chore: description
Priority: Medium (3) or Low (4)
Labels: chore, frontend|backend
Estimate: S/M/L
Description:
  ## What
  [What needs to be done]

  ## Why
  [Why it matters — tech debt, performance, DX, etc.]

  ## Files Affected
  - [List key files/directories]
```

---

## Assignment Guidelines

| Issue Type | Default Assignee |
|-----------|-----------------|
| Kysely migrations, schema design, complex DB queries | Backend lead |
| Complex Nitro API handlers (transactions, multi-table) | Backend lead |
| Vue pages, Volt components, Tailwind styling, UX | Frontend/PM lead |
| Simple CRUD API endpoint (single table, straightforward) | Either (Frontend/PM lead can handle) |
| Client requirement gathering, design | Frontend/PM lead |
| Bug — Kysely/DB/server middleware | Backend lead |
| Bug — Vue/PrimeVue/Tailwind/client-side | Frontend/PM lead |
| Bug — fullstack | Discuss, assign based on root cause |

---

## Post-Organization: Update Initiative in Linear

**After organizing issues for a client (creating, triaging, updating statuses, or completing a sprint review), always update the corresponding initiative's `content` field in Linear.**

### What to Update

The initiative `content` field stores **client-level context only** — NOT data already tracked elsewhere in Linear. Update:

1. **Overview** — Client description, domain context, business purpose
2. **Repo structure** — Routes, components, API endpoints, key files
3. **Tech stack deviations** — Anything different from the standard Gallop template
4. **Domain concepts** — Key entities and business logic specific to the client
5. **Notes** — High-level observations, architectural decisions, gotchas

**Do NOT put in initiative content:** Team members (already in Linear), repo links (use `linear_add_initiative_link` instead), project listings, milestone details, issue counts, progress percentages, remaining work, or any data already tracked in Linear's project/milestone/issue hierarchy.

### When to Update

- After creating a batch of new issues for a client
- After triaging/re-prioritizing a client's backlog
- After a sprint review or cycle close
- After marking significant issues as Done or Canceled
- Any time the initiative's content would be stale after your changes

### How to Get Current Data

Use the Linear CLI to query the initiative and pull fresh issue data:
```bash
source linear.sh
# Get the initiative's current content
linear_get_initiative_by_name "ClientName"
# List all issues to see current statuses
linear_list_issues_pretty
# Or check cycle-specific progress
linear_list_cycle_issues | python3 -m json.tool
```

Then update the initiative's content in Linear:
```bash
linear_update_initiative "$INITIATIVE_ID" '{"content":"updated markdown content here"}'
```

---

## Project & Milestone Hierarchy

Linear organizes work in a top-down hierarchy: **Initiative → Project → Milestone → Issue**. Here's how the Gallop team uses each level.

### Initiative (= Client)

An **Initiative** represents a client engagement or internal program. Each client gets one initiative.

**The current client roster is not stored in this repo — fetch it live from Linear.** Initiatives are the source of truth for which clients exist, their descriptions, and their repo links:

- **List all clients:** `mcp__linear-server__list_initiatives`
- **Read a client's full details (overview, repo structure, domain notes):** `mcp__linear-server__get_initiative` — these live in the initiative's `content` field
- **Get a client's repo URL:** read the `links` array on the initiative

When you start any task that needs client context, query Linear instead of looking for a hardcoded list. This keeps the skill in sync as clients are added or removed without repo changes.

- One initiative can contain **multiple projects**

### Project (= Product / Workstream)

A **Project** is a distinct product, app, or major workstream within a client initiative. It groups related issues that ship together.

**Examples:**
- `[GAL] Invoicing System` — one self-contained product
- `[GAL] AI Takeoff Demo` — separate product under the same client
- `[CLIENT] Migration Workstream` — the single workstream for that client
- `[CLIENT] Scheduling Platform` — the main product for that client

**When to create a new project:**
- The work has its own deployment, repo, or codebase
- It could be described independently to a stakeholder
- It has a distinct "done" state separate from other work

**Naming convention:** `[CLIENT_KEY] Project Name`

### Milestone (= Phase / Epic)

A **Milestone** is a phase or epic within a project — a meaningful chunk of progress that can be demoed or shipped incrementally.

**Examples within `[GAL] Invoicing System`:**
- `Core Invoicing` — create, edit, send invoices (done)
- `Proposals` — proposal workflow, create/edit/convert to invoice
- `Payments` — Zelle support, receipts, amount due display

**Examples within `[ENH] Evaluation Scheduling`:**
- `Evaluators Module` — list, create, edit, deactivate evaluators
- `Evaluation Requests` — request creation, accept/reject workflow
- `Scheduling & Calendar` — availability, scheduling UI

**When to create a milestone:**
- A logical group of 5–15 related issues
- Has a clear "phase complete" definition
- Can be reviewed/demoed as a unit
- Work within it is mostly sequential or tightly coupled

**Naming convention:** Short, descriptive noun phrase (no client key prefix needed since milestones live inside a project)

### Issue (= Task)

Individual work items live at the bottom of the hierarchy. Every issue belongs to a project and a milestone.

### Hierarchy in Practice

```
Initiative: Enhanced
  └── Project: [ENH] Evaluation Scheduling
        ├── Milestone: Evaluators Module
        │     ├── GAL-101: Create evaluators list page
        │     ├── GAL-102: Add evaluator create/edit form
        │     └── GAL-103: Evaluator deactivation support
        ├── Milestone: Evaluation Requests
        │     ├── GAL-110: Request creation form
        │     └── GAL-111: Accept/reject API endpoints
        └── Milestone: Notifications
              └── GAL-120: Set up Resend email service
```

### Guidelines for the Team

1. **Every issue must be placed into a cycle with Todo status.** **Do NOT default to the current/active cycle.** Follow this procedure: (a) Run `linear_cycle_capacity` to see each cycle's capacity % (velocity-based, from last 3 completed cycles). (b) Starting from the earliest (current) cycle, find the first cycle that is **strictly under 100%** capacity. (c) If the current cycle is at or above 100%, **skip it** and use the next cycle with room. Assign the issue there via `cycleId`. **Always set `stateId=$STATE_TODO`** — issues in Backlog don't work with cycles. **Exception:** High priority or above (priority ≤ 2: Urgent, High) always go into the current active cycle regardless of capacity.
2. **Every issue must belong to a project and a milestone.** Never create orphan issues and never leave an issue outside a milestone.
3. **If the correct project does not exist, create it before creating the issue.** Do not park work in a generic team backlog while waiting to organize it later.
4. **If the correct milestone does not exist, create it before creating the issue.** Milestone creation is part of issue intake, not optional cleanup.
5. **Use milestones for sequencing.** Milestones can have target dates, making them useful for communicating delivery phases to clients.
6. **Track progress in Linear.** After creating/updating projects or milestones, update the initiative's content in Linear to reflect the current structure (see "Post-Organization: Update Initiative in Linear" below).
7. **When creating issues with the CLI**, use `projectId`, `projectMilestoneId`, and `cycleId` fields in `linear_json` to place issues correctly in the hierarchy and cycle.

### CLI Examples

```bash
# List projects for the team
linear_list_projects

# List milestones within a project
linear_list_milestones "$PROJECT_ID"

# If needed, create the missing project or milestone before creating the issue
PROJECT_ID="$(linear_create_project "[CLIENT] Feature Area" "" "Short description" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['projectCreate']['project']['id'])")"
MILESTONE_ID="$(linear_create_milestone "$PROJECT_ID" "Phase 1" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['project']['projectMilestones']['nodes'][-1]['id'])")"

# Create an issue within a project and milestone (with cycle)
linear_create_issue "$(linear_json \
  title='Add evaluator create form' \
  description='...' \
  priority=2 \
  stateId=$STATE_TODO \
  assigneeId=$MEMBER_FRONTEND \
  labelIds=$LABEL_FEATURE,$LABEL_FRONTEND \
  projectId='project-uuid-here' \
  projectMilestoneId='milestone-uuid-here' \
  cycleId='cycle-uuid-here')"
```

---

## Project Refresh — Milestone Restructuring

When a project's milestone structure becomes outdated (or was never set up), use the **project refresh** workflow to reorganize milestones without losing or changing any issues.

### When to Refresh

- Project was created without milestones and has grown to 10+ issues
- Milestones were set up early but no longer match the actual work groupings
- A project pivot changed priorities and the old phases don't apply
- Too many issues are in "(No milestone)" and need proper grouping
- Milestones are too broad (30+ issues each) or too granular (1-2 issues each)

### Refresh Workflow

**Step 1: Audit the current state**

```bash
source linear.sh

# Get the project ID
linear_list_projects_pretty

# See current milestones
linear_list_milestones_pretty "$PROJECT_ID"

# See all issues grouped by milestone (includes unmilestoned)
linear_list_project_issues_pretty "$PROJECT_ID" 200

# Get raw JSON for scripting (includes issue UUIDs and milestone UUIDs)
linear_list_project_issues_raw "$PROJECT_ID" 200
```

Review:
- How many issues per milestone? (ideal: 5–15)
- Are milestones thematically coherent?
- Are there many unmilestoned issues?
- Do completed milestones still have open issues?
- Are milestone names clear and descriptive?

**Step 2: Propose new milestone structure**

Present the proposed changes to the user before making any modifications:
- Which milestones to **keep** (unchanged)
- Which milestones to **rename** (same issues, better name) — **never rename milestones with target dates**
- Which milestones to **merge** (combine two sparse milestones)
- Which milestones to **split** (break an overloaded milestone)
- Which milestones to **create** (for unmilestoned issues or new groupings)
- Which milestones to **delete** (empty after reshuffling) — **never delete milestones with target dates**
- For each issue, which milestone it should end up in

**Present this as a before/after table so the user can approve.**

**Step 3: Execute the changes (after user approval)**

Order of operations matters — follow this sequence:

1. **Create new milestones** (need their IDs before moving issues)
   ```bash
   linear_create_milestone "$PROJECT_ID" "New Milestone Name" "2025-06-01"
   ```

2. **Rename existing milestones** (safe, doesn't affect issues)
   ```bash
   linear_update_milestone "$MILESTONE_ID" '{"name":"Better Name"}'
   ```

3. **Move issues to their new milestones**
   ```bash
   # One at a time
   linear_set_issue_milestone "$ISSUE_ID" "$NEW_MILESTONE_ID"

   # Or batch move
   linear_batch_move_to_milestone "$NEW_MILESTONE_ID" "$ISSUE_1" "$ISSUE_2" "$ISSUE_3"
   ```

4. **Delete empty milestones** (only after all issues are moved out)
   ```bash
   linear_delete_milestone "$EMPTY_MILESTONE_ID"
   ```

5. **Verify the result**
   ```bash
   linear_list_project_issues_pretty "$PROJECT_ID" 200
   ```

**Step 4: Update the initiative in Linear**

After restructuring, update the initiative's `content` field in Linear to reflect the new milestone structure.

### Safety Rules

- **No issue loss.** Every issue that existed before the refresh must exist after. Verify issue count before and after.
- **No status changes.** Don't change any issue's status, priority, assignee, labels, or estimate during a refresh. Only the milestone assignment changes.
- **No issue deletion.** Never delete or cancel issues as part of a refresh.
- **Delete milestones last.** Only delete a milestone after confirming it has zero issues.
- **Never delete or rename a dated milestone.** Milestones with target dates represent intentional commitments — they must stay intact (name and date unchanged). You may move issues out of them, but the milestone itself must not be deleted or renamed.
- **User approval required.** Always present the proposed restructuring plan and get explicit approval before executing any changes.

### CLI Reference (Milestone Operations)

```bash
# Create a milestone
linear_create_milestone "$PROJECT_ID" "Milestone Name" ["target-date"]

# Rename / update a milestone
linear_update_milestone "$MILESTONE_ID" '{"name":"New Name"}'
linear_update_milestone "$MILESTONE_ID" '{"targetDate":"2025-07-01"}'
linear_update_milestone "$MILESTONE_ID" '{"sortOrder":5}'

# Delete a milestone (must be empty!)
linear_delete_milestone "$MILESTONE_ID"

# Move a single issue to a milestone
linear_set_issue_milestone "$ISSUE_ID" "$MILESTONE_ID"

# Remove issue from its milestone (set to unmilestoned)
linear_set_issue_milestone "$ISSUE_ID" ""

# Batch move issues to a milestone
linear_batch_move_to_milestone "$MILESTONE_ID" "$ISSUE_1" "$ISSUE_2" "$ISSUE_3"

# Get raw JSON with issue/milestone UUIDs (for scripting)
linear_list_project_issues_raw "$PROJECT_ID" [limit]
```

---

## Cycle Rebalance — Redistributing Issues Across Cycles

The **cycle rebalance** workflow redistributes issues so that cycles are filled **front-to-back**: the current cycle should be at **105% capacity**, overflow spills into the next cycle (also up to 105%), and so on. This applies in **both directions** — issues move later when a cycle is overloaded, and issues pull forward from later cycles when the current cycle has room.

**Capacity** is calculated using `linear_cycle_capacity`: total estimate points in the cycle / average completed estimate points from the last 3 completed cycles (velocity).

### When to Rebalance

- After a cycle ends with incomplete issues that rolled into the next cycle
- When a cycle is over or under capacity
- When the user says "rebalance cycles", "redistribute issues", or similar
- During sprint planning when upcoming cycles look uneven

### Rebalance Workflow

**Step 1: Audit current cycle state**

```bash
source linear.sh

# Check velocity-based capacity for all cycles
linear_cycle_capacity

# Overview: all active/upcoming cycles with issues grouped by project
linear_list_cycles_rebalance_pretty

# Raw data for analysis
linear_list_cycle_issues_all | python3 -m json.tool
```

Collect this data and analyze:
- **Velocity:** From `linear_cycle_capacity` output (avg completed pts from last 3 cycles)
- **Capacity per cycle:** Each cycle's estimate points as a % of velocity
- **Target per cycle:** 105% of velocity (e.g., if velocity = 91, target = ~96 pts)
- **Which cycles are under 105%:** These need issues pulled forward from later cycles
- **Which cycles are over 105%:** These need issues pushed to later cycles

**Step 2: Analyze and plan the redistribution**

The goal is to **fill cycles front-to-back to 105%**:

1. Start with the **current (active) cycle**. Calculate its capacity.
2. If **under 105%** → pull movable issues forward from the next cycle(s) until at 105% (or no more movable issues exist).
3. If **over 105%** → push lowest-priority movable issues to the next cycle until at 105%.
4. Move to the **next cycle** and repeat.
5. Continue until all cycles are processed. The last cycle absorbs whatever remains.

**When pulling issues forward**, prefer (in order):
1. **Urgent/High priority** issues first — get important work done sooner
2. Issues whose **dependencies are already satisfied** (blocker is Done or in an earlier/same cycle)
3. Issues from **underrepresented clients** in the target cycle (balance client mix)
4. Issues in the **same milestone** as other issues already in the target cycle

**When pushing issues later**, prefer (in order):
1. **NEVER move High (2) or Urgent (1) priority issues to a later cycle** — they are time-sensitive and must stay in their current cycle or move earlier
2. **NEVER move issues with a due date** — due dates represent commitments; these issues are pinned to their current cycle (or can move earlier, never later)
3. **Low (4)** priority issues first — least impactful to delay
4. **Medium (3)** priority next
5. Issues with **no downstream dependents** (nothing blocked by them)
6. Issues from **overrepresented clients** in the current cycle

Apply these heuristics throughout:

#### Heuristic 1: Respect status — never move active work
- **Never move** issues that are `In Progress` or `In Review` — they stay in their current cycle
- **Todo** issues are movable (both forward and backward)
- **Backlog** issues in a cycle are movable (but should be set to Todo after moving)

#### Heuristic 2: Respect dependencies
- **Hard rule: a blocking issue must NEVER be in a later cycle than the issue it blocks.** If issue A blocks issue B, A must be in the same cycle as B or an earlier one. This is inviolable — never move a blocker to a later cycle than its dependent.
- Check dependencies with `linear_list_dependencies "$ISSUE_ID"` for any issue you plan to move
- When pulling an issue forward, also pull forward any of its blockers that are in a later cycle (or leave both)
- When pushing an issue later, ensure none of the issues it blocks are in the current or an earlier cycle — if they are, you cannot push this issue. Either push the dependent issues too, or leave the blocker in place.

#### Heuristic 3: Balance client work per cycle
- Each cycle should have a **roughly proportional mix** of client work — avoid "all ZLM" or "all Enhanced" cycles
- When choosing which issues to pull forward or push later, use client balance as a tiebreaker
- This ensures progress across all clients every sprint

#### Heuristic 4: Keep milestones together
- Issues in the same milestone should stay in the same cycle when possible — they're often sequentially dependent even if not formally linked
- If a milestone spans cycles, keep the split clean: don't scatter milestone issues across 3+ cycles
- When pulling forward, prefer pulling entire milestone groups together

#### Heuristic 5: Balance assignee load
- Each cycle should have a reasonable split between the Frontend/PM lead and the Backend lead
- Don't create a cycle where one person has 80% of the work and the other has 20%
- Consider that backend issues (Backend lead) often block frontend issues (Frontend/PM lead) — schedule accordingly

#### Heuristic 6: Estimate-aware balancing
- Use estimate points (not just issue count) for capacity calculations via `linear_cycle_capacity`
- A cycle with 3 XL issues is heavier than one with 8 S issues
- Unestimated issues don't count toward capacity — note this when presenting the plan

**Step 3: Present the rebalance plan**

Present a clear before/after comparison:

```
VELOCITY: 91 pts (avg from C1=96, C2=80, C3=96)
TARGET PER CYCLE: ~96 pts (105%)

BEFORE:
  Cycle 4 (active):  67 pts —  74% capacity
  Cycle 5:           62 pts —  68% capacity
  Cycle 6:           65 pts —  72% capacity

AFTER:
  Cycle 4:  96 pts — 105% capacity (pulled 29 pts forward from C5)
  Cycle 5:  96 pts — 105% capacity (lost 29 to C4, pulled 63 from C6)
  Cycle 6:   2 pts —   2% capacity (pushed 63 to C5)

MOVES:
  ← GAL-342 "Build case profiles list page" (est 3, Enhanced) → Cycle 5 → Cycle 4
  ← GAL-441 "Show dependency indicators" (est 3, ZLM) → Cycle 5 → Cycle 4
  → GAL-278 "Display approval audit trail" (est 3, ZLM) → Cycle 6 → Cycle 5
  ...
```

Include:
- Direction arrow: `←` for pulling forward, `→` for pushing later
- Which issues move, with identifier, title, priority, estimate, and project
- Why each issue was chosen to move
- Client distribution per cycle (before and after)
- Assignee balance per cycle (before and after)
- Any issues you considered moving but kept in place, and why

**Get explicit user approval before executing.**

**Step 4: Execute the moves (after approval)**

> **Important: Rate limiting.** The Linear API silently drops rapid-fire mutations. Always use the pattern below — a for-loop with `linear_update_issue` and `sleep 0.5` between calls. Do NOT use the `linear_batch_move_to_cycle` helper with more than ~5 issues at a time without verifying results, as responses may report `success: true` while the mutation is silently discarded. Process in batches of ~9 with sleep delays for reliability.

```bash
# Reliable pattern for bulk cycle moves:
C5="<cycle-uuid>"
success=0 && fail=0
for id in "<issue-1>" "<issue-2>" "<issue-3>"; do
  result=$(linear_update_issue "$id" "{\"cycleId\":\"$C5\"}" 2>&1)
  if echo "$result" | grep -q '"success":true'; then
    success=$((success+1))
  else
    fail=$((fail+1))
    echo "FAIL: $result" | head -1
  fi
  sleep 0.5
done
echo "Done: $success ok, $fail failed"

# Or use the helper (includes delays and error reporting):
linear_batch_move_to_cycle "$TARGET_CYCLE_ID" "$ISSUE_1" "$ISSUE_2" "$ISSUE_3"
```

**Step 5: Verify the result**

```bash
# Confirm the new capacity distribution
linear_cycle_capacity

# Confirm issue-level details
linear_list_cycles_rebalance_pretty
```

Review the output and confirm:
- Current cycle is at or near 105% (or as close as possible given movable issues)
- Each subsequent cycle is filled to 105% before spilling to the next
- No In Progress/In Review issues were moved
- Dependencies are still satisfied (blockers before blocked)
- Client mix is balanced across cycles

**Step 6: Update initiative in Linear if needed**

After rebalancing, update the initiative's content in Linear if cycle assignments or progress notes are tracked there.

### Safety Rules

- **No status changes.** Only the cycle assignment changes — never touch status, priority, assignee, labels, estimate, milestone, or project.
- **No issue deletion.** Never delete or cancel issues during a rebalance.
- **Don't move active work.** Issues in `In Progress` or `In Review` are untouchable.
- **Never push High or Urgent issues later.** High (priority 2) and Urgent (priority 1) issues must never be moved to a farther-out cycle — they are time-sensitive by definition. They can only stay put or be pulled forward.
- **Never push due-dated issues later.** Issues with a due date are pinned to their current cycle (or earlier). Due dates represent commitments — never move these to a farther-out cycle.
- **Respect dependencies.** A blocking issue must NEVER end up in a later cycle than the issue it blocks. Before moving any issue, check its dependencies — if it blocks something in cycle N, it cannot move to cycle N+1 or later.
- **User approval required.** Always present the full rebalance plan and get explicit approval before executing any moves.
- **105% target is a soft cap.** It's okay if a cycle lands at 103% or 107% because the next movable issue would overshoot. The goal is "each cycle as close to 105% as possible, filled front-to-back," not mathematical perfection.

### CLI Reference (Cycle Rebalance Operations)

```bash
# Full overview of cycles with issues grouped by project
linear_list_cycles_rebalance_pretty

# Raw JSON for all active/upcoming cycles with incomplete issues
linear_list_cycle_issues_all

# Raw JSON for a specific cycle's incomplete issues
linear_list_cycle_issues_by_id "$CYCLE_ID"

# Move a single issue to a different cycle
linear_move_issue_to_cycle "$ISSUE_ID" "$CYCLE_ID"

# Batch move multiple issues to a cycle (includes 0.5s delay between calls)
# Reports success/fail counts. Keep batches ≤9 for reliability.
linear_batch_move_to_cycle "$CYCLE_ID" "$ISSUE_1" "$ISSUE_2" "$ISSUE_3"

# Check dependencies before moving
linear_list_dependencies "$ISSUE_ID"

# Verify after rebalancing
linear_list_cycles_rebalance_pretty
```

> **Rate limit note:** Linear's API can silently discard rapid mutations. The batch function includes a 0.5s delay between calls and validates each response. For large rebalances (50+ moves), process in groups of ~9 and verify between groups.

---

## Tips for a 2-Person Team

1. **Keep issues small.** If it's XL, break it down. Small issues keep momentum and make reviews easier.
2. **Daily async check-in.** A quick message about what you're working on and if you're blocked.
3. **Use "In Review" status.** It signals to the other person that something needs their eyes.
4. **Don't overcommit cycles.** Leave ~20% buffer for bugs, client requests, and interruptions.
5. **Projects identify the client.** No need for client prefixes in issue titles or client labels — the project name (e.g., `[ZLM] Portal`) already provides that context.
6. **Triage first.** New client requests go to Backlog, not straight into the sprint — unless truly urgent.
