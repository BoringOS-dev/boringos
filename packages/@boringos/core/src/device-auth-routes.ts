import { Hono } from "hono";
import { randomBytes, randomUUID } from "node:crypto";
import { sql, eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { cliAuthChallenges } from "@boringos/db";

/**
 * Device auth routes — CLI login flow (like `gh auth login`).
 *
 * Flow:
 * 1. CLI calls POST /api/auth/device/code → gets deviceCode + userCode
 * 2. User opens verification URL in browser, approves
 * 3. CLI polls POST /api/auth/device/poll with deviceCode → gets session token
 */
export function createDeviceAuthRoutes(db: Db): Hono {
  const app = new Hono();

  // POST /code — generate device + user codes
  app.post("/code", async (c) => {
    const deviceCode = randomUUID();
    const userCode = randomBytes(4).toString("hex").toUpperCase(); // 8-char code like "A1B2C3D4"
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await db.execute(sql`
      INSERT INTO cli_auth_challenges (id, device_code, user_code, status, expires_at)
      VALUES (${randomUUID()}, ${deviceCode}, ${userCode}, 'pending', ${expiresAt.toISOString()})
    `);

    return c.json({
      deviceCode,
      userCode,
      verificationUrl: "/api/auth/device/verify",
      expiresAt: expiresAt.toISOString(),
      interval: 5,
    });
  });

  // POST /verify — browser approves the device (called by logged-in user)
  app.post("/verify", async (c) => {
    const body = await c.req.json() as { userCode: string; sessionToken: string; userId: string; tenantId: string };

    await db.update(cliAuthChallenges).set({
      status: "approved",
      sessionToken: body.sessionToken,
      userId: body.userId,
      tenantId: body.tenantId,
    }).where(and(eq(cliAuthChallenges.userCode, body.userCode), eq(cliAuthChallenges.status, "pending")));

    return c.json({ ok: true });
  });

  // POST /poll — CLI polls for approval
  app.post("/poll", async (c) => {
    const body = await c.req.json() as { deviceCode: string };

    const rows = await db.select().from(cliAuthChallenges)
      .where(eq(cliAuthChallenges.deviceCode, body.deviceCode))
      .limit(1);

    if (!rows[0]) return c.json({ error: "not_found" }, 404);

    if (new Date(rows[0].expiresAt) < new Date()) return c.json({ error: "expired" }, 410);

    if (rows[0].status === "pending") {
      return c.json({ status: "pending" }, 202);
    }

    if (rows[0].status === "approved" && rows[0].sessionToken) {
      return c.json({
        status: "approved",
        token: rows[0].sessionToken,
        userId: rows[0].userId,
        tenantId: rows[0].tenantId,
      });
    }

    return c.json({ status: rows[0].status }, 400);
  });

  return app;
}
