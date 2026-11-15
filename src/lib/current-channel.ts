import { cookies } from "next/headers";
import type { Channel } from "@prisma/client";
import { listChannels } from "./channels";

export const CHANNEL_COOKIE = "kanal";

/** Panelde seçili kanal (çerezden), yoksa ilk kanal */
export async function currentChannel(): Promise<Channel> {
  const list = await listChannels();
  const id = (await cookies()).get(CHANNEL_COOKIE)?.value;
  return list.find((c) => c.id === id) ?? list[0];
}
