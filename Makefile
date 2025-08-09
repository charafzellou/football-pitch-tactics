SHELL := /bin/bash
include .env

help:
	@echo "FOOTBALL PITCH TACTICS - Available commands:"
	@echo "  -------------------------------------------"
	@echo "  setup:                       Setup the project"
	@echo "  -------------------------------------------"
	@echo "  frontend-run:                Run the frontend"
	@echo "  frontend-build:              Build the frontend"
	@echo "  frontend-docker-build:       Build the frontend docker image"
	@echo "  -------------------------------------------"
	@echo "  docker-containers-kill:      Kill all running containers"
	@echo "  docker-containers-remove:    Remove all containers"
	@echo "  -------------------------------------------"
	@echo "  docker-images-rebuild:       Rebuild all images"
	@echo "  docker-images-remove:        Remove all images"
	@echo "  -------------------------------------------"
	@echo "  docker-compose-start:        Start docker-compose"
	@echo "  docker-compose-stop:         Stop docker-compose"

##########################################

setup:
	@echo "Setting up the project..."
	@curl -fsSL https://bun.sh/install | bash
	@bun install --cwd frontend/
	@rm -f frontend/db.sqlite
	@bun run --cwd frontend/ db:setup

##########################################

frontend-run:
	@echo "Running frontend..."
	@rm -rf frontend/.data frontend/.nuxt frontend/.output && bun run --cwd frontend/ dev

frontend-build:
	@echo "Building binary frontend..."
	@bun run --cwd frontend/ build

frontend-docker-build:
	@echo "Building frontend docker image..."
	@docker build -t football-pitch-tactics-frontend -f Dockerfile .

##########################################

docker-containers-kill:
	@echo "Killing all containers..."
	@docker kill $(docker ps -aq)

docker-containers-remove:
	@echo "Removing all containers..."
	@docker rm $(docker ps -aq)

##########################################

docker-images-rebuild:
	@echo "Rebuilding all images..."
	@docker rmi -f football-pitch-tactics-frontend
	@docker build -t football-pitch-tactics-frontend -f Dockerfile .

docker-images-remove:
	@echo "Removing all images..."
	@docker rmi -f football-pitch-tactics-frontend

##########################################

docker-compose-local:
	@echo "Running docker-compose..."
	@clear && docker-compose down && docker-compose -f docker-compose.local.yaml up --build --force-recreate

docker-compose-start:
	@echo "Running docker-compose..."
	@docker-compose up --build --force-recreate

docker-compose-stop:
	@echo "Stopping docker-compose..."
	@docker-compose down
	@docker-compose rm -f -v

###########################################

certbot-apply:
	@sudo certbot certonly --agree-tos --email team@blockchain-xpertise.com -d 'football-pitch-tactics.com'

certbot-renew:
	@echo "Renewing certbot certificates..."
	@docker-compose down
	@rm -rf ./nginx/ssl/**/*.pem
	@certbot renew
	@cp /etc/letsencrypt/live/football-pitch-tactics.com/*.pem ./nginx/ssl/football-pitch-tactics.com/
	@chmod 644 ./nginx/ssl/football-pitch-tactics.com/*.pem
	@docker-compose up -d
	@docker-compose logs nginx