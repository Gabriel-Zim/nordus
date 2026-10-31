import { createDecipheriv, createECDH, createHmac } from "node:crypto";

const hmac = (key: Uint8Array, data: Uint8Array) => createHmac("sha256", key).update(data).digest();

/** What a browser does when a push arrives: RFC 8291 from the receiver's side. Tests only. */
export function decryptPush(message: Buffer, receiverPrivate: Buffer, auth: Buffer): string {
  const salt = message.subarray(0, 16);
  const idLength = message[20]!;
  const senderPublic = message.subarray(21, 21 + idLength);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(receiverPrivate);
  const receiverPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(senderPublic);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from("WebPush: info\0"), receiverPublic, senderPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const body = message.subarray(21 + idLength);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(body.subarray(body.length - 16));
  const padded = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  if (padded[padded.length - 1] !== 2) throw new Error("not a final aes128gcm record");
  return padded.subarray(0, padded.length - 1).toString("utf8");
}
