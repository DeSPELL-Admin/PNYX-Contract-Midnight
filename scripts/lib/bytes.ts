import { createHash } from "node:crypto";

/* Byte helpers shared by the scripts. Mirrors test/helpers/bytes.ts (kept separate so the
 * scripts do not import test code). */

export function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) throw new Error(`invalid hex: ${hex}`);
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
}

/** 32-byte value from hex (64 chars) — e.g. a coin public key or domain tag. */
export function bytes32(hex: string, label = "value"): Uint8Array {
    const b = fromHex(hex);
    if (b.length !== 32) throw new Error(`${label} must be 32 bytes (64 hex chars), got ${b.length}`);
    return b;
}

/** Left-pad a UTF-8 string into Bytes<32>. Mirrors Compact `pad(32, "...")`. */
export function pad32(text: string): Uint8Array {
    const enc = new TextEncoder().encode(text);
    if (enc.length > 32) throw new Error(`pad32: "${text}" exceeds 32 bytes`);
    const out = new Uint8Array(32);
    out.set(enc, 0);
    return out;
}

/** settle option → Bytes<32>: pad when it fits, sha256 otherwise (case-sensitive). */
export function optionTag(option: string): Uint8Array {
    const enc = new TextEncoder().encode(option);
    return enc.length <= 32 ? pad32(option) : new Uint8Array(createHash("sha256").update(enc).digest());
}

export function sha256(data: Uint8Array | string): Uint8Array {
    return new Uint8Array(createHash("sha256").update(data).digest());
}

export function isZero(b: Uint8Array): boolean {
    return b.every((x) => x === 0);
}
