import { Router } from "express";
import ExcelJS from "exceljs";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { asyncHandler } from "../middleware/auth.js";
import type { Deps } from "../services/ports.js";
import { guards, parse, uuid } from "./common.js";

type Cell = string | number | boolean | null | undefined;

/** Neutralise spreadsheet formula injection: a cell starting with = + - @ (or tab/CR) is prefixed with '. */
export function safeCell(v: Cell): string | number | boolean {
  if (v === null || v === undefined) return "";
  if (typeof v !== "string") return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function toCsv(columns: { key: string; header: string }[], rows: Record<string, Cell>[]): string {
  const esc = (v: Cell) => {
    const s = String(safeCell(v));
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c.key])).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

async function toXlsx(sheet: string, columns: { key: string; header: string }[], rows: Record<string, Cell>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(14, c.header.length + 4) }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow(Object.fromEntries(columns.map((c) => [c.key, safeCell(r[c.key])])));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const REG_COLUMNS = [
  { key: "reg_number", header: "Registration #" },
  { key: "full_name", header: "Full name" },
  { key: "day_number", header: "Event day" },
  { key: "staff", header: "Registered by" },
  { key: "registered_at", header: "Registered at" },
  { key: "photo", header: "Photo" },
  { key: "winner", header: "Winner" },
  { key: "person_id", header: "Person id" },
];
const WIN_COLUMNS = [
  { key: "draw_scope", header: "Draw" },
  { key: "position", header: "Position" },
  { key: "full_name", header: "Winner" },
  { key: "reg_number", header: "Registration #" },
  { key: "drawn_at", header: "Drawn at" },
  { key: "eligible_entries", header: "Eligible entries" },
];

export function exportsRouter(env: Env, deps: Deps): Router {
  const router = Router();
  const g = guards(env, deps);

  async function send(res: import("express").Response, format: "csv" | "xlsx", name: string, sheet: string, cols: typeof REG_COLUMNS, rows: Record<string, Cell>[]) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.${format}"`);
    if (format === "csv") {
      res.type("text/csv; charset=utf-8").send(toCsv(cols, rows));
    } else {
      res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(await toXlsx(sheet, cols, rows));
    }
  }

  router.get(
    "/registrations.:format",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const format = parse(z.enum(["csv", "xlsx"]), req.params.format, "Unsupported format.");
      const day = req.query.event_day_id ? parse(uuid, req.query.event_day_id) : undefined;
      const rows = await deps.repo.exportRegistrations(day);
      await send(res, format, "guc-tcs-registrations", "Registrations", REG_COLUMNS, rows);
    }),
  );

  router.get(
    "/winners.:format",
    ...g.admin,
    asyncHandler(async (req, res) => {
      const format = parse(z.enum(["csv", "xlsx"]), req.params.format, "Unsupported format.");
      await send(res, format, "guc-tcs-winners", "Winners", WIN_COLUMNS, await deps.repo.exportWinners());
    }),
  );

  return router;
}
