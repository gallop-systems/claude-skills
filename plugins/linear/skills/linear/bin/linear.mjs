#!/usr/bin/env node
// @ts-check
//
// Linear CLI for Claude Code workflows — zero-dependency, runs on bare `node`
// (Node 18.3+ for the built-in `node:util` parseArgs and global `fetch`).
//
// Usage:  node linear.mjs <command> [args] [--flags]
//         node linear.mjs --help
//
// Requires: LINEAR_API_KEY exported in the environment.
//   Recommended: add `export LINEAR_API_KEY=lin_api_xxx` to ~/.zshenv (zsh) or
//   ~/.bashrc (bash) so it's available in every shell — including the
//   non-interactive ones spawned by Claude Code.
//
// Workspace identifiers (team UUID, member UUIDs, state/label UUIDs) are loaded
// from a per-user JSON file (default: ~/.config/linctl/workspace.json). On first
// use, run `node linear.mjs init` to generate it from your Linear workspace.

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const API_URL = "https://api.linear.app/graphql";
const API_KEY = process.env.LINEAR_API_KEY;
const WORKSPACE_FILE =
  process.env.LINCTL_WORKSPACE_FILE ||
  join(homedir(), ".config", "linctl", "workspace.json");

// --- Small utilities -------------------------------------------------------

/** @param {string} msg */
function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {unknown} obj */
const printJson = (obj) => console.log(JSON.stringify(obj, null, 2));

/** @param {string} s */
const isUuid = (s) =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    s,
  );

/** @param {string|undefined} v @returns {number|undefined} */
function toInt(v) {
  if (v == null) return undefined;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) fail(`expected an integer, got: ${v}`);
  return n;
}

/**
 * Read a flag value, preferring a `<key>-file` path if present so callers can
 * pass long markdown without shell-escaping it.
 * @param {Record<string, any>} v
 * @param {string} key
 * @returns {string|undefined}
 */
function readMaybeFile(v, key) {
  const path = v[`${key}-file`];
  if (path) return readFileSync(path, "utf8");
  return v[key];
}

// --- Workspace config ------------------------------------------------------

/**
 * @typedef {{
 *   teamId: string,
 *   members: { frontend?: string, backend?: string, frontendName?: string, backendName?: string },
 *   states: Record<string, string>,
 *   labels: Record<string, string>,
 * }} Config
 */

/** @returns {Config | null} */
function loadConfig() {
  if (!existsSync(WORKSPACE_FILE)) return null;
  const raw = JSON.parse(readFileSync(WORKSPACE_FILE, "utf8"));
  const teams = raw.teams ?? [];
  const roles = raw.roles ?? {};
  return {
    teamId: teams[0]?.id ?? "",
    members: {
      frontend: roles.frontend_lead?.id,
      backend: roles.backend_lead?.id,
      frontendName: roles.frontend_lead?.name,
      backendName: roles.backend_lead?.name,
    },
    states: raw.states ?? {},
    labels: raw.labels ?? {},
  };
}

/** @returns {Config} */
function requireConfig() {
  const cfg = loadConfig();
  if (!cfg || !cfg.teamId) {
    fail(
      `workspace config not found or incomplete at ${WORKSPACE_FILE}\n` +
        `  Run \`node linear.mjs init\` to generate it.`,
    );
  }
  // @ts-ignore — fail() exits, so cfg is non-null past here.
  return cfg;
}

// --- Symbolic-name resolution ----------------------------------------------

const STATE_ALIASES = {
  backlog: "Backlog",
  todo: "Todo",
  "in progress": "In Progress",
  "in-progress": "In Progress",
  in_progress: "In Progress",
  inprogress: "In Progress",
  started: "In Progress",
  "in review": "In Review",
  "in-review": "In Review",
  in_review: "In Review",
  inreview: "In Review",
  done: "Done",
  completed: "Done",
  canceled: "Canceled",
  cancelled: "Canceled",
};

const PRIORITY = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

/** @param {string} s @param {Config} cfg */
function resolveState(s, cfg) {
  if (isUuid(s)) return s;
  const display = STATE_ALIASES[s.toLowerCase()] ?? s;
  const id = cfg.states[display];
  if (!id) fail(`unknown state "${s}" (and not a UUID). Run \`init\` to configure states.`);
  return id;
}

/** @param {string} s @param {Config} cfg */
function resolveMember(s, cfg) {
  if (isUuid(s)) return s;
  const key = s.toLowerCase();
  if (key === "frontend" || key === "fe") {
    if (!cfg.members.frontend) fail("frontend lead is not configured. Run `init`.");
    return cfg.members.frontend;
  }
  if (key === "backend" || key === "be") {
    if (!cfg.members.backend) fail("backend lead is not configured. Run `init`.");
    return cfg.members.backend;
  }
  fail(`unknown member role "${s}" (expected frontend|backend or a UUID).`);
}

/** @param {string} name @param {Config} cfg */
function resolveLabel(name, cfg) {
  if (isUuid(name)) return name;
  if (cfg.labels[name]) return cfg.labels[name];
  const norm = (x) => x.toLowerCase().replace(/-/g, " ").trim();
  const target = norm(name);
  for (const [k, id] of Object.entries(cfg.labels)) {
    if (norm(k) === target) return id;
  }
  fail(`unknown label "${name}" (and not a UUID). Run \`init\` to configure labels.`);
}

/** @param {string} csv @param {Config} cfg */
function resolveLabels(csv, cfg) {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => resolveLabel(s, cfg));
}

/** @param {string} p */
function resolvePriority(p) {
  const key = p.toLowerCase();
  if (key in PRIORITY) return PRIORITY[key];
  const n = Number.parseInt(p, 10);
  if (!Number.isNaN(n) && n >= 0 && n <= 4) return n;
  fail(`invalid priority "${p}" (expected 0-4 or none|urgent|high|medium|low).`);
}

/** @param {string} s @param {Config} cfg */
async function resolveCycle(s, cfg) {
  if (s === "current" || s === "active") return await currentCycleId(cfg);
  return s;
}

// --- Core API call ---------------------------------------------------------

/**
 * @param {string} query
 * @param {Record<string, unknown>} [variables]
 * @returns {Promise<any>}
 */
async function gql(query, variables = {}) {
  if (!API_KEY) {
    fail(
      "LINEAR_API_KEY is not set.\n" +
        "  Add to ~/.zshenv (or ~/.bashrc) and open a new shell:\n" +
        "    export LINEAR_API_KEY=lin_api_xxx\n" +
        "  Get a key from https://linear.app/settings/account/security",
    );
  }
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Linear personal API keys go in Authorization raw (no "Bearer" prefix).
      Authorization: /** @type {string} */ (API_KEY),
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

/** Print a mutation/query result as JSON; exit non-zero if it carried errors. */
function emit(data) {
  printJson(data);
  if (data?.errors?.length) process.exitCode = 1;
}

// --- Pretty printers -------------------------------------------------------

const PRI_LABEL = { 0: "-", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" };

/** @param {string} s @param {number} n */
const pad = (s, n) => String(s).padEnd(n);
/** @param {string|number} s @param {number} n */
const padL = (s, n) => String(s).padStart(n);

function prettyIssues(data) {
  const issues = data?.data?.team?.issues?.nodes ?? [];
  if (!issues.length) return console.log("No issues found.");
  console.log(
    `${pad("ID", 10)} ${pad("Priority", 8)} ${pad("Status", 14)} ${pad("Assignee", 12)} ${padL("Est", 3)}  Title`,
  );
  console.log("-".repeat(80));
  for (const i of issues) {
    const pid = PRI_LABEL[i.priority] ?? "-";
    const assignee = i.assignee?.name?.split(" ")[0] ?? "-";
    const est = i.estimate ?? "-";
    const labels = (i.labels?.nodes ?? []).map((l) => l.name).join(", ");
    const title = labels ? `${i.title} [${labels}]` : i.title;
    console.log(
      `${pad(i.identifier, 10)} ${pad(pid, 8)} ${pad(i.state.name, 14)} ${pad(assignee, 12)} ${padL(est, 3)}  ${title}`,
    );
  }
}

function prettyProjects(data) {
  const projects = data?.data?.team?.projects?.nodes ?? [];
  if (!projects.length) return console.log("No projects found.");
  console.log(
    `${pad("Initiative", 15)} ${pad("Project", 35)} ${pad("State", 10)} ${padL("Progress", 8)}  Target Date`,
  );
  console.log("-".repeat(90));
  for (const p of projects) {
    const inits = p.initiatives?.nodes ?? [];
    const initiative = inits[0]?.name ?? "-";
    const progress = p.progress != null ? `${Math.round(p.progress * 100)}%` : "-";
    const target = p.targetDate ?? "-";
    console.log(
      `${pad(initiative, 15)} ${pad(p.name, 35)} ${pad(p.state, 10)} ${padL(progress, 8)}  ${target}`,
    );
    console.log(`  ID: ${p.id}`);
  }
}

function prettyMilestones(data) {
  const project = data?.data?.project;
  if (!project) return console.log("Project not found.");
  const milestones = project.projectMilestones?.nodes ?? [];
  console.log(`Project: ${project.name}`);
  if (!milestones.length) return console.log("No milestones found.");
  console.log(`${pad("Milestone", 40)} ${pad("Target Date", 15)}`);
  console.log("-".repeat(55));
  for (const m of milestones) {
    console.log(`${pad(m.name, 40)} ${pad(m.targetDate ?? "-", 15)}`);
    console.log(`  ID: ${m.id}`);
  }
}

function prettyProjectIssues(data) {
  const project = data?.data?.project;
  if (!project) return console.log("Project not found.");
  const issues = project.issues?.nodes ?? [];
  console.log(`Project: ${project.name} (${issues.length} issues)`);
  if (!issues.length) return console.log("No issues found.");
  /** @type {Record<string, any[]>} */
  const grouped = {};
  for (const i of issues) {
    const ms = i.projectMilestone?.name ?? "(No milestone)";
    (grouped[ms] ??= []).push(i);
  }
  for (const [msName, msIssues] of Object.entries(grouped)) {
    console.log(`\n## ${msName}`);
    console.log(
      `${pad("ID", 10)} ${pad("Priority", 8)} ${pad("Status", 14)} ${pad("Assignee", 12)} Title`,
    );
    console.log("-".repeat(70));
    for (const i of msIssues) {
      const pid = PRI_LABEL[i.priority] ?? "-";
      const assignee = i.assignee?.name?.split(" ")[0] ?? "-";
      console.log(
        `${pad(i.identifier, 10)} ${pad(pid, 8)} ${pad(i.state.name, 14)} ${pad(assignee, 12)} ${i.title}`,
      );
    }
  }
}

function prettyInitiatives(data) {
  const nodes = data?.data?.initiatives?.nodes ?? [];
  if (!nodes.length) return console.log("No initiatives found.");
  console.log(`${pad("Name", 20)} ${pad("Status", 12)} ${pad("Description", 45)} URL`);
  console.log("-".repeat(110));
  for (const i of nodes) {
    let desc = (i.description ?? "-").slice(0, 42);
    if ((i.description ?? "").length > 42) desc += "...";
    console.log(
      `${pad(i.name, 20)} ${pad(i.status ?? "-", 12)} ${pad(desc, 45)} ${i.url ?? "-"}`,
    );
    console.log(`  ID: ${i.id}`);
  }
}

/** @param {any[]} cycles */
function prettyRebalance(cycles) {
  cycles = cycles
    .filter(Boolean)
    .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
  if (!cycles.length) return console.log("No active/upcoming cycles found.");
  for (const c of cycles) {
    const issues = c.issues?.nodes ?? [];
    const totalEst = issues.reduce((s, i) => s + (i.estimate ?? 0), 0);
    const active = c.isActive ? " [ACTIVE]" : "";
    const progressPct = Math.round((c.progress ?? 0) * 100);
    console.log(`\n${"=".repeat(90)}`);
    console.log(
      `Cycle ${c.number}${active}  (${c.startsAt?.slice(0, 10)} to ${c.endsAt?.slice(0, 10)})  Progress: ${progressPct}%  Issues: ${issues.length}  Est: ${totalEst}`,
    );
    console.log("=".repeat(90));
    /** @type {Record<string, any[]>} */
    const byProject = {};
    for (const i of issues) {
      const proj = i.project?.name ?? "(No project)";
      (byProject[proj] ??= []).push(i);
    }
    for (const proj of Object.keys(byProject).sort()) {
      const pi = byProject[proj];
      const pe = pi.reduce((s, i) => s + (i.estimate ?? 0), 0);
      console.log(`\n  ${proj} (${pi.length} issues, est: ${pe})`);
      console.log(`  ${"-".repeat(70)}`);
      for (const i of pi) {
        const pid = PRI_LABEL[i.priority] ?? "-";
        const assignee = i.assignee?.name?.split(" ")[0] ?? "-";
        const est = i.estimate ?? "-";
        const ms = i.projectMilestone ? ` [${i.projectMilestone.name}]` : "";
        console.log(
          `  ${pad(i.identifier, 10)} ${pad(pid, 8)} ${pad(i.state.name, 14)} ${pad(assignee, 12)} ${padL(est, 3)}  ${i.title}${ms}`,
        );
      }
    }
  }
  console.log();
}

// --- Reusable query fragments ----------------------------------------------

const ISSUE_FIELDS = `id identifier title priority estimate state { name } assignee { name } labels { nodes { name } }`;

// --- Command handlers ------------------------------------------------------
// Each handler: (args: string[], v: Record<string, any>, cfg: Config) => Promise<void>

async function cmdCreateIssue(args, v, cfg) {
  if (!v.title) fail("create-issue requires --title");
  /** @type {Record<string, unknown>} */
  const inp = { title: v.title, teamId: cfg.teamId };
  const desc = readMaybeFile(v, "description");
  if (desc) inp.description = desc;
  if (v.priority != null) inp.priority = resolvePriority(v.priority);
  inp.stateId = v.state ? resolveState(v.state, cfg) : cfg.states["Backlog"];
  if (!inp.stateId) delete inp.stateId;
  if (v.assignee) inp.assigneeId = resolveMember(v.assignee, cfg);
  if (v.labels) inp.labelIds = resolveLabels(v.labels, cfg);
  if (v.estimate != null) inp.estimate = toInt(v.estimate);
  if (v.project) inp.projectId = v.project;
  if (v.milestone) inp.projectMilestoneId = v.milestone;
  if (v.cycle) inp.cycleId = await resolveCycle(v.cycle, cfg);
  if (v.raw) Object.assign(inp, JSON.parse(v.raw));

  emit(
    await gql(
      `mutation IssueCreate($input: IssueCreateInput!) {
         issueCreate(input: $input) {
           success
           issue { id identifier title url priority state { name } assignee { name } labels { nodes { name } } }
         }
       }`,
      { input: inp },
    ),
  );
}

async function cmdListIssues(args, v, cfg) {
  const stateType = args[0]; // backlog|unstarted|started|completed|canceled
  const limit = toInt(v.limit) ?? 50;
  const filter = stateType ? `filter: { state: { type: { eq: "${stateType}" } } },` : "";
  const data = await gql(
    `{ team(id: "${cfg.teamId}") {
         issues(${filter} first: ${limit}, orderBy: updatedAt) {
           nodes { ${ISSUE_FIELDS} cycle { number } }
         }
       } }`,
  );
  v.json ? emit(data) : prettyIssues(data);
}

async function cmdListCycleIssues(args, v, cfg) {
  emit(
    await gql(
      `{ team(id: "${cfg.teamId}") {
           cycles(filter: { isActive: { eq: true } }) {
             nodes { number startsAt endsAt issues { nodes { ${ISSUE_FIELDS} } } }
           }
         } }`,
    ),
  );
}

async function cmdUpdateIssue(args, v, cfg) {
  const issueId = args[0];
  if (!issueId) fail("update-issue requires an issue id");
  /** @type {Record<string, unknown>} */
  const inp = {};
  if (v.title) inp.title = v.title;
  const desc = readMaybeFile(v, "description");
  if (desc) inp.description = desc;
  if (v.priority != null) inp.priority = resolvePriority(v.priority);
  if (v.state) inp.stateId = resolveState(v.state, cfg);
  if (v.assignee) inp.assigneeId = resolveMember(v.assignee, cfg);
  if (v.labels) inp.labelIds = resolveLabels(v.labels, cfg);
  if (v.estimate != null) inp.estimate = toInt(v.estimate);
  if (v.project) inp.projectId = v.project;
  if (v.milestone) inp.projectMilestoneId = v.milestone;
  if (v.cycle) inp.cycleId = await resolveCycle(v.cycle, cfg);
  if (v.raw) Object.assign(inp, JSON.parse(v.raw));
  if (!Object.keys(inp).length) fail("update-issue: nothing to update (pass flags or --raw)");
  emit(await issueUpdate(issueId, inp));
}

/** @param {string} issueId @param {Record<string, unknown>} input */
function issueUpdate(issueId, input) {
  return gql(
    `mutation IssueUpdate($issueId: String!, $input: IssueUpdateInput!) {
       issueUpdate(id: $issueId, input: $input) {
         success
         issue { id identifier title state { name } priority assignee { name } }
       }
     }`,
    { issueId, input },
  );
}

async function cmdMoveIssue(args, v, cfg) {
  const [issueId, ...statusParts] = args;
  const status = statusParts.join(" ");
  if (!issueId || !status) fail('move-issue requires: <issue-id> "<status>"');
  emit(await issueUpdate(issueId, { stateId: resolveState(status, cfg) }));
}

async function cmdAssignIssue(args, v, cfg) {
  const [issueId, member] = args;
  if (!issueId || !member) fail("assign-issue requires: <issue-id> <frontend|backend>");
  emit(await issueUpdate(issueId, { assigneeId: resolveMember(member, cfg) }));
}

async function cmdSearchIssues(args, v, cfg) {
  const term = args[0];
  if (!term) fail("search-issues requires a search term");
  emit(
    await gql(
      `query SearchIssues($term: String!) {
         searchIssues(term: $term, first: 20) {
           nodes { id identifier title state { name } assignee { name } priority }
         }
       }`,
      { term },
    ),
  );
}

async function cmdCreateProject(args, v, cfg) {
  const name = v.name ?? args[0];
  if (!name) fail("create-project requires --name (or a positional name)");
  /** @type {Record<string, unknown>} */
  const inp = { name, teamIds: [cfg.teamId] };
  const desc = readMaybeFile(v, "description");
  if (desc) inp.description = desc;
  const result = await gql(
    `mutation CreateProject($input: ProjectCreateInput!) {
       projectCreate(input: $input) { success project { id name state url } }
     }`,
    { input: inp },
  );
  // Optionally link to an initiative.
  const initiativeId = v.initiative;
  const projectId = result?.data?.projectCreate?.project?.id;
  if (initiativeId && projectId) {
    await gql(
      `mutation LinkInitiativeProject($input: InitiativeToProjectCreateInput!) {
         initiativeToProjectCreate(input: $input) { success }
       }`,
      { input: { initiativeId, projectId } },
    );
  }
  emit(result);
}

async function cmdListProjects(args, v, cfg) {
  const data = await gql(
    `{ team(id: "${cfg.teamId}") {
         projects(first: 50, orderBy: updatedAt) {
           nodes { id name state progress startDate targetDate initiatives { nodes { name } } }
         }
       } }`,
  );
  v.json ? emit(data) : prettyProjects(data);
}

async function cmdListMilestones(args, v, cfg) {
  const projectId = args[0];
  if (!projectId) fail("list-milestones requires a project id");
  const data = await gql(
    `{ project(id: "${projectId}") {
         name
         projectMilestones(first: 50) { nodes { id name targetDate sortOrder } }
       } }`,
  );
  v.json ? emit(data) : prettyMilestones(data);
}

async function cmdListProjectIssues(args, v, cfg) {
  const projectId = args[0];
  if (!projectId) fail("list-project-issues requires a project id");
  const limit = toInt(v.limit) ?? (v.json ? 200 : 50);
  const data = await gql(
    `{ project(id: "${projectId}") {
         name
         issues(first: ${limit}, orderBy: updatedAt) {
           nodes { ${ISSUE_FIELDS.replace("state { name }", "state { name type }")} projectMilestone { id name } }
         }
       } }`,
  );
  v.json ? emit(data) : prettyProjectIssues(data);
}

async function cmdCreateMilestone(args, v, cfg) {
  const [projectId, ...nameParts] = args;
  const name = v.name ?? nameParts.join(" ");
  if (!projectId || !name) fail('create-milestone requires: <project-id> "<name>"');
  /** @type {Record<string, unknown>} */
  const inp = { projectId, name };
  if (v["target-date"]) inp.targetDate = v["target-date"];
  emit(
    await gql(
      `mutation CreateProjectMilestone($input: ProjectMilestoneCreateInput!) {
         projectMilestoneCreate(input: $input) {
           success projectMilestone { id name targetDate sortOrder }
         }
       }`,
      { input: inp },
    ),
  );
}

async function cmdUpdateMilestone(args, v, cfg) {
  const milestoneId = args[0];
  if (!milestoneId) fail("update-milestone requires a milestone id");
  /** @type {Record<string, unknown>} */
  const inp = {};
  if (v.name) inp.name = v.name;
  if (v["target-date"]) inp.targetDate = v["target-date"];
  if (v["sort-order"] != null) inp.sortOrder = toInt(v["sort-order"]);
  if (v.raw) Object.assign(inp, JSON.parse(v.raw));
  if (!Object.keys(inp).length) fail("update-milestone: nothing to update");
  emit(
    await gql(
      `mutation UpdateProjectMilestone($milestoneId: String!, $input: ProjectMilestoneUpdateInput!) {
         projectMilestoneUpdate(id: $milestoneId, input: $input) {
           success projectMilestone { id name targetDate sortOrder }
         }
       }`,
      { milestoneId, input: inp },
    ),
  );
}

async function cmdDeleteMilestone(args, v, cfg) {
  const milestoneId = args[0];
  if (!milestoneId) fail("delete-milestone requires a milestone id");
  emit(
    await gql(
      `mutation DeleteProjectMilestone($milestoneId: String!) {
         projectMilestoneDelete(id: $milestoneId) { success }
       }`,
      { milestoneId },
    ),
  );
}

async function cmdSetIssueMilestone(args, v, cfg) {
  const [issueId, milestoneId] = args;
  if (!issueId) fail('set-issue-milestone requires: <issue-id> <milestone-id|"">');
  // Empty string / "none" unsets the milestone.
  const ms = milestoneId && milestoneId !== "none" ? milestoneId : null;
  emit(
    await gql(
      `mutation IssueUpdate($issueId: String!, $input: IssueUpdateInput!) {
         issueUpdate(id: $issueId, input: $input) {
           success issue { id identifier title projectMilestone { name } }
         }
       }`,
      { issueId, input: { projectMilestoneId: ms } },
    ),
  );
}

async function cmdBatchMoveToMilestone(args, v, cfg) {
  const [milestoneId, ...issueIds] = args;
  if (!milestoneId || !issueIds.length)
    fail("batch-move-to-milestone requires: <milestone-id> <issue-id>...");
  let count = 0;
  for (const id of issueIds) {
    count++;
    console.error(`Moving issue ${count}/${issueIds.length} (${id}) to milestone...`);
    await issueUpdate(id, { projectMilestoneId: milestoneId });
    await sleep(500);
  }
  console.error(`Done. Moved ${issueIds.length} issues.`);
}

async function cmdAddDependency(args, v, cfg) {
  const [blockerId, blockedId] = args;
  if (!blockerId || !blockedId)
    fail("add-dependency requires: <blocker-issue-id> <blocked-issue-id>");
  emit(
    await gql(
      `mutation CreateIssueRelation($input: IssueRelationCreateInput!) {
         issueRelationCreate(input: $input) {
           success
           issueRelation { id type issue { identifier title } relatedIssue { identifier title } }
         }
       }`,
      { input: { issueId: blockerId, relatedIssueId: blockedId, type: "blocks" } },
    ),
  );
}

async function cmdListDependencies(args, v, cfg) {
  const issueId = args[0];
  if (!issueId) fail("list-dependencies requires an issue id");
  emit(
    await gql(
      `{ issue(id: "${issueId}") {
           identifier title
           relations { nodes { id type relatedIssue { identifier title state { name } } } }
           inverseRelations { nodes { id type issue { identifier title state { name } } } }
         } }`,
    ),
  );
}

async function cmdRemoveDependency(args, v, cfg) {
  const relationId = args[0];
  if (!relationId) fail("remove-dependency requires a relation id");
  emit(
    await gql(
      `mutation DeleteIssueRelation($relationId: String!) {
         issueRelationDelete(id: $relationId) { success }
       }`,
      { relationId },
    ),
  );
}

async function cmdAddComment(args, v, cfg) {
  const issueId = args[0];
  const body = readMaybeFile(v, "body") ?? args[1];
  if (!issueId || !body) fail("add-comment requires: <issue-id> --body <text> (or a positional body)");
  emit(
    await gql(
      `mutation CreateComment($input: CommentCreateInput!) {
         commentCreate(input: $input) { success comment { id body user { name } } }
       }`,
      { input: { issueId, body } },
    ),
  );
}

async function cmdCreateInitiative(args, v, cfg) {
  const name = v.name ?? args[0];
  if (!name) fail("create-initiative requires --name (or a positional name)");
  /** @type {Record<string, unknown>} */
  const inp = { name };
  const desc = readMaybeFile(v, "description");
  if (desc) inp.description = desc;
  emit(
    await gql(
      `mutation CreateInitiative($input: InitiativeCreateInput!) {
         initiativeCreate(input: $input) {
           success initiative { id name description status url }
         }
       }`,
      { input: inp },
    ),
  );
}

const INITIATIVE_LIST_QUERY = `{ initiatives(first: 50) { nodes { id name description status url } } }`;

async function cmdListInitiatives(args, v, cfg) {
  const data = await gql(INITIATIVE_LIST_QUERY);
  v.json ? emit(data) : prettyInitiatives(data);
}

async function cmdGetInitiative(args, v, cfg) {
  const id = args[0];
  if (!id) fail("get-initiative requires an initiative id");
  emit(await getInitiativeById(id));
}

/** @param {string} id */
function getInitiativeById(id) {
  return gql(
    `query GetInitiative($id: String!) {
       initiative(id: $id) {
         id name description content status url
         projects { nodes { id name state progress startDate targetDate } }
       }
     }`,
    { id },
  );
}

async function cmdGetInitiativeByName(args, v, cfg) {
  const search = (args[0] ?? "").toLowerCase();
  if (!search) fail("get-initiative-by-name requires a name");
  const all = await gql(INITIATIVE_LIST_QUERY);
  const match = (all?.data?.initiatives?.nodes ?? []).find((i) =>
    i.name.toLowerCase().includes(search),
  );
  if (!match) fail(`No initiative found matching "${args[0]}"`);
  emit(await getInitiativeById(match.id));
}

async function cmdUpdateInitiative(args, v, cfg) {
  const id = args[0];
  if (!id) fail("update-initiative requires an initiative id");
  /** @type {Record<string, unknown>} */
  const inp = {};
  if (v.name) inp.name = v.name;
  const desc = readMaybeFile(v, "description");
  if (desc) inp.description = desc;
  const content = readMaybeFile(v, "content");
  if (content) inp.content = content;
  if (v.raw) Object.assign(inp, JSON.parse(v.raw));
  if (!Object.keys(inp).length) fail("update-initiative: nothing to update");
  emit(
    await gql(
      `mutation UpdateInitiative($initiativeId: String!, $input: InitiativeUpdateInput!) {
         initiativeUpdate(id: $initiativeId, input: $input) {
           success initiative { id name description status url }
         }
       }`,
      { initiativeId: id, input: inp },
    ),
  );
}

async function cmdAddInitiativeLink(args, v, cfg) {
  const [id, url, ...labelParts] = args;
  const label = v.label ?? labelParts.join(" ");
  if (!id || !url || !label)
    fail('add-initiative-link requires: <initiative-id> <url> "<label>"');
  emit(
    await gql(
      `mutation CreateExternalLink($input: EntityExternalLinkCreateInput!) {
         entityExternalLinkCreate(input: $input) {
           success entityExternalLink { id url label }
         }
       }`,
      { input: { initiativeId: id, url, label } },
    ),
  );
}

async function cmdListStates(args, v, cfg) {
  emit(await gql(`{ team(id: "${cfg.teamId}") { states { nodes { id name type position } } } }`));
}

async function cmdListMembers(args, v, cfg) {
  emit(await gql(`{ team(id: "${cfg.teamId}") { members { nodes { id name email } } } }`));
}

async function cmdListLabels(args, v, cfg) {
  emit(await gql(`{ team(id: "${cfg.teamId}") { labels { nodes { id name } } } }`));
}

async function cmdListCycles(args, v, cfg) {
  emit(
    await gql(
      `{ team(id: "${cfg.teamId}") { cycles { nodes { id number startsAt endsAt isActive progress } } } }`,
    ),
  );
}

/** @param {Config} cfg @returns {Promise<string>} */
async function currentCycleId(cfg) {
  const d = await gql(
    `{ team(id: "${cfg.teamId}") { cycles(filter: { isActive: { eq: true } }) { nodes { id } } } }`,
  );
  return d?.data?.team?.cycles?.nodes?.[0]?.id ?? "";
}

async function cmdCurrentCycleId(args, v, cfg) {
  console.log(await currentCycleId(cfg));
}

/** @param {string} cycleId */
function cycleIssuesById(cycleId) {
  return gql(
    `query CycleIssues($cycleId: String!) {
       cycle(id: $cycleId) {
         id number startsAt endsAt isActive progress
         issues(filter: { state: { type: { nin: ["completed", "canceled"] } } }, first: 100) {
           nodes {
             ${ISSUE_FIELDS.replace("state { name }", "state { name type }")}
             project { id name } projectMilestone { id name }
           }
         }
       }
     }`,
    { cycleId },
  );
}

async function cmdListCycleIssuesById(args, v, cfg) {
  const cycleId = args[0];
  if (!cycleId) fail("list-cycle-issues-by-id requires a cycle id");
  emit(await cycleIssuesById(cycleId));
}

/** @param {Config} cfg @returns {Promise<any[]>} */
async function activeAndFutureCycles(cfg) {
  const list = await gql(
    `{ team(id: "${cfg.teamId}") { cycles { nodes { id startsAt endsAt isActive } } } }`,
  );
  const now = new Date().toISOString();
  const cycles = (list?.data?.team?.cycles?.nodes ?? [])
    .filter((c) => c.isActive || c.endsAt > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const results = [];
  for (const c of cycles) {
    const d = await cycleIssuesById(c.id);
    results.push(d?.data?.cycle ?? {});
  }
  return results;
}

async function cmdListCycleIssuesAll(args, v, cfg) {
  emit(await activeAndFutureCycles(cfg));
}

async function cmdRebalancePretty(args, v, cfg) {
  const cycles = await activeAndFutureCycles(cfg);
  v.json ? emit(cycles) : prettyRebalance(cycles);
}

async function cmdMoveIssueToCycle(args, v, cfg) {
  const [issueId, cycleId] = args;
  if (!issueId || !cycleId) fail("move-issue-to-cycle requires: <issue-id> <cycle-id>");
  emit(await issueUpdate(issueId, { cycleId: await resolveCycle(cycleId, cfg) }));
}

async function cmdBatchMoveToCycle(args, v, cfg) {
  const [cycleRef, ...issueIds] = args;
  if (!cycleRef || !issueIds.length)
    fail("batch-move-to-cycle requires: <cycle-id> <issue-id>...");
  const cycleId = await resolveCycle(cycleRef, cfg);
  let success = 0;
  let failCount = 0;
  for (const id of issueIds) {
    const result = await issueUpdate(id, { cycleId });
    if (result?.data?.issueUpdate?.success) {
      success++;
    } else {
      failCount++;
      const msg = result?.errors?.[0]?.message ?? JSON.stringify(result);
      console.error(`FAIL (${id}): ${msg}`);
    }
    await sleep(500);
  }
  console.log(`Moved ${success} issues to cycle (${failCount} failed).`);
}

async function cmdCycleCapacity(args, v, cfg) {
  const pastData = await gql(
    `query { team(id: "${cfg.teamId}") { cycles(filter: { isPast: { eq: true } }, first: 3) { nodes { number completedScopeHistory } } } }`,
  );
  const currentData = await gql(
    `query { team(id: "${cfg.teamId}") { cycles(filter: { isPast: { eq: false } }) { nodes { id number startsAt endsAt isActive currentProgress } } } }`,
  );

  const pastCycles = pastData?.data?.team?.cycles?.nodes ?? [];
  if (!pastCycles.length) return console.log("No past cycles found — cannot calculate velocity.");

  const completedScopes = [];
  for (const c of pastCycles) {
    const h = c.completedScopeHistory ?? [];
    if (h.length) completedScopes.push(h[h.length - 1]);
  }
  if (!completedScopes.length) return console.log("No completed scope data found in past cycles.");

  const velocity = completedScopes.reduce((a, b) => a + b, 0) / completedScopes.length;
  console.log(
    `Velocity (avg completed pts from last ${completedScopes.length} cycles): ${velocity.toFixed(0)} pts`,
  );
  const details = pastCycles
    .filter((c) => (c.completedScopeHistory ?? []).length)
    .map((c) => `C${c.number}=${c.completedScopeHistory[c.completedScopeHistory.length - 1]}`)
    .join(", ");
  console.log(`  (${details})\n`);

  const cycles = (currentData?.data?.team?.cycles?.nodes ?? []).sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
  for (const c of cycles) {
    const scopeEst = c.currentProgress?.scopeEstimate ?? 0;
    const capPct = velocity > 0 ? (scopeEst / velocity) * 100 : 0;
    const label = c.isActive ? " [ACTIVE]" : "";
    console.log(`Cycle ${c.number}${label}  (${c.startsAt.slice(0, 10)} to ${c.endsAt.slice(0, 10)})`);
    console.log(
      `  Estimate pts: ${scopeEst}  |  Capacity: ${capPct.toFixed(0)}%  |  Velocity: ${velocity.toFixed(0)}`,
    );
  }
}

async function cmdApi(args, v, cfg) {
  const query = args[0];
  if (!query) fail('api requires a GraphQL query string (and optional JSON variables)');
  const variables = args[1] ? JSON.parse(args[1]) : {};
  emit(await gql(query, variables));
}

// --- init (interactive workspace bootstrap) --------------------------------

async function cmdInit() {
  if (!API_KEY) fail("LINEAR_API_KEY is not set. Set it first, then re-run `init`.");

  console.error("Fetching workspace data from Linear...");
  const bootstrap = await gql(
    `{ teams(first: 50) { nodes { id key name parent { id } } }
       users(first: 250) { nodes { id name email displayName } } }`,
  );

  const teams = bootstrap?.data?.teams?.nodes ?? [];
  if (!teams.length) {
    console.error("Error: no teams returned. Check LINEAR_API_KEY.");
    console.error("Raw response:");
    console.error(JSON.stringify(bootstrap, null, 2));
    process.exit(1);
  }

  // Prefer a parent team (no parent of its own) so states/labels come from the
  // umbrella team rather than a sub-team.
  const parents = teams.filter((t) => !t.parent);
  const chosenTeam = parents[0] ?? teams[0];

  const teamExtra = await gql(
    `query TeamExtra($id: String!) {
       team(id: $id) { states { nodes { id name type } } labels { nodes { id name } } }
     }`,
    { id: chosenTeam.id },
  );

  // Filter out Linear's integration/bot users.
  const users = (bootstrap?.data?.users?.nodes ?? []).filter(
    (u) => !(u.email ?? "").endsWith("@linear.linear.app"),
  );

  console.error("\nMembers in your Linear workspace:");
  users.forEach((u, i) => {
    const name = u.name || u.displayName || "(unnamed)";
    console.error(`  ${i + 1}. ${name} <${u.email || "-"}>`);
  });
  console.error("");

  const rl = createInterface({ input, output });
  const frontendIdx = await rl.question("Which member is the Frontend/PM lead? Enter number: ");
  const backendIdx = await rl.question("Which member is the Backend lead? Enter number: ");
  rl.close();

  /** @param {string} idxStr */
  const pick = (idxStr) => {
    const i = Number.parseInt(idxStr, 10);
    if (i >= 1 && i <= users.length) {
      const u = users[i - 1];
      return { id: u.id, name: u.name || u.displayName || "", email: u.email || "" };
    }
    fail(`Invalid selection: ${JSON.stringify(idxStr)}`);
  };

  const frontend = pick(frontendIdx);
  const backend = pick(backendIdx);

  const WANTED_STATES = ["Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled"];
  const WANTED_LABELS = ["discovery", "tech-debt", "backend", "frontend", "db", "bug", "feature", "improvement"];

  const stateNodes = teamExtra?.data?.team?.states?.nodes ?? [];
  const labelNodes = teamExtra?.data?.team?.labels?.nodes ?? [];

  /** @type {Record<string, string>} */
  const states = {};
  const stateLookup = new Map(stateNodes.map((s) => [s.name.toLowerCase(), s]));
  for (const name of WANTED_STATES) {
    const s = stateLookup.get(name.toLowerCase());
    if (s) states[name] = s.id;
  }

  const norm = (s) => s.toLowerCase().replace(/-/g, " ").trim();
  /** @type {Record<string, string>} */
  const labels = {};
  const labelLookup = new Map(labelNodes.map((l) => [norm(l.name), l]));
  for (const name of WANTED_LABELS) {
    const l = labelLookup.get(norm(name));
    if (l) labels[name] = l.id;
  }

  // Parent teams first so teams[0] is the umbrella team.
  const teamsSorted = [...teams].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));

  const cfg = {
    teams: teamsSorted.map((t) => ({ id: t.id, key: t.key, name: t.name })),
    roles: { frontend_lead: frontend, backend_lead: backend },
    states,
    labels,
  };

  mkdirSync(dirname(WORKSPACE_FILE), { recursive: true });
  writeFileSync(WORKSPACE_FILE, JSON.stringify(cfg, null, 2));
  console.error(`\nWrote ${WORKSPACE_FILE}.`);
}

// --- Dispatch --------------------------------------------------------------

/** Commands that don't need a workspace config loaded. */
const NO_CONFIG = new Set(["init", "api", "help"]);

/** @type {Record<string, (args: string[], v: Record<string, any>, cfg: Config) => Promise<void>>} */
const COMMANDS = {
  "create-issue": cmdCreateIssue,
  "list-issues": cmdListIssues,
  "list-cycle-issues": cmdListCycleIssues,
  "update-issue": cmdUpdateIssue,
  "move-issue": cmdMoveIssue,
  "assign-issue": cmdAssignIssue,
  "search-issues": cmdSearchIssues,
  "create-project": cmdCreateProject,
  "list-projects": cmdListProjects,
  "list-milestones": cmdListMilestones,
  "list-project-issues": cmdListProjectIssues,
  "create-milestone": cmdCreateMilestone,
  "update-milestone": cmdUpdateMilestone,
  "delete-milestone": cmdDeleteMilestone,
  "set-issue-milestone": cmdSetIssueMilestone,
  "batch-move-to-milestone": cmdBatchMoveToMilestone,
  "add-dependency": cmdAddDependency,
  "list-dependencies": cmdListDependencies,
  "remove-dependency": cmdRemoveDependency,
  "add-comment": cmdAddComment,
  "create-initiative": cmdCreateInitiative,
  "list-initiatives": cmdListInitiatives,
  "get-initiative": cmdGetInitiative,
  "get-initiative-by-name": cmdGetInitiativeByName,
  "update-initiative": cmdUpdateInitiative,
  "add-initiative-link": cmdAddInitiativeLink,
  "list-states": cmdListStates,
  "list-members": cmdListMembers,
  "list-labels": cmdListLabels,
  "list-cycles": cmdListCycles,
  "list-cycle-issues-by-id": cmdListCycleIssuesById,
  "list-cycle-issues-all": cmdListCycleIssuesAll,
  "rebalance": cmdRebalancePretty,
  "current-cycle-id": cmdCurrentCycleId,
  "move-issue-to-cycle": cmdMoveIssueToCycle,
  "batch-move-to-cycle": cmdBatchMoveToCycle,
  "cycle-capacity": cmdCycleCapacity,
  "api": cmdApi,
};

const USAGE = `Linear CLI — node linear.mjs <command> [args] [--flags]

Setup:
  init                                   Interactive: fetch workspace, write ~/.config/linctl/workspace.json

Issues:
  create-issue --title T [--description D|--description-file F] [--priority P]
               [--state S] [--assignee frontend|backend] [--labels a,b]
               [--estimate N] [--project ID] [--milestone ID] [--cycle ID|current] [--raw JSON]
  list-issues [backlog|unstarted|started|completed|canceled] [--limit N] [--json]
  list-cycle-issues
  update-issue <id> [--state S] [--priority P] [--assignee R] [--labels a,b]
               [--project ID] [--milestone ID] [--cycle ID] [--title T] [--raw JSON]
  move-issue <id> "<status>"             e.g. move-issue <id> "In Progress"
  assign-issue <id> <frontend|backend>
  search-issues "<term>"

Projects & milestones:
  create-project --name N [--initiative ID] [--description D]
  list-projects [--json]
  list-milestones <project-id> [--json]
  list-project-issues <project-id> [--limit N] [--json]
  create-milestone <project-id> "<name>" [--target-date YYYY-MM-DD]
  update-milestone <id> [--name N] [--target-date D] [--sort-order N] [--raw JSON]
  delete-milestone <id>
  set-issue-milestone <issue-id> <milestone-id|none>
  batch-move-to-milestone <milestone-id> <issue-id>...

Dependencies & comments:
  add-dependency <blocker-id> <blocked-id>
  list-dependencies <issue-id>
  remove-dependency <relation-id>
  add-comment <issue-id> --body "<text>" | --body-file F

Initiatives:
  create-initiative --name N [--description D]
  list-initiatives [--json]
  get-initiative <id>
  get-initiative-by-name "<name>"
  update-initiative <id> [--content C|--content-file F] [--description D] [--name N] [--raw JSON]
  add-initiative-link <id> <url> "<label>"

Cycles:
  list-cycles
  current-cycle-id
  cycle-capacity
  rebalance [--json]                     Active/upcoming cycles, grouped by project
  list-cycle-issues-by-id <cycle-id>
  list-cycle-issues-all
  move-issue-to-cycle <issue-id> <cycle-id|current>
  batch-move-to-cycle <cycle-id|current> <issue-id>...   (0.5s delay between calls)

Info:
  list-states | list-members | list-labels

Escape hatch:
  api '<graphql>' ['<json-variables>']   Raw GraphQL request

Symbolic names: --state accepts todo|backlog|"in progress"|"in review"|done|canceled or a UUID;
  --assignee accepts frontend|backend or a UUID; --labels accepts label names or UUIDs;
  --priority accepts 0-4 or none|urgent|high|medium|low; --cycle accepts "current" or a UUID.`;

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      title: { type: "string" },
      description: { type: "string" },
      "description-file": { type: "string" },
      priority: { type: "string" },
      state: { type: "string" },
      assignee: { type: "string" },
      labels: { type: "string" },
      estimate: { type: "string" },
      project: { type: "string" },
      milestone: { type: "string" },
      cycle: { type: "string" },
      initiative: { type: "string" },
      "target-date": { type: "string" },
      name: { type: "string" },
      content: { type: "string" },
      "content-file": { type: "string" },
      body: { type: "string" },
      "body-file": { type: "string" },
      url: { type: "string" },
      label: { type: "string" },
      "sort-order": { type: "string" },
      limit: { type: "string" },
      raw: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  const [command, ...args] = positionals;

  if (!command || command === "help" || values.help) {
    console.log(USAGE);
    return;
  }

  if (command === "init") return cmdInit();

  const handler = COMMANDS[command];
  if (!handler) fail(`unknown command "${command}". Run \`node linear.mjs help\`.`);

  const cfg = NO_CONFIG.has(command) ? /** @type {Config} */ ({}) : requireConfig();
  await handler(args, values, cfg);
}

main().catch((err) => fail(err?.stack ?? String(err)));
