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
import { prisma } from "@datespot/database";
import { env } from "./config/env";
import authRoutes from "./routes/auth.routes";
import placesRoutes from "./routes/places.routes";
import adminRoutes from "./routes/admin.routes";
import aiRoutes from "./routes/ai.routes";
import nearbyRoutes from "./routes/nearby.routes";

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

app.get("/health", async (_req, res) => {
  let placesQueryOk = false;
  try {
    await prisma.$queryRawUnsafe<Array<{ c: number }>>(
      `SELECT COUNT(*)::int AS c FROM "Place" WHERE "isActive" = true`
    );
    placesQueryOk = true;
  } catch (err) {
    console.warn("[health] places raw count failed:", err);
  }

  res.json({
    status: "ok",
    service: "datespot-api",
    build:
      process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ??
      process.env.GIT_COMMIT?.slice(0, 7) ??
      "dev",
    placesQueryOk,
    cloudinaryConfigured: Boolean(
      process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
        process.env.CLOUDINARY_API_KEY?.trim() &&
        process.env.CLOUDINARY_API_SECRET?.trim()
    ),
    googlePlacesKeyConfigured: Boolean(
      process.env.GOOGLE_PLACES_API_KEY?.trim() ||
        process.env.GOOGLE_MAPS_API_KEY?.trim()
    ),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/places", placesRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/nearby", nearbyRoutes);
app.use("/api/ai", aiRoutes);

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
