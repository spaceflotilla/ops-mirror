#!/usr/bin/env node
/**
 * Prints a random {project}-{color}-{animal} branch name for Flotilla previews.
 * Usage: node scripts/new-preview-branch.mjs <project-slug>
 *    or: npm run new-branch -- orbit
 */

const COLORS = [
  "amber",
  "azure",
  "bronze",
  "coral",
  "crimson",
  "cyan",
  "emerald",
  "gold",
  "indigo",
  "ivory",
  "jade",
  "lavender",
  "magenta",
  "maroon",
  "navy",
  "olive",
  "orchid",
  "pearl",
  "plum",
  "rose",
  "ruby",
  "sage",
  "sapphire",
  "scarlet",
  "sepia",
  "silver",
  "slate",
  "teal",
  "topaz",
  "violet",
];

const ANIMALS = [
  "albatross",
  "badger",
  "capybara",
  "caribou",
  "chinchilla",
  "cobra",
  "condor",
  "cormorant",
  "crane",
  "dolphin",
  "dragonfly",
  "egret",
  "falcon",
  "ferret",
  "finch",
  "flamingo",
  "fox",
  "gecko",
  "gibbon",
  "gull",
  "hare",
  "heron",
  "ibex",
  "iguana",
  "jackal",
  "kestrel",
  "kingfisher",
  "koala",
  "lemur",
  "leopard",
  "llama",
  "lynx",
  "macaw",
  "mongoose",
  "narwhal",
  "newt",
  "ocelot",
  "octopus",
  "orca",
  "osprey",
  "otter",
  "owl",
  "panda",
  "panther",
  "parrot",
  "pelican",
  "penguin",
  "perch",
  "puffin",
  "python",
  "quail",
  "rabbit",
  "raccoon",
  "raven",
  "salamander",
  "seal",
  "shark",
  "sparrow",
  "squid",
  "starling",
  "stork",
  "swan",
  "tapir",
  "tern",
  "tiger",
  "toucan",
  "turtle",
  "viper",
  "walrus",
  "warbler",
  "wolverine",
  "wombat",
  "yak",
  "zebra",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function normalizeProject(raw) {
  if (!raw || typeof raw !== "string") return "";
  const s = raw.trim().toLowerCase().replace(/\s+/g, "-");
  return s.replace(/[^a-z0-9._-]/g, "").replace(/^-+|-+$/g, "");
}

const project = normalizeProject(process.argv[2] ?? "");
if (!project) {
  console.error(
    "Usage: node scripts/new-preview-branch.mjs <project-slug>\n" +
      "Example: node scripts/new-preview-branch.mjs orbit\n" +
      "         npm run new-branch -- react_deck",
  );
  process.exit(1);
}

const branch = `${project}-${pick(COLORS)}-${pick(ANIMALS)}`;
console.log(branch);
console.error(
  "\nSuggested:\n" +
    `  git checkout -b ${branch}\n` +
    "  git push -u origin " +
    branch +
    "\n\nThen open the preview dashboard or wait for the orchestrator webhook.",
);
