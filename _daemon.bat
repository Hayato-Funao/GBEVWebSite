@echo off
REM 改修(常駐化対応): タスクスケジューラから呼び出す常駐起動用バッチ。
REM               「ログオン有無に関わらず実行」で起動するため、対話コンソールは持たない。
REM               手動起動は 起動.bat（本番用）または 開発起動.bat（開発用）を使用すること。
chcp 65001 >nul
cd /d "%~dp0backend"
"C:\Program Files\nodejs\node.exe" server.js
