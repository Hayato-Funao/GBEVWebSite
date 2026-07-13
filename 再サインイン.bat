@echo off
REM 改修(常駐化対応): SharePoint/Graph 接続用のMSALトークンを再取得するための対話実行バッチ。
REM               以下の場合に実行する。
REM                 ・実行アカウントのパスワード変更後、SharePoint接続が失敗するとき
REM                 ・権限引き継ぎで新担当者のアカウントに切り替えたとき
REM               実行するとコンソールにデバイスコード（URLとコード）が表示されるので、
REM               ブラウザで指示されたURLを開き、コードを入力してMicrosoftアカウントでサインインする。
REM               成功すると backend\token_cache.bin が更新され、以後は無人でトークンが更新される。
chcp 65001 >nul
cd /d "%~dp0backend"
python sp_helper.py get_items
echo.
echo 出力に "items" が含まれていれば再サインイン成功。
echo 出力に "error" が含まれる場合は失敗（内容を確認すること）。
pause
