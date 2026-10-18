const app = require('./app');

function startServer() {
  const value = process.env.PORT ?? '5173';
  if (!/^\d+$/.test(value) || !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 65535) {
    throw new TypeError('Invalid PORT');
  }
  const server = app.listen(Number(value), '0.0.0.0', () => {
    console.log(JSON.stringify({ event: 'listening', port: Number(value) }));
  });
  let stopping = false;
  function shutdown() {
    if (stopping) return;
    stopping = true;
    const timer = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 10000);
    timer.unref();
    server.close(error => {
      clearTimeout(timer);
      process.exit(error ? 1 : 0);
    });
    server.closeIdleConnections();
  }
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

if (require.main === module) startServer();
module.exports = { startServer };
