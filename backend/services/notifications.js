"use strict";

// ---------------------------------------------------------------------------
// createNotification – insert a notification row
//   userId: Supabase auth UUID string, or null for tenant-wide broadcast
// ---------------------------------------------------------------------------
async function createNotification(supabase, { tenantId, userId = null, type, title, body = null, link = null, metadata = null }) {
  const { error } = await supabase.from("NOTIFICATION").insert([{
    TENANT_ID: tenantId,
    USER_ID:   userId,
    TYPE:      type,
    TITLE:     title,
    BODY:      body,
    LINK:      link,
    METADATA:  metadata,
  }]);
  if (error) throw { status: 500, message: error.message };
}

// ---------------------------------------------------------------------------
// listNotifications – unread + recently read, user-specific + tenant-wide
// ---------------------------------------------------------------------------
async function listNotifications(supabase, { tenantId, userId, limit = 50 }) {
  // Fetch notifications that belong to this user specifically OR are tenant-wide (USER_ID is null)
  const { data, error } = await supabase
    .from("NOTIFICATION")
    .select("ID, TYPE, TITLE, BODY, LINK, METADATA, READ_AT, CREATED_AT")
    .eq("TENANT_ID", tenantId)
    .or(`USER_ID.eq.${userId},USER_ID.is.null`)
    .order("CREATED_AT", { ascending: false })
    .limit(limit);

  if (error) throw { status: 500, message: error.message };
  return data || [];
}

// ---------------------------------------------------------------------------
// unreadCount – count of unread notifications for the user
// ---------------------------------------------------------------------------
async function unreadCount(supabase, { tenantId, userId }) {
  const { count, error } = await supabase
    .from("NOTIFICATION")
    .select("ID", { count: "exact", head: true })
    .eq("TENANT_ID", tenantId)
    .or(`USER_ID.eq.${userId},USER_ID.is.null`)
    .is("READ_AT", null);

  if (error) throw { status: 500, message: error.message };
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// markRead – mark a single notification as read (must belong to user/tenant)
// ---------------------------------------------------------------------------
async function markRead(supabase, { id, tenantId, userId }) {
  const { data: row, error: fetchErr } = await supabase
    .from("NOTIFICATION")
    .select("ID, USER_ID")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();

  if (fetchErr || !row) throw { status: 404, message: "Benachrichtigung nicht gefunden" };
  // Allow if user-specific match or tenant-wide
  if (row.USER_ID !== null && row.USER_ID !== userId) {
    throw { status: 403, message: "Kein Zugriff" };
  }

  const { error } = await supabase
    .from("NOTIFICATION")
    .update({ READ_AT: new Date().toISOString() })
    .eq("ID", id)
    .is("READ_AT", null);

  if (error) throw { status: 500, message: error.message };
}

// ---------------------------------------------------------------------------
// markAllRead – mark all unread notifications for the user as read
// ---------------------------------------------------------------------------
async function markAllRead(supabase, { tenantId, userId }) {
  const { error } = await supabase
    .from("NOTIFICATION")
    .update({ READ_AT: new Date().toISOString() })
    .eq("TENANT_ID", tenantId)
    .or(`USER_ID.eq.${userId},USER_ID.is.null`)
    .is("READ_AT", null);

  if (error) throw { status: 500, message: error.message };
}

module.exports = {
  createNotification,
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
};
