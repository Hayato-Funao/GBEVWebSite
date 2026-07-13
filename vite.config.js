export default {
  root: 'frontend',
  // 改修(第16回): 将来ビルドする場合に備えたbuild設定（現状は未使用。npx vite build で frontend/../dist に生成）
  // 注意: frontendはtype="module"を使わないクラシックスクリプト構成のため、
  //       実際にビルドする際はindex.htmlのスクリプト読込方法の見直しが必要になる可能性がある。
  build: {
    outDir: '../dist',   // Webアプリ/dist/ に出力（root=frontend のため ../ で1つ上がる）
    emptyOutDir: true,
  },
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
