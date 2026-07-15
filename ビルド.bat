@echo off
chcp 65001 >nul
REM 改修(第16回): 本番配備前のフロントエンドビルドバッチ（将来用・現状未使用）
REM               実行後 Webアプリ/dist/ にビルド済みファイルが生成される
REM               注意: frontendは現状クラシックスクリプト構成のため、実行前にindex.htmlの
REM                     module化等の対応が必要になる可能性がある
REM 改修 第17回 文字コードをUTF-8に変更し chcp 65001 を追加
REM        改行もCRLFに統一 LFのみだと文字化けの原因になるため
REM 改修(dist破壊事故対応): このバッチは現状のクラシックスクリプト構成のfrontendに対して
REM               実行するとdist/内のapp.js・html2canvas.min.js・style.cssが消失する。
REM               詳細はCLAUDE.md参照。frontendのmodule化対応が完了するまで実行を禁止する。
echo ★このビルド手順は現在使用禁止です★
echo npx vite build を実行すると dist/ 内の app.js・html2canvas.min.js・style.css が消失します。
echo デプロイする場合は frontend/ の該当ファイルを dist/ へそのまま手動コピーしてください。
echo 詳細はこのフォルダのCLAUDE.mdを参照してください。
pause
exit /b 1

echo フロントエンドをビルドしています...
pushd "%~dp0"
npx vite build
if %errorlevel% neq 0 (
  echo ビルド失敗。エラーを確認してください。
  pause
  popd
  exit /b 1
)
echo ビルド完了。dist/ に出力しました。
echo 起動.bat を実行して本番サーバーを起動してください。
pause
popd
