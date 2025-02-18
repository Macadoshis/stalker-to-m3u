@echo off
REM install node_modules dependencies for NodeJS
@echo on
echo "Downloading NodeJS dependencies..."
call npm install
@echo on
echo "Downloading ffmpeg..."
@echo off
REM download ffmpeg for stream tester (if option enabled)
setlocal enabledelayedexpansion

:: Define FFmpeg URL and output filenames
set "FFMPEG_URL=https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
set "ZIP_FILE=ffmpeg.zip"
set "OUT_DIR=%CD%"

:: Check if PowerShell is available
where powershell >nul 2>&1
if %errorlevel% == 0 (
    echo PowerShell found. Using PowerShell to download FFmpeg...
    call powershell -Command "& {Invoke-WebRequest -Uri '%FFMPEG_URL%' -OutFile '%ZIP_FILE%'}"
) else (
    echo PowerShell not found. Trying bitsadmin...
    call bitsadmin /transfer "DownloadFFmpeg" "%FFMPEG_URL%" "%CD%\%ZIP_FILE%"
    if %errorlevel% neq 0 (
        echo bitsadmin failed. Trying curl...
        curl -L -o "%ZIP_FILE%" "%FFMPEG_URL%"
        if %errorlevel% neq 0 (
            echo Failed to download FFmpeg. Please download manually.
            exit /b 1
        )
    )
)

:: Extract ZIP
echo Extracting FFmpeg...
call  powershell -Command "& {Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%OUT_DIR%' -Force}" 2>nul
if %errorlevel% neq 0 (
    echo PowerShell extraction failed. Trying unzip method...
    tar -xf "%ZIP_FILE%" 2>nul
)

:: Move extracted files
for /d %%D in ("%OUT_DIR%\ffmpeg-*") do set "FFMPEG_PATH=%%D"
if not defined FFMPEG_PATH (
    echo Extraction failed or incorrect path.
    exit /b 1
)

mkdir %OUT_DIR% 2>nul

move "%FFMPEG_PATH%\bin\ffmpeg.exe" "%OUT_DIR%\ffmpeg.exe"
move "%FFMPEG_PATH%\bin\ffprobe.exe" "%OUT_DIR%\ffprobe.exe"

:: Cleanup
echo Cleaning up...
del "%ZIP_FILE%"
rmdir /s /q "%FFMPEG_PATH%"

echo FFmpeg successfully installed in %OUT_DIR%
exit /b 0
