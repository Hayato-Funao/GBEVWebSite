@echo off
chcp 65001 >nul
REM 改修(第16回): 本番配備用の起動.bat作成に伴い、旧起動.bat（開発用2プロセス起動）をこちらへ改名保存
REM 改修 第17回  文字コードをUTF8とCRLFに変更し chcp 65001 を追加  文字化け対策
echo Starting API server...
REM 改修(不具合修正): 手動起動時のみメール宛先/CC設定のコンソール入力を有効化する
REM               （タスクスケジューラ経由の_daemon.batでは本変数を設定しないため常にスキップされる）
set HILS_MAIL_PROMPT=1
start "HILS API Server" /D "%~dp0backend" node server.js
echo Starting Vite...
pushd "%~dp0"
npx vite > vite.log 2>&1
echo.
echo Vite stopped. See vite.log for details.
pause
popd
