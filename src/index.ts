import { VaultInitialized } from "../generated/VaultExternal/VaultExternal";
import { Vault } from "../generated/schema";
import { ERC20 } from "../generated/VaultExternal/ERC20";
import { APE } from "../generated/templates";
export function handleVaultInitialized(event: VaultInitialized): void {
  const collateralTokenContract = ERC20.bind(event.params.collateralToken);
  const debtTokenContract = ERC20.bind(event.params.debtToken);
  const debtSymbol = debtTokenContract.symbol();
  const collateralSymbol = collateralTokenContract.symbol();
  let vault = Vault.load(event.params.vaultId.toHexString());
  APE.create(event.params.ape);
  if (vault) {
    return;
  } else {
    vault = new Vault(event.params.vaultId.toHexString());
    vault.collateralToken = event.params.collateralToken.toHexString();
    vault.debtToken = event.params.debtToken.toHex();
    vault.leverageTier = event.params.leverageTier;
    vault.collateralSymbol = collateralSymbol;
    vault.debtSymbol = debtSymbol;
    vault.vaultId = event.params.vaultId.toString();
    vault.save();
    return;
  }
}
