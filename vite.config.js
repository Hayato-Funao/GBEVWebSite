export default {
  root: 'frontend',
  server: {
    host: true,
    port: 5173,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
}
