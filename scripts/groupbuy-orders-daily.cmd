@echo off
rem Daily group-buy order sync. See scripts/groupbuy-orders-daily.js for details.
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs
node scripts\groupbuy-orders-daily.js >> logs\groupbuy-orders.log 2>&1
endlocal
