// server/middleware/sessionStore.js
// express-session store backed by Supabase (table: admin_sessions).
// The default MemoryStore forgets every login on each Render restart/spin-down
// and leaks memory in production, so we persist sessions instead.

const session = require('express-session');
const supabase = require('../db/supabase');

class SupabaseSessionStore extends session.Store {
  constructor() {
    super();
    // Sweep expired sessions hourly (unref so it never blocks shutdown).
    setInterval(() => this.sweep(), 60 * 60 * 1000).unref();
  }

  get(sid, cb) {
    supabase
      .from('admin_sessions')
      .select('sess, expire')
      .eq('sid', sid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return cb(error);
        if (!data || new Date(data.expire) <= new Date()) return cb(null, null);
        cb(null, data.sess);
      })
      .catch(cb);
  }

  set(sid, sess, cb = () => {}) {
    const expire = sess.cookie?.expires
      ? new Date(sess.cookie.expires)
      : new Date(Date.now() + 8 * 60 * 60 * 1000);
    supabase
      .from('admin_sessions')
      .upsert({ sid, sess, expire: expire.toISOString() }, { onConflict: 'sid' })
      .then(({ error }) => cb(error || null))
      .catch(cb);
  }

  touch(sid, sess, cb = () => {}) {
    this.set(sid, sess, cb);
  }

  destroy(sid, cb = () => {}) {
    supabase
      .from('admin_sessions')
      .delete()
      .eq('sid', sid)
      .then(({ error }) => cb(error || null))
      .catch(cb);
  }

  sweep() {
    supabase
      .from('admin_sessions')
      .delete()
      .lt('expire', new Date().toISOString())
      .then(() => {}, () => {});
  }
}

module.exports = SupabaseSessionStore;
