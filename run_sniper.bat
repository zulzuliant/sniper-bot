@echo off
color 0A
title Menjalankan Bot Lelang

echo.
echo ========================================================================
echo.
echo     ~====[]----------------------------------------
echo          /  /
echo         //    S N I P E R   B O T
echo.
echo ========================================================================
echo.

echo === Memeriksa versi Node.js ===
node -v
echo.

echo === Menjalankan npm test ===
call npm test
echo.

echo === Memulai Server UI dan Menunggu 5 Detik... ===
start /b cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:3210"
call npm run ui

pause