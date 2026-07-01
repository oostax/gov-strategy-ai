import { randomBytes, randomUUID } from "crypto";

export function createId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function createToken(length = 32) {
  return randomBytes(length).toString("hex");
}
