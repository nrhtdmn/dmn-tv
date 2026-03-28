@echo off
title Saat - Dakika - Saniye → Toplam Saniye

:basla
cls
echo ================================
echo        ZAMAN CEVIRICI
echo ================================
echo.

set /p saat=Saat girin:
set /p dakika=Dakika girin:
set /p saniye=Saniye girin:

set /a toplam_saniye=(%saat% * 3600) + (%dakika% * 60) + %saniye%

echo.
echo -------------------------------
echo Toplam Saniye: %toplam_saniye%
echo -------------------------------
echo.
echo ENTER'a basinca yeni hesaplama yapilir
echo Pencereyi X ile kapatabilirsiniz
pause >nul

goto basla