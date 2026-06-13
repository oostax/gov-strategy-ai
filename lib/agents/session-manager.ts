import { getStorage } from "@/lib/storage/local-json-storage";
import type { CreateSessionInput } from "@/lib/schemas/session";

export async function createStrategicSession(input: CreateSessionInput) {
  return getStorage().createSession(input);
}

export async function getStrategicSession(id: string) {
  return getStorage().getSession(id);
}
