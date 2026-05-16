/**
 * middleware.js — Authentication middleware for protected routes.
 */

/**
 * Require authenticated session for HTTP routes.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

/**
 * Require authenticated session for Socket.IO connections.
 * Applied as Socket.IO middleware.
 */
function requireSocketAuth(socket, next) {
  const session = socket.request.session;
  if (session && session.user) {
    socket.user = session.user;
    return next();
  }
  next(new Error('Authentication required'));
}

module.exports = { requireAuth, requireSocketAuth };
