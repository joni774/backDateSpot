/**
 * DateSpot API entry point.
 * Middleware order: helmet → cors → json → morgan → routes → 404 → errors.
 */

import "./config/load-env";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import authRoutes from "./routes/auth.routes";
import placesRoutes from "./routes/places.routes";
import adminRoutes from "./routes/admin.routes";

const app = express();

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

app.listen(env.PORT, () => {
  console.log(`DateSpot API listening on http://localhost:${env.PORT}`);
});

export default app;
