require("dotenv").config();
const fs = require("fs");

const subgraphTemplate = fs.readFileSync("subgraph.template.yaml", "utf-8");

const replaced = subgraphTemplate
  .replaceAll("{{VAULT_ADDRESS}}", process.env.VAULT_ADDRESS)
  .replaceAll("{{SIR_ADDRESS}}", process.env.SIR_ADDRESS)
  .replaceAll("{{NETWORK}}", process.env.NETWORK)
  .replaceAll(
    "{{START_BLOCK}}",
    process.env.NETWORK === "mainnet"
      ? "20830200"
      : process.env.NETWORK === "sepolia"
      ? "7000000"
      : "0",
  );

fs.writeFileSync("subgraph.yaml", replaced);
fs.writeFileSync(
  "src/contracts.ts",
  `
export const vaultAddress = "${process.env.VAULT_ADDRESS}";
export const sirAddress = "${process.env.SIR_ADDRESS}";
export const zeroAddress = "0x0000000000000000000000000000000000000000";
export const quoterAddress = "${process.env.QUOTER_ADDRESS}";
export const usdcAddress = "${process.env.USDC_ADDRESS}";
export const wethAddress = "${process.env.USDC_ADDRESS}";
`,
);
console.log("src/contracts.ts and subgraph.yaml generated successfully.");
