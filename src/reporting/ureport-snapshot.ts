import * as fs from "node:fs";
import * as path from "node:path";
import { serverBaseUrl } from "./ureport";
import { config } from "../config/env";

const OUT_PATH = path.join("reporting", "ureport-snapshot.json");

async function main(): Promise<void> {
  const baseUrl = serverBaseUrl();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.UREPORT_API_TOKEN}`,
  };
  try {
    const res = await fetch(`${baseUrl}/api/build/active-lanes?days=90`, { headers });
    if (!res.ok) {
      console.warn(`[ureport-snapshot] failed ${res.status}`);
      return;
    }
    const lanes = await res.json();
    const out = {
      fetchedAt: new Date().toISOString(),
      baseUrl,
      product: config.UREPORT_PRODUCT,
      type: config.UREPORT_TYPE,
      lanes,
    };
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
    console.log(`[ureport-snapshot] wrote ${lanes.length} lanes`);
  } catch (err) {
    console.warn(`[ureport-snapshot] skipped: ${(err as Error).message}`);
  }
}

main();
