const branch = process.env.GITHUB_REF_NAME || "";
const isPreview = branch === "develop";

const plugins = [
  ["@semantic-release/commit-analyzer", { preset: "conventionalcommits" }],
  ["@semantic-release/release-notes-generator", { preset: "conventionalcommits" }],
  ...(isPreview ? [] : [["@semantic-release/changelog", { changelogFile: "CHANGELOG.md" }]]),
  "@semantic-release/npm",
  ["@semantic-release/github", { assets: [] }],
  ...(isPreview
    ? []
    : [
        [
          "@semantic-release/git",
          {
            assets: ["CHANGELOG.md", "package.json", "package-lock.json"],
            message: "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}"
          }
        ]
      ])
];

module.exports = {
  branches: [
    "main",
    { name: "develop", prerelease: "develop" }
  ],
  plugins
};
