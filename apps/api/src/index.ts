/**
 * DateSpot API entry point.
 * Middleware order: helmet → cors → json → morgan → routes → 404 → errors.
 */

import "./config/load-env";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import os from "os";
import { env } from "./config/env";
import authRoutes from "./routes/auth.routes";
import placesRoutes from "./routes/places.routes";
import adminRoutes from "./routes/admin.routes";

const app = express();

app.set("trust proxy", 1);
app.use(helmet());
const corsOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim());
app.use(
  cors({
    origin:
      corsOrigins.includes("*") || corsOrigins.includes("true")
        ? true
        : corsOrigins,
    credentials: true,
  })
);
app.use(express.json());
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "datespot-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/places", placesRoutes);
app.use("/api/admin", adminRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
);

app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`DateSpot API listening on http://localhost:${env.PORT}`);

  const lanIps = getLanIps();
  if (lanIps.length > 0) {
    console.log("Phone / Expo Go — use this API URL (same Wi-Fi):");
    for (const ip of lanIps) {
      console.log(`  http://${ip}:${env.PORT}`);
    }
  }
});

function getLanIps(): string[] {
  const ips: string[] = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const net of interfaces ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      if (net.address.startsWith("127.") || net.address.startsWith("169.254.")) continue;
      ips.push(net.address);
    }
  }
  return ips;
}

export default app;
