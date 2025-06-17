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
      ? "8511891"
      : "0"
  );

fs.writeFileSync("subgraph.yaml", replaced);
fs.writeFileSync(
  "src/contracts.ts",
  `
export const vaultAddress = "${process.env.VAULT_ADDRESS}";
export const sirAddress = "${process.env.SIR_ADDRESS}";
export const zeroAddress = "0x0000000000000000000000000000000000000000";
export const quoterAddress = "${process.env.NETWORK === "mainnet" ? 
  "0x5e55c9e631fae526cd4b0526c4818d6e0a9ef0e3" : process.env.NETWORK === "sepolia" ?
  "0xe3c07ebF66b9D070b589bCCa30903891F71A92Be" : process.env.QUOTER_ADDRESS }";
export const usdcAddress = "${process.env.NETWORK === "mainnet" ? 
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" : process.env.NETWORK === "sepolia" ?
  "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" : process.env.USDC_ADDRESS }";
export const wethAddress = "${process.env.NETWORK === "mainnet" ? 
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" : process.env.NETWORK === "sepolia" ?
  "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" : process.env.WETH_ADDRESS }";
`,
);
console.log("src/contracts.ts and subgraph.yaml generated successfully.");
