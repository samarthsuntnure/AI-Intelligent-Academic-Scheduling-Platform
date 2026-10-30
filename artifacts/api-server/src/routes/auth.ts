import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { AUTH_COOKIE_NAME, authCookieOptions, signSession } from "../lib/session";

const router: IRouter = Router();

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and password." });
    return;
  }
  const { email, password } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  if (!user) {
    res.status(401).json({ error: "No account found for that email." });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Incorrect password." });
    return;
  }

  const token = signSession({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    facultyId: user.facultyId,
    studentId: user.studentId,
  });

  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions);
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    facultyId: user.facultyId,
    studentId: user.studentId,
  });
});

router.post("/auth/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME);
  res.status(204).send();
});

router.get("/auth/me", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }
  res.json({
    id: req.user.userId,
    email: req.user.email,
    name: req.user.name,
    role: req.user.role,
    facultyId: req.user.facultyId,
    studentId: req.user.studentId,
  });
});

export default router;
