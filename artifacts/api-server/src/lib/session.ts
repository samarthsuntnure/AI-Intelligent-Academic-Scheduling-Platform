import jwt from "jsonwebtoken";

// Falls back to a fixed dev secret so the app runs out of the box. Set a
// real JWT_SECRET in your .env before this is used with data anyone cares
// about protecting.
const JWT_SECRET = process.env.JWT_SECRET || "vidyaan-dev-secret-change-me";
const COOKIE_NAME = "vidyaan_token";
const TOKEN_TTL = "12h";

export type Role = "admin" | "faculty" | "student";

export type SessionPayload = {
  userId: number;
  email: string;
  name: string;
  role: Role;
  facultyId: number | null;
  studentId: number | null;
};

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;

export const authCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  // Only require HTTPS for the cookie in production — local dev is http.
  secure: process.env.NODE_ENV === "production",
  maxAge: 12 * 60 * 60 * 1000,
};
