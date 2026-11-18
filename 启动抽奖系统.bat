@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 智学内部抽奖系统
echo.
echo   智学内部抽奖系统
echo   ----------------------------------------
echo   管理后台： http://127.0.0.1:5180
echo   学员自助： http://127.0.0.1:5180/redeem
echo   数据文件： data\db.json
echo   自动备份： data\backups\
echo.
echo   按 Ctrl+C 可停止服务（崩溃后会自动重启）
echo.
start "" http://127.0.0.1:5180

:loop
node server/index.js
echo.
echo   服务已退出，5 秒后自动重启；按 Ctrl+C 取消。
timeout /t 5 >nul
goto loop
