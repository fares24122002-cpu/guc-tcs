import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import type { RpcClient } from "../src/services/repo.js";
import type { Profile, ProfileStore, Role } from "../src/services/ports.js";
import { HttpError } from "../src/middleware/errorHandler.js";
import { FakeAuth } from "./fakes.js";

const DB_DIR = join(import.meta.dirname, "..", "..", "database");

export const pgConfigured = Boolean(process.env.TEST_PG);

/** Creates a throwaway database with the Supabase stub and every migration applied. */
export async function createTestDb(name: string) {
  const admin = new pg.Client({ database: "postgres" });
  await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const pool = new pg.Pool({ database: name, max: 8 });
  await pool.query(readFileSync(join(DB_DIR, "test", "00_supabase_stub.sql"), "utf8"));
  for (const f of readdirSync(join(DB_DIR, "migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(join(DB_DIR, "migrations", f), "utf8"));
  }
  return {
    pool,
    async drop() {
      await pool.end();
      const a = new pg.Client({ database: "postgres" });
      await a.connect();
      await a.query(`drop database if exists ${name}`);
      await a.end();
    },
  };
}

/** Same call shape as PostgREST rpc(fn, {p}): `select fn(p::jsonb)`. */
export function pgRpc(pool: pg.Pool): RpcClient {
  return {
    async rpc(fn, args) {
      if (!/^api_[a-z_]+$/.test(fn)) throw new Error(`unexpected function ${fn}`);
      try {
        const res = await pool.query(`select public.${fn}($1::jsonb) as r`, [JSON.stringify(args.p ?? {})]);
        return { data: res.rows[0]?.r ?? null, error: null };
      } catch (e) {
        const err = e as { code?: string; message: string };
        return { data: null, error: { code: err.code, message: err.message } };
      }
    },
  };
}

export class PgProfileStore implements ProfileStore {
  constructor(private readonly pool: pg.Pool) {}
  async getById(id: string) {
    return ((await this.pool.query("select * from public.profiles where id = $1", [id])).rows[0] as Profile) ?? null;
  }
  async list() {
    return (await this.pool.query("select * from public.profiles order by created_at")).rows as Profile[];
  }
  async insert(p: { id: string; full_name: string; username: string; role: Role }) {
    try {
      return (
        await this.pool.query("insert into public.profiles (id, full_name, username, role) values ($1,$2,$3,$4) returning *", [
          p.id, p.full_name, p.username, p.role,
        ])
      ).rows[0] as Profile;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "That username is already taken.");
      throw e;
    }
  }
  async update(id: string, patch: { full_name?: string; is_active?: boolean }) {
    const r = await this.pool.query(
      "update public.profiles set full_name = coalesce($2, full_name), is_active = coalesce($3, is_active) where id = $1 returning *",
      [id, patch.full_name ?? null, patch.is_active ?? null],
    );
    if (!r.rows[0]) throw new HttpError(404, "Account not found.");
    return r.rows[0] as Profile;
  }
  async log(userId: string | null, action: string, details: Record<string, unknown>) {
    await this.pool.query("insert into public.activity_logs (user_id, action, details) values ($1,$2,$3)", [userId, action, JSON.stringify(details)]);
  }
}

/** FakeAuth that also writes auth.users so profile foreign keys hold. */
export class PgAuth extends FakeAuth {
  constructor(private readonly pool: pg.Pool) {
    super();
  }
  override async createUser(email: string, password: string) {
    const id = await super.createUser(email, password);
    await this.pool.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    return id;
  }
}

/** Smallest byte sequences the magic-number check accepts. */
export const JPEG = (extra = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(extra, 1)]);
