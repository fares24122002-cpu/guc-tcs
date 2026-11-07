import { HttpError } from "../middleware/errorHandler.js";
import { staffEmail, type Deps, type Profile } from "./ports.js";

export interface BootstrapOptions {
  username: string;
  fullName: string;
  password: string;
  emailDomain: string;
}

/**
 * Creates an administrator. Only reachable from the command line (never over HTTP).
 * Rolls back the login if the profile cannot be saved.
 */
export async function bootstrapAdmin(deps: Deps, opts: BootstrapOptions): Promise<Profile> {
  const username = opts.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new HttpError(400, "Username must be 3-32 characters: letters, numbers, dot, dash or underscore.");
  }
  if (opts.fullName.trim().length < 2) throw new HttpError(400, "Provide the administrator's full name.");
  if (opts.password.length < 12) throw new HttpError(400, "Administrator password must be at least 12 characters.");

  const id = await deps.auth.createUser(staffEmail(username, opts.emailDomain), opts.password);
  try {
    const profile = await deps.store.insert({ id, full_name: opts.fullName.trim(), username, role: "admin" });
    await deps.store.log(profile.id, "admin.bootstrap", { username });
    return profile;
  } catch (err) {
    await deps.auth.deleteUser(id).catch(() => undefined);
    throw err;
  }
}
