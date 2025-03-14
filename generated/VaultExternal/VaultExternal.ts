// THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.

import {
  ethereum,
  JSONValue,
  TypedMap,
  Entity,
  Bytes,
  Address,
  BigInt,
} from "@graphprotocol/graph-ts";

export class VaultInitialized extends ethereum.Event {
  get params(): VaultInitialized__Params {
    return new VaultInitialized__Params(this);
  }
}

export class VaultInitialized__Params {
  _event: VaultInitialized;

  constructor(event: VaultInitialized) {
    this._event = event;
  }

  get debtToken(): Address {
    return this._event.parameters[0].value.toAddress();
  }

  get collateralToken(): Address {
    return this._event.parameters[1].value.toAddress();
  }

  get leverageTier(): i32 {
    return this._event.parameters[2].value.toI32();
  }

  get vaultId(): BigInt {
    return this._event.parameters[3].value.toBigInt();
  }

  get ape(): Address {
    return this._event.parameters[4].value.toAddress();
  }
}

export class VaultExternal extends ethereum.SmartContract {
  static bind(address: Address): VaultExternal {
    return new VaultExternal("VaultExternal", address);
  }
}
