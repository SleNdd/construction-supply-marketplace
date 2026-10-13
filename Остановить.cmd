@echo off
chcp 65001 >nul
docker compose --project-name stroypotok --project-directory "%~dp0." --env-file "%~dp0.env" -f "%~dp0docker-compose.yml" stop
if errorlevel 1 pause
