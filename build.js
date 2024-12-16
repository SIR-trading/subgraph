require("dotenv").config();
const fs = require("fs");

const subgraphTemplate = fs.readFileSync("subgraph.template.yaml", "utf-8");

const replaced = subgraphTemplate
  .replaceAll("{{VAULT_ADDRESS}}", process.env.VAULT_ADDRESS)
  .replaceAll("{{SIR_ADDRESS}}", process.env.SIR_ADDRESS);

fs.writeFileSync("subgraph.yaml", replaced);
fs.writeFileSync(
  "src/contracts.ts",
  `
export const vaultAddress = "${process.env.VAULT_ADDRESS}";
export const sirAddress = "${process.env.SIR_ADDRESS}";
export const zeroAddress = "0x0000000000000000000000000000000000000000";
`,
);
console.log("src/contracts.ts and subgraph.yaml generated successfully.");
