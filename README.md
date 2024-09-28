### Instructions to deploy on Alchemy
1. `npm i` to install dependencies 
2. Change the following fields in subgraph.yaml under field `dataSources`:
   - `address` : The address of the contracts
   - `startBlock` : Block of the contract deployment or earlier, it helps index more efficiently since it avoids having to scan the blockchain since inception
   - `network` : E.g., mainnet, sepolia, etc. See https://thegraph.com/docs/en/developing/supported-networks/
4. Go to https://subgraphs.alchemy.com/onboarding
5. Change the addresses in contract.ts
6. Follow instructions on **Deploy to CLI**. Use `npx graph` to run the `graph` cli as a local dependancy.
