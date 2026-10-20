/**
 * Для разработки используем тот же публичный сигнальный сервер,
 * чтобы `npm start` работал без локального PeerServer.
 * Для своего сервера поменяйте host/port/path/secure (например, localhost:9000, '/', false).
 */
export const environment = {
  production: false,
  peerjs: {
    host: 'zik2009-my-peerjs-server.hf.space',
    port: 443,
    path: '/myapp',
    secure: true
  }
};
