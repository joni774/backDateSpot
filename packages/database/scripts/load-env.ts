import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const ENV_FILES = [
  resolve(__dirname, "../../../.env"),
  resolve(__dirname, "../../../apps/api/.env"),
  resolve(__dirname, "../.env"),
];

export function loadEnvFiles(): void {
  for (const file of ENV_FILES) {
    if (!existsSync(file)) continue;

    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;

      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}
