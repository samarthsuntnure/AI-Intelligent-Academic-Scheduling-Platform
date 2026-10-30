import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch (error) {
    console.error("Health check database failure:", error);
    res.status(503).json({ status: "degraded", error: "Database is not reachable." });
  }
});

router.get("/readyz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ready", database: "ok", api: "ok" });
  } catch (error) {
    console.error("Readiness check database failure:", error);
    res.status(503).json({ status: "not_ready", database: "error", api: "ok", error: "Database is not reachable." });
  }
});

export default router;
