@echo off
REM 改修(常駐化対応): タスクスケジューラから呼び出す常駐起動用バッチ。
REM               「ログオン有無に関わらず実行」で起動するため、対話コンソールは持たない。
REM               手動起動は 起動.bat（本番用）または 開発起動.bat（開発用）を使用すること。
REM 改修(調査用): コンソールを持たないため、標準出力・標準エラー出力が消えて調査できない。
REM               daemon.log に追記し、Python子プロセスの例外等を後から確認できるようにする。
chcp 65001 >nul
cd /d "%~dp0backend"
echo. >> "%~dp0daemon.log"
echo ===== %date% %time% 起動 ===== >> "%~dp0daemon.log"
"C:\Program Files\nodejs\node.exe" server.js >> "%~dp0daemon.log" 2>&1
