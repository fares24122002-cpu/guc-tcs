import type { Profile } from "../services/ports.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth: the verified, active profile. */
      user?: Profile;
      accessToken?: string;
    }
  }
}

export {};
