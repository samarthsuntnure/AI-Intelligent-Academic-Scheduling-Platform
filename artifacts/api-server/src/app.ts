import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", router);

// Convert validation/database failures into consistent JSON responses so the
// web forms can show a useful message instead of receiving Express HTML.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;

  const maybe = err as { name?: string; issues?: Array<{ message?: string; path?: unknown[] }>; code?: string; sqlMessage?: string; message?: string };

  if (maybe.name === "ZodError" && Array.isArray(maybe.issues)) {
    const message = maybe.issues
      .map((issue) => {
        const path = Array.isArray(issue.path) && issue.path.length ? `${issue.path.join(".")}: ` : "";
        return `${path}${issue.message || "Invalid value."}`;
      })
      .join(" ");
    res.status(400).json({ error: message || "Invalid request data." });
    return;
  }

  // MySQL duplicate-key errors (ER_DUP_ENTRY / 1062).
  if (maybe.code === "ER_DUP_ENTRY" || maybe.code === "1062") {
    res.status(409).json({ error: "A record with the same unique value already exists." });
    return;
  }

  console.error("API request failed:", err);
  res.status(500).json({ error: "The server could not complete that request." });
});

export default app;
