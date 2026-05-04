#!/usr/bin/env bash
# Linear API wrapper for Claude Code workflows
# Usage: source this file, then call functions
# Requires: LINEAR_API_KEY exported in your shell environment.
# Recommended: add `export LINEAR_API_KEY=lin_api_xxx` to ~/.zshenv (zsh)
# or ~/.bashrc (bash) so it's available in every shell — including the
# non-interactive ones spawned by Claude Code.
#
# Workspace identifiers (team UUID, member UUIDs, state/label UUIDs) are loaded
# from a per-user JSON file (default: ~/.config/linctl/workspace.json). On
# first use, run `linctl_init` to generate this file from your Linear workspace.

if [[ -z "${LINEAR_API_KEY:-}" ]]; then
  echo "Error: LINEAR_API_KEY is not set." >&2
  echo "Add this line to ~/.zshenv (or ~/.bashrc) and open a new shell:" >&2
  echo "  export LINEAR_API_KEY=lin_api_xxx" >&2
  echo "Get your key from https://linear.app/settings/account/security" >&2
  return 1
fi

LINEAR_API="https://api.linear.app/graphql"

# --- Workspace config loader ---
# Reads ~/.config/linctl/workspace.json (override path with LINCTL_WORKSPACE_FILE)
# and exports the IDs the helpers depend on. If the file is missing the script
# still loads (so the user can call linctl_init) but the variables are unset.
LINCTL_WORKSPACE_FILE="${LINCTL_WORKSPACE_FILE:-$HOME/.config/linctl/workspace.json}"

if [[ -f "$LINCTL_WORKSPACE_FILE" ]]; then
  eval "$(_LINCTL_FILE="$LINCTL_WORKSPACE_FILE" python3 -c '
import json, os, sys

with open(os.environ["_LINCTL_FILE"]) as f:
    cfg = json.load(f)

def emit(name, value):
    if value is None:
        return
    # Shell-safe: values are UUIDs or simple strings, no quoting hazards expected,
    # but escape single quotes defensively.
    v = str(value).replace("\x27", "\x27\"\x27\"\x27")
    print(f"export {name}=\x27{v}\x27")

teams = cfg.get("teams", [])
if teams:
    emit("TEAM_ID", teams[0].get("id"))

roles = cfg.get("roles", {}) or {}
emit("MEMBER_FRONTEND", (roles.get("frontend_lead") or {}).get("id"))
emit("MEMBER_BACKEND",  (roles.get("backend_lead")  or {}).get("id"))

states = cfg.get("states", {}) or {}
state_map = {
    "Backlog":     "STATE_BACKLOG",
    "Todo":        "STATE_TODO",
    "In Progress": "STATE_IN_PROGRESS",
    "In Review":   "STATE_IN_REVIEW",
    "Done":        "STATE_DONE",
    "Canceled":    "STATE_CANCELED",
}
for k, var in state_map.items():
    emit(var, states.get(k))

labels = cfg.get("labels", {}) or {}
label_map = {
    "discovery":   "LABEL_DISCOVERY",
    "tech-debt":   "LABEL_TECH_DEBT",
    "backend":     "LABEL_BACKEND",
    "frontend":    "LABEL_FRONTEND",
    "db":          "LABEL_DB",
    "bug":         "LABEL_BUG",
    "feature":     "LABEL_FEATURE",
    "improvement": "LABEL_IMPROVEMENT",
}
for k, var in label_map.items():
    emit(var, labels.get(k))
')"
else
  echo "Warning: workspace config not found at $LINCTL_WORKSPACE_FILE" >&2
  echo "  Run \`linctl_init\` to generate it (after sourcing linear.sh)." >&2
  echo "  Until then, TEAM_ID / MEMBER_* / STATE_* / LABEL_* will be unset." >&2
fi

# --- Core API call ---
# Sends a GraphQL query with variables to the Linear API
# Usage: linear_api 'query { ... }' '{"key":"value"}'
linear_api() {
  local query="$1"
  local variables="${2:-"{}"}"
  _LINEAR_Q="$query" _LINEAR_V="$variables" python3 -c '
import json, os
q = os.environ["_LINEAR_Q"]
v = json.loads(os.environ["_LINEAR_V"])
print(json.dumps({"query": q, "variables": v}))
' | curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: $LINEAR_API_KEY" \
    --data @- \
    "$LINEAR_API"
}

# --- JSON builder helper ---
# Builds a JSON object from key=value arguments. Handles types automatically.
# Usage: linear_json title="Fix bug" priority=1 assigneeId=$MEMBER_FRONTEND labelIds=$LABEL_BUG,$LABEL_FRONTEND projectId=... projectMilestoneId=...
# Arrays: comma-separated values for labelIds
# Returns: valid JSON string
linear_json() {
  python3 -c '
import json, sys
obj = {}
for arg in sys.argv[1:]:
    key, val = arg.split("=", 1)
    if not val:
        continue
    if key == "labelIds":
        obj[key] = [v.strip() for v in val.split(",") if v.strip()]
    elif key in ("priority", "estimate", "sortOrder"):
        obj[key] = int(val)
    else:
        obj[key] = val
print(json.dumps(obj))
' "$@"
}

# --- Issue operations ---

# Create an issue
# Usage: linear_create_issue "$(linear_json title='Fix bug' priority=1 assigneeId=$MEMBER_FRONTEND labelIds=$LABEL_BUG)"
# Or:    linear_create_issue '{"title":"Fix bug","priority":1}'  (raw JSON with hardcoded UUIDs)
#
# Input JSON fields: title (required), description, priority (0-4),
#   stateId, assigneeId, labelIds (array), cycleId, estimate (int),
#   projectId, projectMilestoneId
# TeamId is added automatically.
linear_create_issue() {
  local input_json="$1"
  local vars
  vars=$(_INPUT="$input_json" _TEAM_ID="$TEAM_ID" _STATE_DEFAULT="$STATE_BACKLOG" python3 -c '
import json, os
inp = json.loads(os.environ["_INPUT"])
inp["teamId"] = os.environ["_TEAM_ID"]
if "stateId" not in inp:
    inp["stateId"] = os.environ["_STATE_DEFAULT"]
print(json.dumps({"input": inp}))
')

  linear_api '
    mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          title
          url
          priority
          state { name }
          assignee { name }
          labels { nodes { name } }
        }
      }
    }
  ' "$vars"
}

# List issues (optionally filtered by state type)
# Usage: linear_list_issues [state_type] [limit]
# state_type: backlog, unstarted, started, completed, canceled (optional)
linear_list_issues() {
  local state_type="${1:-}"
  local limit="${2:-50}"

  local filter=""
  if [[ -n "$state_type" ]]; then
    filter="filter: { state: { type: { eq: \"$state_type\" } } },"
  fi

  linear_api "
    {
      team(id: \"$TEAM_ID\") {
        issues($filter first: $limit, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            priority
            estimate
            state { name }
            assignee { name }
            labels { nodes { name } }
            cycle { number }
          }
        }
      }
    }
  "
}

# List issues in the current active cycle
linear_list_cycle_issues() {
  linear_api "
    {
      team(id: \"$TEAM_ID\") {
        cycles(filter: { isActive: { eq: true } }) {
          nodes {
            number
            startsAt
            endsAt
            issues {
              nodes {
                id
                identifier
                title
                priority
                estimate
                state { name }
                assignee { name }
                labels { nodes { name } }
              }
            }
          }
        }
      }
    }
  "
}

# Update an issue by ID
# Usage: linear_update_issue "issue-uuid" '{"stateId":"...","priority":1}'
linear_update_issue() {
  local issue_id="$1"
  local input_json="$2"
  local vars
  vars=$(_ID="$issue_id" _INPUT="$input_json" python3 -c '
import json, os
print(json.dumps({"issueId": os.environ["_ID"], "input": json.loads(os.environ["_INPUT"])}))')


  linear_api '
    mutation IssueUpdate($issueId: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $issueId, input: $input) {
        success
        issue {
          id
          identifier
          title
          state { name }
          priority
          assignee { name }
        }
      }
    }
  ' "$vars"
}

# Move an issue to a status by name
# Usage: linear_move_issue "issue_id" "In Progress"
linear_move_issue() {
  local issue_id="$1"
  local target_status="$2"

  local state_id=""
  case "$target_status" in
    "Backlog")      state_id="$STATE_BACKLOG" ;;
    "Todo")         state_id="$STATE_TODO" ;;
    "In Progress")  state_id="$STATE_IN_PROGRESS" ;;
    "In Review")    state_id="$STATE_IN_REVIEW" ;;
    "Done")         state_id="$STATE_DONE" ;;
    "Canceled")     state_id="$STATE_CANCELED" ;;
    *) echo "Unknown status: $target_status" >&2; return 1 ;;
  esac

  linear_update_issue "$issue_id" "{\"stateId\":\"$state_id\"}"
}

# Assign an issue
# Usage: linear_assign_issue "issue_id" "frontend"|"backend"
# Resolves to MEMBER_FRONTEND / MEMBER_BACKEND from your workspace config.
linear_assign_issue() {
  local issue_id="$1"
  local member="$2"

  local member_id=""
  case "$member" in
    "frontend") member_id="$MEMBER_FRONTEND" ;;
    "backend")  member_id="$MEMBER_BACKEND" ;;
    *) echo "Unknown member role: $member (expected: frontend|backend)" >&2; return 1 ;;
  esac

  if [[ -z "$member_id" ]]; then
    echo "Error: \$MEMBER_${member^^} is not set. Run linctl_init to configure." >&2
    return 1
  fi

  linear_update_issue "$issue_id" "{\"assigneeId\":\"$member_id\"}"
}

# Search issues by text
# Usage: linear_search_issues "search term"
linear_search_issues() {
  local query="$1"
  local vars
  vars=$(_SEARCH="$query" python3 -c 'import json,os; print(json.dumps({"term": os.environ["_SEARCH"]}))')
  linear_api '
    query SearchIssues($term: String!) {
      searchIssues(term: $term, first: 20) {
        nodes {
          id
          identifier
          title
          state { name }
          assignee { name }
          priority
        }
      }
    }
  ' "$vars"
}

# --- Project & Milestone operations ---

# Create a project
# Usage: linear_create_project "Project Name" ["initiative-uuid"] ["Short description"]
# Returns: id, name, state, url
linear_create_project() {
  local name="$1"
  local initiative_id="${2:-}"
  local description="${3:-}"
  local vars
  vars=$(_NAME="$name" _INIT="$initiative_id" _DESC="$description" _TEAM="$TEAM_ID" python3 -c '
import json, os
inp = {"name": os.environ["_NAME"], "teamIds": [os.environ["_TEAM"]]}
if os.environ["_DESC"]:
    inp["description"] = os.environ["_DESC"]
print(json.dumps({"input": inp, "initiativeId": os.environ["_INIT"] or None}))
')

  local result
  result=$(linear_api '
    mutation CreateProject($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        success
        project {
          id
          name
          state
          url
        }
      }
    }
  ' "$vars")

  # If an initiative ID was provided, link it via initiativeToProjectCreate
  local project_id
  project_id=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('projectCreate',{}).get('project',{}).get('id',''))" 2>/dev/null)
  if [[ -n "$initiative_id" && -n "$project_id" ]]; then
    linear_api '
      mutation LinkInitiativeProject($input: InitiativeToProjectCreateInput!) {
        initiativeToProjectCreate(input: $input) {
          success
        }
      }
    ' "{\"input\":{\"initiativeId\":\"$initiative_id\",\"projectId\":\"$project_id\"}}" > /dev/null
  fi

  echo "$result"
}

# List all projects in the team
linear_list_projects() {
  linear_api "
    {
      team(id: \"$TEAM_ID\") {
        projects(first: 50, orderBy: updatedAt) {
          nodes {
            id
            name
            state
            progress
            startDate
            targetDate
            initiatives { nodes { name } }
          }
        }
      }
    }
  "
}

# Pretty-print projects as a table
linear_list_projects_pretty() {
  linear_list_projects | python3 -c "
import sys, json
data = json.load(sys.stdin)
projects = data['data']['team']['projects']['nodes']
if not projects:
    print('No projects found.')
    sys.exit(0)
print(f\"{'Initiative':<15} {'Project':<35} {'State':<10} {'Progress':>8}  {'Target Date'}\")
print('-' * 90)
for p in projects:
    inits = p.get('initiatives', {}).get('nodes', [])
    initiative = inits[0]['name'] if inits else '-'
    progress = f\"{int(p['progress'] * 100)}%\" if p.get('progress') is not None else '-'
    target = p.get('targetDate') or '-'
    print(f\"{initiative:<15} {p['name']:<35} {p['state']:<10} {progress:>8}  {target}\")
"
}

# List milestones within a project
# Usage: linear_list_milestones "project-uuid"
linear_list_milestones() {
  local project_id="$1"
  linear_api "
    {
      project(id: \"$project_id\") {
        name
        projectMilestones(first: 50) {
          nodes {
            id
            name
            targetDate
            sortOrder
          }
        }
      }
    }
  "
}

# Pretty-print milestones for a project
linear_list_milestones_pretty() {
  local project_id="$1"
  linear_list_milestones "$project_id" | python3 -c "
import sys, json
data = json.load(sys.stdin)
project = data['data']['project']
milestones = project['projectMilestones']['nodes']
print(f\"Project: {project['name']}\")
if not milestones:
    print('No milestones found.')
    sys.exit(0)
print(f\"{'Milestone':<40} {'Target Date':<15}\")
print('-' * 55)
for m in milestones:
    target = m.get('targetDate') or '-'
    print(f\"{m['name']:<40} {target:<15}\")
    print(f\"  ID: {m['id']}\")
"
}

# List issues within a specific project
# Usage: linear_list_project_issues "project-uuid" [limit]
linear_list_project_issues() {
  local project_id="$1"
  local limit="${2:-50}"
  linear_api "
    {
      project(id: \"$project_id\") {
        name
        issues(first: $limit, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            priority
            estimate
            state { name }
            assignee { name }
            projectMilestone { name }
            labels { nodes { name } }
          }
        }
      }
    }
  "
}

# Pretty-print issues for a project, grouped by milestone
linear_list_project_issues_pretty() {
  local project_id="$1"
  local limit="${2:-50}"
  linear_list_project_issues "$project_id" "$limit" | python3 -c "
import sys, json
from collections import defaultdict
data = json.load(sys.stdin)
project = data['data']['project']
issues = project['issues']['nodes']
print(f\"Project: {project['name']} ({len(issues)} issues)\")
if not issues:
    print('No issues found.')
    sys.exit(0)
priorities = {0: '-', 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low'}
grouped = defaultdict(list)
for i in issues:
    ms = i['projectMilestone']['name'] if i.get('projectMilestone') else '(No milestone)'
    grouped[ms].append(i)
for ms_name, ms_issues in grouped.items():
    print(f\"\n## {ms_name}\")
    print(f\"{'ID':<10} {'Priority':<8} {'Status':<14} {'Assignee':<12} {'Title'}\")
    print('-' * 70)
    for i in ms_issues:
        pid = priorities.get(i['priority'], '-')
        assignee = i['assignee']['name'].split()[0] if i.get('assignee') else '-'
        state = i['state']['name']
        print(f\"{i['identifier']:<10} {pid:<8} {state:<14} {assignee:<12} {i['title']}\")
"
}

# --- Milestone CRUD operations ---

# Create a milestone within a project
# Usage: linear_create_milestone "project-uuid" "Milestone Name" ["2025-06-01" (optional target date)]
linear_create_milestone() {
  local project_id="$1"
  local name="$2"
  local target_date="${3:-}"

  local vars
  vars=$(_PID="$project_id" _NAME="$name" _DATE="$target_date" python3 -c '
import json, os
inp = {"projectId": os.environ["_PID"], "name": os.environ["_NAME"]}
if os.environ["_DATE"]:
    inp["targetDate"] = os.environ["_DATE"]
print(json.dumps({"input": inp}))
')

  linear_api '
    mutation CreateProjectMilestone($input: ProjectMilestoneCreateInput!) {
      projectMilestoneCreate(input: $input) {
        success
        projectMilestone {
          id
          name
          targetDate
          sortOrder
        }
      }
    }
  ' "$vars"
}

# Update a milestone (rename, change target date, reorder)
# Usage: linear_update_milestone "milestone-uuid" '{"name":"New Name","targetDate":"2025-07-01","sortOrder":5}'
linear_update_milestone() {
  local milestone_id="$1"
  local input_json="$2"
  local vars
  vars=$(_ID="$milestone_id" _INPUT="$input_json" python3 -c '
import json, os
print(json.dumps({"milestoneId": os.environ["_ID"], "input": json.loads(os.environ["_INPUT"])}))')

  linear_api '
    mutation UpdateProjectMilestone($milestoneId: String!, $input: ProjectMilestoneUpdateInput!) {
      projectMilestoneUpdate(id: $milestoneId, input: $input) {
        success
        projectMilestone {
          id
          name
          targetDate
          sortOrder
        }
      }
    }
  ' "$vars"
}

# Delete a milestone
# Usage: linear_delete_milestone "milestone-uuid"
# WARNING: Only use on empty milestones — move all issues out first!
linear_delete_milestone() {
  local milestone_id="$1"
  local vars
  vars=$(_ID="$milestone_id" python3 -c 'import json,os; print(json.dumps({"milestoneId": os.environ["_ID"]}))')

  linear_api '
    mutation DeleteProjectMilestone($milestoneId: String!) {
      projectMilestoneDelete(id: $milestoneId) {
        success
      }
    }
  ' "$vars"
}

# Move an issue to a different milestone (or remove from milestone)
# Usage: linear_set_issue_milestone "issue-uuid" "milestone-uuid"
#        linear_set_issue_milestone "issue-uuid" ""   # remove from milestone
linear_set_issue_milestone() {
  local issue_id="$1"
  local milestone_id="$2"

  if [[ -n "$milestone_id" ]]; then
    linear_update_issue "$issue_id" "{\"projectMilestoneId\":\"$milestone_id\"}"
  else
    # To unset milestone, pass null
    local vars
    vars=$(_ID="$issue_id" python3 -c '
import json, os
print(json.dumps({"issueId": os.environ["_ID"], "input": {"projectMilestoneId": None}}))')
    linear_api '
      mutation IssueUpdate($issueId: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $issueId, input: $input) {
          success
          issue { id identifier title projectMilestone { name } }
        }
      }
    ' "$vars"
  fi
}

# Batch move multiple issues to a milestone
# Usage: linear_batch_move_to_milestone "milestone-uuid" "issue-uuid-1" "issue-uuid-2" ...
linear_batch_move_to_milestone() {
  local milestone_id="$1"
  shift
  local count=0
  local total=$#
  for issue_id in "$@"; do
    count=$((count + 1))
    echo "Moving issue $count/$total ($issue_id) to milestone..." >&2
    linear_set_issue_milestone "$issue_id" "$milestone_id" > /dev/null
  done
  echo "Done. Moved $total issues." >&2
}

# List project issues as raw JSON with issue IDs and milestone IDs (for scripting)
# Usage: linear_list_project_issues_raw "project-uuid" [limit]
# Returns JSON with id, identifier, title, state, milestone info
linear_list_project_issues_raw() {
  local project_id="$1"
  local limit="${2:-200}"
  linear_api "
    {
      project(id: \"$project_id\") {
        name
        issues(first: $limit, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            priority
            estimate
            state { name type }
            assignee { name }
            projectMilestone { id name }
            labels { nodes { name } }
          }
        }
      }
    }
  "
}

# --- Issue Dependency operations ---

# Add a "blocks" dependency between two issues
# Usage: linear_add_dependency "blocker-issue-uuid" "blocked-issue-uuid"
# Result: blocker blocks blocked (i.e., blocked is blocked by blocker)
linear_add_dependency() {
  local blocker_id="$1"
  local blocked_id="$2"
  local vars
  vars=$(_BLOCKER="$blocker_id" _BLOCKED="$blocked_id" python3 -c '
import json, os
print(json.dumps({"input": {"issueId": os.environ["_BLOCKER"], "relatedIssueId": os.environ["_BLOCKED"], "type": "blocks"}}))')

  linear_api '
    mutation CreateIssueRelation($input: IssueRelationCreateInput!) {
      issueRelationCreate(input: $input) {
        success
        issueRelation {
          id
          type
          issue { identifier title }
          relatedIssue { identifier title }
        }
      }
    }
  ' "$vars"
}

# List dependencies (relations) for an issue
# Usage: linear_list_dependencies "issue-uuid"
linear_list_dependencies() {
  local issue_id="$1"
  linear_api "
    {
      issue(id: \"$issue_id\") {
        identifier
        title
        relations {
          nodes {
            id
            type
            relatedIssue { identifier title state { name } }
          }
        }
        inverseRelations {
          nodes {
            id
            type
            issue { identifier title state { name } }
          }
        }
      }
    }
  "
}

# Remove a dependency (delete a relation)
# Usage: linear_remove_dependency "relation-uuid"
linear_remove_dependency() {
  local relation_id="$1"
  local vars
  vars=$(_ID="$relation_id" python3 -c 'import json,os; print(json.dumps({"relationId": os.environ["_ID"]}))')

  linear_api '
    mutation DeleteIssueRelation($relationId: String!) {
      issueRelationDelete(id: $relationId) {
        success
      }
    }
  ' "$vars"
}

# Add a comment to an issue
# Usage: linear_add_comment "issue-uuid" "comment body text"
linear_add_comment() {
  local issue_id="$1"
  local body="$2"
  local vars
  vars=$(_ISSUE="$issue_id" _BODY="$body" python3 -c '
import json, os
print(json.dumps({"input": {"issueId": os.environ["_ISSUE"], "body": os.environ["_BODY"]}}))')

  linear_api '
    mutation CreateComment($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment {
          id
          body
          user { name }
        }
      }
    }
  ' "$vars"
}

# --- Initiative operations ---

# Create an initiative
# Usage: linear_create_initiative "Initiative Name" ["Short description"]
# Returns: id, name, description, status, url
linear_create_initiative() {
  local name="$1"
  local description="${2:-}"
  local vars
  vars=$(_NAME="$name" _DESC="$description" python3 -c '
import json, os
inp = {"name": os.environ["_NAME"]}
if os.environ["_DESC"]:
    inp["description"] = os.environ["_DESC"]
print(json.dumps({"input": inp}))
')

  linear_api '
    mutation CreateInitiative($input: InitiativeCreateInput!) {
      initiativeCreate(input: $input) {
        success
        initiative {
          id
          name
          description
          status
          url
        }
      }
    }
  ' "$vars"
}

# List all initiatives (raw JSON)
# Returns: id, name, description, status, url
linear_list_initiatives() {
  linear_api '
    {
      initiatives(first: 50) {
        nodes {
          id
          name
          description
          status
          url
        }
      }
    }
  '
}

# Pretty-print initiatives as a table
linear_list_initiatives_pretty() {
  linear_list_initiatives | python3 -c "
import sys, json
data = json.load(sys.stdin)
nodes = data['data']['initiatives']['nodes']
if not nodes:
    print('No initiatives found.')
    sys.exit(0)
print(f\"{'Name':<20} {'Status':<12} {'Description':<45} {'URL'}\")
print('-' * 110)
for i in nodes:
    desc = (i.get('description') or '-')[:42]
    if len(i.get('description') or '') > 42:
        desc += '...'
    status = i.get('status') or '-'
    print(f\"{i['name']:<20} {status:<12} {desc:<45} {i.get('url', '-')}\")
    print(f\"  ID: {i['id']}\")
"
}

# Get full initiative detail by ID
# Usage: linear_get_initiative "initiative-uuid"
# Returns: name, description, content, status, url, projects (with progress)
linear_get_initiative() {
  local init_id="$1"
  local vars
  vars=$(_ID="$init_id" python3 -c 'import json,os; print(json.dumps({"id": os.environ["_ID"]}))')
  linear_api '
    query GetInitiative($id: String!) {
      initiative(id: $id) {
        id
        name
        description
        content
        status
        url
        projects {
          nodes {
            id
            name
            state
            progress
            startDate
            targetDate
          }
        }
      }
    }
  ' "$vars"
}

# Get full initiative detail by name (case-insensitive match)
# Usage: linear_get_initiative_by_name "Enhanced"
linear_get_initiative_by_name() {
  local search_name="$1"
  local all_inits
  all_inits=$(linear_list_initiatives)
  local init_id
  init_id=$(_DATA="$all_inits" _NAME="$search_name" python3 -c '
import json, os, sys
data = json.loads(os.environ["_DATA"])
name = os.environ["_NAME"].lower()
for i in data["data"]["initiatives"]["nodes"]:
    if name in i["name"].lower():
        print(i["id"])
        sys.exit(0)
print("", end="")
sys.exit(1)
')
  if [[ -z "$init_id" ]]; then
    echo "No initiative found matching \"$search_name\"" >&2
    return 1
  fi
  linear_get_initiative "$init_id"
}

# Update an initiative by ID
# Usage: linear_update_initiative "initiative-uuid" '{"content":"new content","description":"short desc"}'
# Supported fields: name, description, content, status
linear_update_initiative() {
  local init_id="$1"
  local input_json="$2"
  local vars
  vars=$(_ID="$init_id" _INPUT="$input_json" python3 -c '
import json, os
print(json.dumps({"initiativeId": os.environ["_ID"], "input": json.loads(os.environ["_INPUT"])}))')

  linear_api '
    mutation UpdateInitiative($initiativeId: String!, $input: InitiativeUpdateInput!) {
      initiativeUpdate(id: $initiativeId, input: $input) {
        success
        initiative {
          id
          name
          description
          status
          url
        }
      }
    }
  ' "$vars"
}

# Add an external link (resource) to an initiative
# Usage: linear_add_initiative_link "initiative-uuid" "https://github.com/org/repo" "GitHub Repo"
linear_add_initiative_link() {
  local init_id="$1"
  local url="$2"
  local label="$3"
  local vars
  vars=$(_ID="$init_id" _URL="$url" _LABEL="$label" python3 -c '
import json, os
print(json.dumps({"input": {"initiativeId": os.environ["_ID"], "url": os.environ["_URL"], "label": os.environ["_LABEL"]}}))')

  linear_api '
    mutation CreateExternalLink($input: EntityExternalLinkCreateInput!) {
      entityExternalLinkCreate(input: $input) {
        success
        entityExternalLink {
          id
          url
          label
        }
      }
    }
  ' "$vars"
}

# --- Info operations ---

linear_list_states() {
  linear_api "{ team(id: \"$TEAM_ID\") { states { nodes { id name type position } } } }"
}

linear_list_members() {
  linear_api "{ team(id: \"$TEAM_ID\") { members { nodes { id name email } } } }"
}

linear_list_labels() {
  linear_api "{ team(id: \"$TEAM_ID\") { labels { nodes { id name } } } }"
}

linear_list_cycles() {
  linear_api "{ team(id: \"$TEAM_ID\") { cycles { nodes { id number startsAt endsAt isActive progress } } } }"
}

# List issues for a specific cycle (incomplete only, with project info)
# Usage: linear_list_cycle_issues_by_id "cycle-uuid"
linear_list_cycle_issues_by_id() {
  local cycle_id="$1"
  local vars
  vars=$(python3 -c "import json; print(json.dumps({'cycleId': '$cycle_id'}))")
  linear_api '
    query CycleIssues($cycleId: String!) {
      cycle(id: $cycleId) {
        id
        number
        startsAt
        endsAt
        isActive
        progress
        issues(filter: { state: { type: { nin: ["completed", "canceled"] } } }, first: 100) {
          nodes {
            id
            identifier
            title
            priority
            estimate
            state { name type }
            assignee { name }
            labels { nodes { name } }
            project { id name }
            projectMilestone { id name }
          }
        }
      }
    }
  ' "$vars"
}

# List all upcoming/active cycles with their incomplete issues, project info, and estimates
# Queries each cycle individually to avoid complexity limits
# Returns a JSON array of cycle objects with issues
linear_list_cycle_issues_all() {
  local cycle_ids
  cycle_ids=$(linear_list_cycles | python3 -c "
import sys, json
data = json.load(sys.stdin)
cycles = data['data']['team']['cycles']['nodes']
# Filter to non-past cycles (isActive or future startDate)
import datetime
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
for c in sorted(cycles, key=lambda x: x['startsAt']):
    # Include active cycles and future cycles
    if c['isActive'] or c['endsAt'] > now:
        print(c['id'])
")

  echo "["
  local first=true
  while IFS= read -r cid; do
    [[ -z "$cid" ]] && continue
    if [[ "$first" == "true" ]]; then
      first=false
    else
      echo ","
    fi
    linear_list_cycle_issues_by_id "$cid" | python3 -c "
import sys, json
data = json.load(sys.stdin)
json.dump(data.get('data', {}).get('cycle', {}), sys.stdout)
"
  done <<< "$cycle_ids"
  echo "]"
}

# Pretty-print cycle rebalance overview: issues per cycle grouped by project
linear_list_cycles_rebalance_pretty() {
  linear_list_cycle_issues_all | python3 -c "
import sys, json
cycles = sorted(json.load(sys.stdin), key=lambda c: c.get('startsAt', ''))
cycles = [c for c in cycles if c]  # filter empty
if not cycles:
    print('No active/upcoming cycles found.')
    sys.exit(0)

priorities = {0: '-', 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low'}

for c in cycles:
    issues = c.get('issues', {}).get('nodes', [])
    total_est = sum(i.get('estimate') or 0 for i in issues)
    active = ' [ACTIVE]' if c.get('isActive') else ''
    progress_pct = round((c.get('progress') or 0) * 100)
    print(f\"\\n{'='*90}\")
    print(f\"Cycle {c['number']}{active}  ({c['startsAt'][:10]} to {c['endsAt'][:10]})  Progress: {progress_pct}%  Issues: {len(issues)}  Est: {total_est}\")
    print(f\"{'='*90}\")

    # Group by project
    by_project = {}
    for i in issues:
        proj = i['project']['name'] if i.get('project') else '(No project)'
        by_project.setdefault(proj, []).append(i)

    for proj in sorted(by_project.keys()):
        proj_issues = by_project[proj]
        proj_est = sum(i.get('estimate') or 0 for i in proj_issues)
        print(f\"\\n  {proj} ({len(proj_issues)} issues, est: {proj_est})\")
        print(f\"  {'-'*70}\")
        for i in proj_issues:
            pid = priorities.get(i['priority'], '-')
            assignee = i['assignee']['name'].split()[0] if i.get('assignee') else '-'
            state = i['state']['name']
            est = str(i.get('estimate') or '-')
            ms = f\" [{i['projectMilestone']['name']}]\" if i.get('projectMilestone') else ''
            print(f\"  {i['identifier']:<10} {pid:<8} {state:<14} {assignee:<12} {est:>3}  {i['title']}{ms}\")

print()
"
}

# Move an issue to a different cycle
# Usage: linear_move_issue_to_cycle "issue-uuid" "cycle-uuid"
linear_move_issue_to_cycle() {
  local issue_id="$1"
  local cycle_id="$2"
  linear_update_issue "$issue_id" "{\"cycleId\":\"$cycle_id\"}"
}

# Batch move issues to a cycle (with rate-limit delay between calls)
# Usage: linear_batch_move_to_cycle "cycle-uuid" "issue-1" "issue-2" ...
# Note: 0.5s delay between API calls to avoid silent rate-limit failures.
# For large batches, call this in groups of ~10 from a for-loop with delays.
linear_batch_move_to_cycle() {
  local cycle_id="$1"
  shift
  local success=0
  local fail=0
  for issue_id in "$@"; do
    local result
    result=$(linear_update_issue "$issue_id" "{\"cycleId\":\"$cycle_id\"}" 2>&1)
    if echo "$result" | grep -q '"success":true'; then
      success=$((success + 1))
    else
      fail=$((fail + 1))
      echo "FAIL ($issue_id): $(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); errs=d.get('errors',[]); print(errs[0]['message'] if errs else 'unknown')" 2>/dev/null || echo "$result")"
    fi
    sleep 0.5
  done
  echo "Moved $success issues to cycle ($fail failed)."
}

# Show capacity % for all active/future cycles based on velocity from last 3 completed cycles
# Capacity = cycle's total estimate points / avg completed estimate points from last 3 past cycles
# Usage: linear_cycle_capacity
linear_cycle_capacity() {
  local past_data current_data
  past_data=$(linear_api 'query { team(id: "'"$TEAM_ID"'") { cycles(filter: { isPast: { eq: true } }, first: 3) { nodes { number completedScopeHistory } } } }')
  current_data=$(linear_api 'query { team(id: "'"$TEAM_ID"'") { cycles(filter: { isPast: { eq: false } }) { nodes { id number startsAt endsAt isActive currentProgress } } } }')
  _PAST="$past_data" _CURRENT="$current_data" python3 << 'PYEOF'
import json, os, sys

past = json.loads(os.environ["_PAST"])
current = json.loads(os.environ["_CURRENT"])

# Calculate velocity from last 3 completed cycles
past_cycles = past["data"]["team"]["cycles"]["nodes"]
if not past_cycles:
    print("No past cycles found — cannot calculate velocity.")
    sys.exit(0)

completed_scopes = []
for c in past_cycles:
    history = c.get("completedScopeHistory", [])
    if history:
        completed_scopes.append(history[-1])

if not completed_scopes:
    print("No completed scope data found in past cycles.")
    sys.exit(0)

velocity = sum(completed_scopes) / len(completed_scopes)
print(f"Velocity (avg completed pts from last {len(completed_scopes)} cycles): {velocity:.0f} pts")
details = ", ".join(f"C{c['number']}={c.get('completedScopeHistory',[-1])[-1]}" for c in past_cycles if c.get("completedScopeHistory"))
print(f"  ({details})")
print()

# Show capacity for each active/future cycle
cycles = sorted(current["data"]["team"]["cycles"]["nodes"], key=lambda x: x["startsAt"])
for c in cycles:
    cp = c.get("currentProgress") or {}
    scope_est = cp.get("scopeEstimate", 0)
    cap_pct = (scope_est / velocity * 100) if velocity > 0 else 0
    label = " [ACTIVE]" if c.get("isActive") else ""
    print(f"Cycle {c['number']}{label}  ({c['startsAt'][:10]} to {c['endsAt'][:10]})")
    print(f"  Estimate pts: {scope_est}  |  Capacity: {cap_pct:.0f}%  |  Velocity: {velocity:.0f}")
PYEOF
}

linear_current_cycle_id() {
  linear_api "{ team(id: \"$TEAM_ID\") { cycles(filter: { isActive: { eq: true } }) { nodes { id number startsAt endsAt } } } }" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); nodes=d['data']['team']['cycles']['nodes']; print(nodes[0]['id'] if nodes else '')"
}

# --- Formatted output helpers ---

# Pretty-print issues as a table
linear_list_issues_pretty() {
  local state_type="${1:-}"
  linear_list_issues "$state_type" | python3 -c "
import sys, json
data = json.load(sys.stdin)
issues = data['data']['team']['issues']['nodes']
if not issues:
    print('No issues found.')
    sys.exit(0)
priorities = {0: '-', 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low'}
print(f\"{'ID':<10} {'Priority':<8} {'Status':<14} {'Assignee':<12} {'Est':>3}  {'Title'}\")
print('-' * 80)
for i in issues:
    pid = priorities.get(i['priority'], '-')
    assignee = i['assignee']['name'].split()[0] if i['assignee'] else '-'
    state = i['state']['name']
    est = str(i.get('estimate') or '-')
    labels = ', '.join(l['name'] for l in i['labels']['nodes']) if i['labels']['nodes'] else ''
    title = i['title']
    if labels:
        title = f'{title} [{labels}]'
    print(f\"{i['identifier']:<10} {pid:<8} {state:<14} {assignee:<12} {est:>3}  {title}\")
"
}

# --- First-time setup ---
# Interactive command that fetches your Linear workspace metadata (teams,
# members, states, labels), prompts you to designate a Frontend/PM lead and a
# Backend lead, and writes ~/.config/linctl/workspace.json for the loader above.
# Usage: linctl_init
linctl_init() {
  if [[ -z "${LINEAR_API_KEY:-}" ]]; then
    echo "Error: LINEAR_API_KEY is not set. Set it first, then re-run linctl_init." >&2
    return 1
  fi

  echo "Fetching workspace data from Linear..." >&2
  local bootstrap
  bootstrap=$(linear_api '
    {
      teams(first: 50) { nodes { id key name parent { id } } }
      users(first: 250) { nodes { id name email displayName } }
    }
  ')

  local team_count
  team_count=$(_DATA="$bootstrap" python3 -c '
import json, os
d = json.loads(os.environ["_DATA"])
print(len(d.get("data", {}).get("teams", {}).get("nodes", []) or []))
')
  if [[ "$team_count" == "0" ]]; then
    echo "Error: no teams returned. Check LINEAR_API_KEY." >&2
    echo "Raw response:" >&2
    echo "$bootstrap" >&2
    return 1
  fi

  # Pick the first parent team (no parent of its own) so states/labels come
  # from the umbrella team rather than a sub-team. Falls back to the first
  # team in the list if no parents are found.
  local team_id
  team_id=$(_DATA="$bootstrap" python3 -c '
import json, os
d = json.loads(os.environ["_DATA"])
teams = d["data"]["teams"]["nodes"]
parents = [t for t in teams if not t.get("parent")]
chosen = parents[0] if parents else teams[0]
print(chosen["id"])
')

  local team_extra_vars team_extra
  team_extra_vars=$(_TEAM="$team_id" python3 -c 'import json, os; print(json.dumps({"id": os.environ["_TEAM"]}))')
  team_extra=$(linear_api '
    query TeamExtra($id: String!) {
      team(id: $id) {
        states { nodes { id name type } }
        labels { nodes { id name } }
      }
    }
  ' "$team_extra_vars")

  # Filter out Linear's integration/bot users (e.g., the webhook bot whose
  # email ends in @linear.linear.app) so role prompts only list real humans.
  bootstrap=$(_DATA="$bootstrap" python3 -c '
import json, os
d = json.loads(os.environ["_DATA"])
d["data"]["users"]["nodes"] = [
    u for u in d["data"]["users"]["nodes"]
    if not (u.get("email") or "").endswith("@linear.linear.app")
]
print(json.dumps(d))
')

  # Show members and prompt for role assignment.
  echo >&2
  echo "Members in your Linear workspace:" >&2
  _DATA="$bootstrap" python3 -c '
import json, os
d = json.loads(os.environ["_DATA"])
for i, u in enumerate(d["data"]["users"]["nodes"], 1):
    name = u.get("name") or u.get("displayName") or "(unnamed)"
    email = u.get("email") or "-"
    print(f"  {i}. {name} <{email}>")
' >&2
  echo >&2

  # Use printf + read for portability — `read -p` is bash-only and breaks under zsh.
  local frontend_idx backend_idx
  printf "Which member is the Frontend/PM lead? Enter number: " >&2
  read -r frontend_idx
  printf "Which member is the Backend lead? Enter number: " >&2
  read -r backend_idx

  # Build the workspace.json payload.
  local config_dir="$HOME/.config/linctl"
  mkdir -p "$config_dir"
  local out_file="$LINCTL_WORKSPACE_FILE"

  _BOOT="$bootstrap" _EXTRA="$team_extra" _FE="$frontend_idx" _BE="$backend_idx" _OUT="$out_file" python3 << 'PYEOF'
import json, os, sys

boot = json.loads(os.environ["_BOOT"])
extra = json.loads(os.environ["_EXTRA"])

teams = boot["data"]["teams"]["nodes"]
users = boot["data"]["users"]["nodes"]

def pick(idx_str):
    try:
        i = int(idx_str)
        if 1 <= i <= len(users):
            u = users[i - 1]
            return {
                "id": u["id"],
                "name": u.get("name") or u.get("displayName") or "",
                "email": u.get("email") or "",
            }
    except (ValueError, TypeError):
        pass
    sys.stderr.write(f"Invalid selection: {idx_str!r}\n")
    sys.exit(1)

frontend = pick(os.environ["_FE"])
backend  = pick(os.environ["_BE"])

# Standard names we want to capture if the workspace has them.
WANTED_STATES = ["Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled"]
WANTED_LABELS = ["discovery", "tech-debt", "backend", "frontend", "db", "bug", "feature", "improvement"]

state_nodes = (extra.get("data", {}).get("team") or {}).get("states", {}).get("nodes", []) or []
label_nodes = (extra.get("data", {}).get("team") or {}).get("labels", {}).get("nodes", []) or []

states = {}
state_lookup = {s["name"].lower(): s for s in state_nodes}
for name in WANTED_STATES:
    s = state_lookup.get(name.lower())
    if s:
        states[name] = s["id"]

def _norm(s):
    # Treat hyphens and spaces as equivalent so "tech-debt" matches "Tech Debt".
    return s.lower().replace("-", " ").strip()

labels = {}
label_lookup = {_norm(l["name"]): l for l in label_nodes}
for name in WANTED_LABELS:
    l = label_lookup.get(_norm(name))
    if l:
        labels[name] = l["id"]

# Sort teams so parent teams (no `parent` field) come first — the loader
# uses teams[0].id as the default TEAM_ID, and helpers should default to
# the umbrella team rather than a sub-team.
teams_sorted = sorted(teams, key=lambda t: 0 if not t.get("parent") else 1)

cfg = {
    "teams": [{"id": t["id"], "key": t.get("key"), "name": t.get("name")} for t in teams_sorted],
    "roles": {
        "frontend_lead": frontend,
        "backend_lead":  backend,
    },
    "states": states,
    "labels": labels,
}

out = os.environ["_OUT"]
with open(out, "w") as f:
    json.dump(cfg, f, indent=2)
print(f"Wrote {out}", file=sys.stderr)
PYEOF
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    return $rc
  fi

  echo >&2
  echo "Wrote $out_file. Re-source linear.sh to load it:" >&2
  echo "  source ${BASH_SOURCE[0]:-linear.sh}" >&2
}

# Friendly load banner
if [[ -n "${TEAM_ID:-}" ]]; then
  echo "Linear CLI loaded. Workspace config: $LINCTL_WORKSPACE_FILE"
  echo "Current cycle: $(linear_api "{ team(id: \"$TEAM_ID\") { cycles(filter: { isActive: { eq: true } }) { nodes { number startsAt endsAt } } } }" | python3 -c "import sys,json; d=json.load(sys.stdin); n=d['data']['team']['cycles']['nodes']; print(f\"Cycle {n[0]['number']} ({n[0]['startsAt'][:10]} to {n[0]['endsAt'][:10]})\" if n else 'None')" 2>/dev/null || echo "unable to fetch")"
else
  echo "Linear CLI loaded (no workspace config). Run \`linctl_init\` to set one up."
fi
