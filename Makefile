# Variables
IMAGE_NAME = chatmenow-backend
CONTAINER_NAME = chatmenow-be
PORT ?= $(shell grep '^PORT=' .env | cut -d '=' -f2)
COMPOSE ?= docker compose

.PHONY: build run dev dev-local stop restart logs logs-dev shell status clean rebuild quick compose-up compose-down compose-logs compose-ps

build: 
	docker build -t $(IMAGE_NAME):latest .

run:
	docker rm -f $(CONTAINER_NAME) 2>/dev/null || true
	docker run -d \
		--name $(CONTAINER_NAME) \
		-p $(PORT):$(PORT) \
		--env-file .env \
		--restart unless-stopped \
		$(IMAGE_NAME):latest

dev:
	$(COMPOSE) up -d --build

dev-local:
	docker rm -f $(CONTAINER_NAME)-dev 2>/dev/null || true
	docker run -d \
		--name $(CONTAINER_NAME)-dev \
		-p $(PORT):$(PORT) \
		-v $(PWD)/src:/app/src \
		--env-file .env \
		$(IMAGE_NAME):latest \
		npm run dev

stop:
	$(COMPOSE) down 2>/dev/null || true
	docker stop $(CONTAINER_NAME) 2>/dev/null || true
	docker stop $(CONTAINER_NAME)-dev 2>/dev/null || true

restart: stop run 

logs: 
	docker logs -f $(CONTAINER_NAME)

logs-dev: 
	$(COMPOSE) logs -f backend

shell: 
	docker exec -it $(CONTAINER_NAME) sh

status: 
	@$(COMPOSE) ps || true
	@docker ps -a | grep $(CONTAINER_NAME) || echo "No standalone container found"

compose-up:
	$(COMPOSE) up -d --build

compose-down:
	$(COMPOSE) down

compose-logs:
	$(COMPOSE) logs -f

compose-ps:
	$(COMPOSE) ps

clean:
	docker rm -f $(CONTAINER_NAME) 2>/dev/null || true
	docker rm -f $(CONTAINER_NAME)-dev 2>/dev/null || true
	docker rmi $(IMAGE_NAME):latest 2>/dev/null || true

rebuild: clean build run 

quick: 
	@make build
	@make run
