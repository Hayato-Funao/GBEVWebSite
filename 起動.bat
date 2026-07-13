@echo off
chcp 65001 >nul
REM 改修(第16回): 本番配備用起動バッチ。Node.js単一プロセスでフロント(frontend/)＋APIを一括配信
REM               開発時は 開発起動.bat（旧 起動.bat）を使用すること
REM 改修(第17回): 本ファイルをUTF-8(BOM無し)保存に変更し、chcp 65001を追加
REM               あわせて改行をCRLFに統一(LFのみだと文字化けの原因になるため)
echo 統合HILS予約サイト 起動中...
pushd "%~dp0backend"
node server.js
echo.
echo サーバーが停止しました。
pause
popd
