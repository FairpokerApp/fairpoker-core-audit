import {bytesToBase64Url, utf8Bytes} from "./encoding";

export async function sha256Bytes(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', utf8Bytes(input)));
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = await sha256Bytes(input);
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Base64Url(input: string): Promise<string> {
  return bytesToBase64Url(await sha256Bytes(input));
}
