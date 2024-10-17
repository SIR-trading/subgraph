// THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.

import {
  TypedMap,
  Entity,
  Value,
  ValueKind,
  store,
  Bytes,
  BigInt,
  BigDecimal,
} from "@graphprotocol/graph-ts";

export class Vault extends Entity {
  constructor(id: string) {
    super();
    this.set("id", Value.fromString(id));
  }

  save(): void {
    let id = this.get("id");
    assert(id != null, "Cannot save Vault entity without an ID");
    if (id) {
      assert(
        id.kind == ValueKind.STRING,
        `Entities of type Vault must have an ID of type String but the id '${id.displayData()}' is of type ${id.displayKind()}`,
      );
      store.set("Vault", id.toString(), this);
    }
  }

  static loadInBlock(id: string): Vault | null {
    return changetype<Vault | null>(store.get_in_block("Vault", id));
  }

  static load(id: string): Vault | null {
    return changetype<Vault | null>(store.get("Vault", id));
  }

  get id(): string {
    let value = this.get("id");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set id(value: string) {
    this.set("id", Value.fromString(value));
  }

  get vaultId(): string {
    let value = this.get("vaultId");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set vaultId(value: string) {
    this.set("vaultId", Value.fromString(value));
  }

  get collateralToken(): string {
    let value = this.get("collateralToken");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set collateralToken(value: string) {
    this.set("collateralToken", Value.fromString(value));
  }

  get debtToken(): string {
    let value = this.get("debtToken");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set debtToken(value: string) {
    this.set("debtToken", Value.fromString(value));
  }

  get collateralSymbol(): string {
    let value = this.get("collateralSymbol");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set collateralSymbol(value: string) {
    this.set("collateralSymbol", Value.fromString(value));
  }

  get debtSymbol(): string {
    let value = this.get("debtSymbol");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set debtSymbol(value: string) {
    this.set("debtSymbol", Value.fromString(value));
  }

  get leverageTier(): i32 {
    let value = this.get("leverageTier");
    if (!value || value.kind == ValueKind.NULL) {
      return 0;
    } else {
      return value.toI32();
    }
  }

  set leverageTier(value: i32) {
    this.set("leverageTier", Value.fromI32(value));
  }

  get totalValue(): BigInt {
    let value = this.get("totalValue");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toBigInt();
    }
  }

  set totalValue(value: BigInt) {
    this.set("totalValue", Value.fromBigInt(value));
  }

  get lockedLiquidity(): BigInt {
    let value = this.get("lockedLiquidity");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toBigInt();
    }
  }

  set lockedLiquidity(value: BigInt) {
    this.set("lockedLiquidity", Value.fromBigInt(value));
  }

  get totalTea(): BigInt {
    let value = this.get("totalTea");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toBigInt();
    }
  }

  set totalTea(value: BigInt) {
    this.set("totalTea", Value.fromBigInt(value));
  }

  get apeCollateral(): BigInt {
    let value = this.get("apeCollateral");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toBigInt();
    }
  }

  set apeCollateral(value: BigInt) {
    this.set("apeCollateral", Value.fromBigInt(value));
  }

  get teaCollateral(): BigInt {
    let value = this.get("teaCollateral");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toBigInt();
    }
  }

  set teaCollateral(value: BigInt) {
    this.set("teaCollateral", Value.fromBigInt(value));
  }

  get taxAmount(): BigInt {
    let value = this.get("taxAmount");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toBigInt();
    }
  }

  set taxAmount(value: BigInt) {
    this.set("taxAmount", Value.fromBigInt(value));
  }

  get apeAddress(): Bytes {
    let value = this.get("apeAddress");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toBytes();
    }
  }

  set apeAddress(value: Bytes) {
    this.set("apeAddress", Value.fromBytes(value));
  }

  get apeDecimals(): i32 {
    let value = this.get("apeDecimals");
    if (!value || value.kind == ValueKind.NULL) {
      return 0;
    } else {
      return value.toI32();
    }
  }

  set apeDecimals(value: i32) {
    this.set("apeDecimals", Value.fromI32(value));
  }
}

export class Test extends Entity {
  constructor(id: string) {
    super();
    this.set("id", Value.fromString(id));
  }

  save(): void {
    let id = this.get("id");
    assert(id != null, "Cannot save Test entity without an ID");
    if (id) {
      assert(
        id.kind == ValueKind.STRING,
        `Entities of type Test must have an ID of type String but the id '${id.displayData()}' is of type ${id.displayKind()}`,
      );
      store.set("Test", id.toString(), this);
    }
  }

  static loadInBlock(id: string): Test | null {
    return changetype<Test | null>(store.get_in_block("Test", id));
  }

  static load(id: string): Test | null {
    return changetype<Test | null>(store.get("Test", id));
  }

  get id(): string {
    let value = this.get("id");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set id(value: string) {
    this.set("id", Value.fromString(value));
  }

  get amount(): BigInt {
    let value = this.get("amount");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toBigInt();
    }
  }

  set amount(value: BigInt) {
    this.set("amount", Value.fromBigInt(value));
  }
}

export class UserPosition extends Entity {
  constructor(id: string) {
    super();
    this.set("id", Value.fromString(id));
  }

  save(): void {
    let id = this.get("id");
    assert(id != null, "Cannot save UserPosition entity without an ID");
    if (id) {
      assert(
        id.kind == ValueKind.STRING,
        `Entities of type UserPosition must have an ID of type String but the id '${id.displayData()}' is of type ${id.displayKind()}`,
      );
      store.set("UserPosition", id.toString(), this);
    }
  }

  static loadInBlock(id: string): UserPosition | null {
    return changetype<UserPosition | null>(
      store.get_in_block("UserPosition", id),
    );
  }

  static load(id: string): UserPosition | null {
    return changetype<UserPosition | null>(store.get("UserPosition", id));
  }

  get id(): string {
    let value = this.get("id");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set id(value: string) {
    this.set("id", Value.fromString(value));
  }

  get balance(): BigInt {
    let value = this.get("balance");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toBigInt();
    }
  }

  set balance(value: BigInt) {
    this.set("balance", Value.fromBigInt(value));
  }

  get positionDecimals(): i32 {
    let value = this.get("positionDecimals");
    if (!value || value.kind == ValueKind.NULL) {
      return 0;
    } else {
      return value.toI32();
    }
  }

  set positionDecimals(value: i32) {
    this.set("positionDecimals", Value.fromI32(value));
  }

  get APE(): string {
    let value = this.get("APE");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set APE(value: string) {
    this.set("APE", Value.fromString(value));
  }

  get user(): Bytes {
    let value = this.get("user");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toBytes();
    }
  }

  set user(value: Bytes) {
    this.set("user", Value.fromBytes(value));
  }

  get collateralSymbol(): string {
    let value = this.get("collateralSymbol");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set collateralSymbol(value: string) {
    this.set("collateralSymbol", Value.fromString(value));
  }

  get debtSymbol(): string {
    let value = this.get("debtSymbol");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set debtSymbol(value: string) {
    this.set("debtSymbol", Value.fromString(value));
  }

  get collateralToken(): string {
    let value = this.get("collateralToken");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set collateralToken(value: string) {
    this.set("collateralToken", Value.fromString(value));
  }

  get debtToken(): string {
    let value = this.get("debtToken");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set debtToken(value: string) {
    this.set("debtToken", Value.fromString(value));
  }

  get leverageTier(): string {
    let value = this.get("leverageTier");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set leverageTier(value: string) {
    this.set("leverageTier", Value.fromString(value));
  }

  get vaultId(): string {
    let value = this.get("vaultId");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set vaultId(value: string) {
    this.set("vaultId", Value.fromString(value));
  }
}

export class UserPositionTea extends Entity {
  constructor(id: string) {
    super();
    this.set("id", Value.fromString(id));
  }

  save(): void {
    let id = this.get("id");
    assert(id != null, "Cannot save UserPositionTea entity without an ID");
    if (id) {
      assert(
        id.kind == ValueKind.STRING,
        `Entities of type UserPositionTea must have an ID of type String but the id '${id.displayData()}' is of type ${id.displayKind()}`,
      );
      store.set("UserPositionTea", id.toString(), this);
    }
  }

  static loadInBlock(id: string): UserPositionTea | null {
    return changetype<UserPositionTea | null>(
      store.get_in_block("UserPositionTea", id),
    );
  }

  static load(id: string): UserPositionTea | null {
    return changetype<UserPositionTea | null>(store.get("UserPositionTea", id));
  }

  get id(): string {
    let value = this.get("id");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set id(value: string) {
    this.set("id", Value.fromString(value));
  }

  get positionDecimals(): i32 {
    let value = this.get("positionDecimals");
    if (!value || value.kind == ValueKind.NULL) {
      return 0;
    } else {
      return value.toI32();
    }
  }

  set positionDecimals(value: i32) {
    this.set("positionDecimals", Value.fromI32(value));
  }

  get balance(): BigInt {
    let value = this.get("balance");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toBigInt();
    }
  }

  set balance(value: BigInt) {
    this.set("balance", Value.fromBigInt(value));
  }

  get user(): Bytes {
    let value = this.get("user");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toBytes();
    }
  }

  set user(value: Bytes) {
    this.set("user", Value.fromBytes(value));
  }

  get collateralSymbol(): string {
    let value = this.get("collateralSymbol");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set collateralSymbol(value: string) {
    this.set("collateralSymbol", Value.fromString(value));
  }

  get debtSymbol(): string {
    let value = this.get("debtSymbol");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set debtSymbol(value: string) {
    this.set("debtSymbol", Value.fromString(value));
  }

  get collateralToken(): Bytes {
    let value = this.get("collateralToken");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toBytes();
    }
  }

  set collateralToken(value: Bytes) {
    this.set("collateralToken", Value.fromBytes(value));
  }

  get debtToken(): Bytes {
    let value = this.get("debtToken");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toBytes();
    }
  }

  set debtToken(value: Bytes) {
    this.set("debtToken", Value.fromBytes(value));
  }

  get leverageTier(): string {
    let value = this.get("leverageTier");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set leverageTier(value: string) {
    this.set("leverageTier", Value.fromString(value));
  }

  get vaultId(): string {
    let value = this.get("vaultId");
    if (!value || value.kind == ValueKind.NULL) {
      throw new Error("Cannot return null for a required field.");
    } else {
      return value.toString();
    }
  }

  set vaultId(value: string) {
    this.set("vaultId", Value.fromString(value));
  }
}
