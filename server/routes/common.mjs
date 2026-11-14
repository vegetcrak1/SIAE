import * as v from '../domain.mjs';

export function commonRoutes(router, { db }) {
  router.add('GET', '/api/notifications', {}, async (c) => {
    const items = await db.all(`SELECT n.id, n.title, n.body, n.level, n.created_at AS createdAt,
        EXISTS (SELECT 1 FROM notification_reads r WHERE r.notification_id = n.id AND r.user_id = ?) AS read
      FROM notifications n WHERE n.audience IN ('all', ?) ORDER BY n.id DESC LIMIT 50`, c.user.id, c.user.role);
    return { items: items.map((n) => ({ ...n, read: !!n.read })), unread: items.filter((n) => !n.read).length };
  });

  router.add('POST', '/api/notifications/read', {}, async (c) => {
    const body = await c.json();
    if (body.all === true) {
      await db.run("INSERT OR IGNORE INTO notification_reads (user_id, notification_id) SELECT ?, id FROM notifications WHERE audience IN ('all', ?)", c.user.id, c.user.role);
    } else {
      await db.run('INSERT OR IGNORE INTO notification_reads (user_id, notification_id) SELECT ?, id FROM notifications WHERE id = ?', c.user.id, v.id(body.id));
    }
    return { success: true };
  });
}
