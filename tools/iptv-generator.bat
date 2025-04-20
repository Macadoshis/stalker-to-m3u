@echo off

setlocal enabledelayedexpansion

@REM Select for which media (iptv or vod or series)

:whileChooseTarget
echo What media ?
echo.
echo "1" (IPTV)
echo "2" (VOD)
echo "3" (SERIES)
set /P media=
if /I "!media!" == "1" (
    set media=iptv
	goto :continue
)
if /I "!media!" == "2" (
    set media=vod
	goto :continue
)
if /I "!media!" == "3" (
    set media=series
	goto :continue
)
goto :whileChooseTarget

:continue

echo "Running script..."

@REM run script
npm run iptv-generator %media% -- %*
