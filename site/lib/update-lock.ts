// A database lease survives a Worker restart and prevents overlapping callers.
export async function acquireLease(db: D1Database, id: string, now: number, duration: number, cooldown = 0) {
  const result = await db.prepare("INSERT INTO nav_refresh (id, started_at, lease_until) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, lease_until = excluded.lease_until WHERE nav_refresh.lease_until <= ? AND nav_refresh.started_at <= ?")
    .bind(id, now, now + duration, now, now - cooldown).run();
  return result.meta.changes > 0;
}
export async function releaseLease(db: D1Database, id: string, now: number) {
  await db.prepare("UPDATE nav_refresh SET lease_until = 0 WHERE id = ? AND started_at = ?").bind(id, now).run();
}
