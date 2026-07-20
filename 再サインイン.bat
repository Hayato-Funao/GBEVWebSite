@echo off
if not defined HILS_RESIGNIN_RELAUNCHED (
	set HILS_RESIGNIN_RELAUNCHED=1
	cmd /k ""%~f0""
	exit /b
)
chcp 65001 >nul
REM 改修(即閉じ対策): 上記ガード(if not defined 〜 chcpまで)は日本語コメントを一切含まないASCIIのみの行にしてある。
REM               理由: 本ファイルの日本語REMコメント行は、cmd.exeが既定コードページ(cp932想定)でファイル
REM               バイト列を解釈するため誤って別コマンドとして分割されることがある（実機検証で再現・確認済み）。
REM               このコメント破損はchcp 65001の実行位置を前後させても解消しない（検証済み）。
REM               ただし実害は「対象行が不明なコマンドとしてエラー表示されるがスクリプト自体は継続する」に留まり、
REM               pauseまで到達すること自体は確認済み。将来別環境で悪化した場合の保険として、
REM               pause到達前に中断してもコンソールが即座に閉じないよう cmd /k 配下で自己再実行するガードを設けた。
REM               HILS_RESIGNIN_RELAUNCHED で再起動を1回のみに制限し無限再帰を防止する。
REM 改修(常駐化対応): SharePoint/Graph 接続用のMSALトークンを再取得するための対話実行バッチ。
REM               以下の場合に実行する。
REM                 ・実行アカウントのパスワード変更後、SharePoint接続が失敗するとき
REM                 ・権限引き継ぎで新担当者のアカウントに切り替えたとき
REM               実行するとコンソールにデバイスコード（URLとコード）が表示されるので、
REM               ブラウザで指示されたURLを開き、コードを入力してMicrosoftアカウントでサインインする。
REM               成功すると backend\token_cache.bin が更新され、以後は無人でトークンが更新される。
REM 改修(即閉じ対策): UNC配置でも backend へ確実に移動できるよう cd /d から pushd に変更
REM               （SP確認.batと同方式。cmdはUNCパスをカレントディレクトリにできないため）
pushd "%~dp0backend"
REM 改修(再サインイン): resigninコマンドで既存キャッシュを無視し強制的にデバイスコード認証を行う。
REM               従来はget_itemsのみ実行しており、有効なトークンが残っている場合は
REM               acquire_token_silentが先に通ってしまい、アカウント切替時の再認証が起きなかった。
python sp_helper.py resignin
echo.
echo 出力に "resignin": "success" が含まれていれば認証成功。続けて接続確認を行う。
echo 出力に "error" が含まれる場合は認証失敗（内容を確認すること）。
echo.
python sp_helper.py get_items
echo.
echo 出力に "items" が含まれていれば接続確認も成功（再サインイン完了）。
echo 出力に "error" が含まれる場合は失敗（内容を確認すること）。
popd
pause
