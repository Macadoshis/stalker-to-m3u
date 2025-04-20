@echo off

setlocal enabledelayedexpansion

@REM Select what to output (groups or m3u)
:whileDoWhat
echo What do you want to generate ?
echo.
echo "1" (list categories)
echo "2" (generate m3u)
set /P doWhat=
if /I "!doWhat!" == "1" (
    set doWhat=groups
	goto :whileChooseTarget
)
if /I "!doWhat!" == "2" (
    set doWhat=m3u
	goto :whileChooseTarget
)
goto :whileDoWhat

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
npm run %doWhat% %media% -- %*
