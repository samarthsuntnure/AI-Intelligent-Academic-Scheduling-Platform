import type { NextFunction, Request, Response } from "express";
import { AUTH_COOKIE_NAME, verifySession, type Role, type SessionPayload } from "./session";

declare global {
  namespace Express {
    interface Request {
      user?: SessionPayload;
    }
  }
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (token) {
    const session = verifySession(token);
    if (session) req.user = session;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Not signed in." });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "You don't have access to this." });
      return;
    }
    next();
  };
}
