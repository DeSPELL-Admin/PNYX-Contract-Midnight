import { randomBytes as nodeRandomBytes, createHash } from "node:crypto";

/** 32-byte zero value — Compact `default<Bytes<32>>`. Mirrors `address(0)` in the Solidity tests. */
export const ZERO_BYTES32 = new Uint8Array(32);

export function randomBytes(length = 32): Uint8Array {
    return new Uint8Array(nodeRandomBytes(length));
}

export function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
}

/** Left-pad a UTF-8 string into Bytes<32>. Mirrors Compact `pad(32, "...")`. */
export function pad32(text: string): Uint8Array {
    const enc = new TextEncoder().encode(text);
    if (enc.length > 32) throw new Error(`pad32: "${text}" exceeds 32 bytes`);
    const out = new Uint8Array(32);
    out.set(enc, 0);
    return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * A "wallet" in the simulator is just a Zswap coin public key (32 bytes, hex-encoded for the
 * runtime). `ownPublicKey()` inside a circuit returns these bytes, which the contracts use as
 * the caller identity (the Midnight analogue of `msg.sender`).
 */
export type Wallet = { readonly hex: string; readonly bytes: Uint8Array };

export function makeWallet(seed?: Uint8Array): Wallet {
    const bytes = seed ?? randomBytes(32);
    return { hex: toHex(bytes), bytes };
}

/**
 * Encode a settle option ("bet" | "cancel" | "reward" | anything) into Bytes<32>.
 * Short strings are padded like Compact `pad(32, s)`; longer ones are hashed. Case-sensitive,
 * exactly like `keccak256(bytes(_option))` in the Solidity contract.
 */
export function optionTag(option: string): Uint8Array {
    const enc = new TextEncoder().encode(option);
    if (enc.length <= 32) return pad32(option);
    return new Uint8Array(createHash("sha256").update(enc).digest());
}
