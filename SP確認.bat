@echo off
pushd "%~dp0backend"
python sp_helper.py get_items
echo.
pause
popd
