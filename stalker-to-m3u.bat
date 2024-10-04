@echo off

setlocal enabledelayedexpansion

set GROUPS=groups.txt

@REM Select what to do (groups or m3u)
:whileDoWhat
echo What do you want to do ?
echo.
echo "1" (groups)
echo "2" (m3u)
set /P doWhat=
if /I "!doWhat!" == "1" (
	goto :whileChooseTarget
)
if /I "!doWhat!" == "2" (
	goto :whileChooseTarget
)
goto :whileDoWhat

:whileChooseTarget
echo What media ?
echo.
echo "1" (iptv)
echo "2" (vod)
set /P target=
if /I "!target!" == "1" || "!doWhat!" == "2" (
	goto :continue
)
goto :whileChooseTarget

:continue

if exist "!FOLDER!\!target!" (
	echo.
	echo ************************************
	echo Repertoire de travail : "!FOLDER!\!target!"
	echo ************************************
	cd "!FOLDER!\!target!"
) else (
	echo Le chemin "!FOLDER!\!target!" n'existe pas
	goto :whileChooseTarget
)

set profiles=prod,glassfish
set minifyStatic=true

@REM liste des profils de déploiement
echo.
echo.
echo ************************************
echo * Choix des applicatifs a deployer *
echo ************************************
echo.
echo.

:deployDB
set /p deployDB=Deployer [DB] (scripts SQL differentiels) ^("o" ou "n"^) ?
if /I "!deployDB!" == "o" (
	goto :deployApache
)
if /I "!deployDB!" == "n" (
	goto :deployApache
)
goto :deployDB

:deployApache
set /p deployApache=Deployer [Apache] (fichiers de configuration Apache) ^("o" ou "n"^) ?
if /I "!deployApache!" == "o" (
	goto :deployProperties
)
if /I "!deployApache!" == "n" (
	goto :deployProperties
)
goto :deployApache

:deployProperties
set /p deployProperties=Deployer [Properties] (fichiers de configuration du WAR) ^("o" ou "n"^) ?
if /I "!deployProperties!" == "o" (
	goto :deployWeb
)
if /I "!deployProperties!" == "n" (
	goto :deployWeb
)
goto :deployProperties

:deployWeb
set /p deployWeb=Deployer [Web] (deploiement du WAR) ^("o" ou "n"^) ?
if /I "!deployWeb!" == "o" (
	goto :deployStatic
)
if /I "!deployWeb!" == "n" (
	goto :deployStatic
)
goto :deployWeb

:deployStatic
set /p deployStatic=Deployer [Static] (deploiement des ressources web static dans Apache) ^("o" ou "n"^) ?
if /I "!deployStatic!" == "o" (
	:deployStaticMinify
	set /p deployStaticMinify=Minifyier les ressources web static ^("o" ou "n"^) ?
	if /I "!deployStaticMinify!" == "o" (
		set minifyStatic=true
		goto :deployVars
	)
	if /I "!deployStaticMinify!" == "n" (
		set minifyStatic=false
		goto :deployVars
	)
	goto :deployStaticMinify
)
if /I "!deployStatic!" == "n" (
	goto :deployVars
)
goto :deployStatic

:deployVars
@REM liste des variables d'environnement


@REM lancement du déploiement
:deploy
if /I "!deployDB!" == "o" (
	set profiles=!profiles!,deploy-db
)
if /I "!deployApache!" == "o" (
	set profiles=!profiles!,deploy-apache
)
if /I "!deployProperties!" == "o" (
	set profiles=!profiles!,deploy-properties
)
if /I "!deployWeb!" == "o" (
	set profiles=!profiles!,deploy-web
	if /I "!deployStatic!" == "n" (
		echo Il est obligatoire de deployer [Static] lorsque [Web] est aussi demande au deploiement.
		echo Ajout du profil [Static] au deploiement
		set profiles=!profiles!,deploy-static	
	)
)
if /I "!deployStatic!" == "o" (
	set profiles=!profiles!,deploy-static
	if /I "!deployWeb!" == "n" (
		echo Il est obligatoire de deployer [Web] lorsque [Static] est aussi demande au deploiement.
		echo Ajout du profil [Web] au deploiement
		set profiles=!profiles!,deploy-web
	)
)

echo.
echo ************************************
echo * Recapitulatif du deploiement     *
echo ************************************
echo * Profils       : !profiles!
echo * Minify-static : !minifyStatic!
echo ************************************
echo.
echo Appuyez sur une touche pour continuer...
set /p deploy=

mvn clean install -P!profiles! -Dminify=!minifyStatic!
set /p deploy=

@REM cd "C:\Sources\jee\trunk"
@REM svn update
@REM mvn clean install -Pprod,glassfish,deploy-apache,deploy-properties,deploy-web,deploy-static -Dminify=false