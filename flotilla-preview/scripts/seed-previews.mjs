/**
 * Seed registry previews by posting GitLab-shaped push webhooks.
 * Usage (PowerShell):
 *   $env:WEBHOOK_SECRET = (railway variable...)
 *   node scripts/seed-previews.mjs
 */
const ORCH =
  process.env.ORCHESTRATOR_URL?.replace(/\/$/, "") ||
  "https://ops-mirror-production.up.railway.app";
const secret = process.env.GITLAB_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;
if (!secret) {
  console.error("Set GITLAB_WEBHOOK_SECRET or WEBHOOK_SECRET");
  process.exit(1);
}

/** Canonical preview branches for each site (slug = branch). */
const SEEDS = [
  {
    project: "web/react_deck",
    branch: "pitch-teal-otter",
    title: "Investor pitch deck preview",
  },
  {
    project: "web/orbit",
    branch: "orbit-cyan-otter",
    title: "Orbit visualization (assets on flotilla.space)",
  },
  {
    project: "web/trades",
    branch: "trades-amber-fox",
    title: "Trades calculators",
  },
  {
    project: "web/landing-page",
    branch: "landing-page-blue-whale",
    title: "Marketing landing page",
  },
  {
    project: "web/astrolabe",
    branch: "astrolabe-green-lynx",
    title: "Astrolabe planning app",
  },
  {
    project: "web/ops",
    branch: "ops-teal-otter",
    title: "Ops / preview pipeline dashboard",
  },
];

async function seedOne(s) {
  const body = {
    object_kind: "push",
    ref: `refs/heads/${s.branch}`,
    checkout_sha: "seed" + Date.now().toString(16).slice(-8),
    commits: [{ id: "seed", title: s.title, message: s.title }],
    project: { path_with_namespace: s.project },
  };
  const res = await fetch(`${ORCH}/webhooks/gitlab`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-gitlab-token": secret,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(s.branch, res.status, text.slice(0, 200));
  if (!res.ok) throw new Error(text);
}

for (const s of SEEDS) {
  await seedOne(s);
}
console.log("done");
