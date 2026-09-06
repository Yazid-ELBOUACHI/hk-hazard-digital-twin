// Decoders for the base64 typed arrays written by scripts/build-live-data.mjs.

function bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function u8(b64: string): Uint8Array {
  return bytes(b64);
}

export function u16(b64: string): Uint16Array {
  const b = bytes(b64);
  return new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2);
}
