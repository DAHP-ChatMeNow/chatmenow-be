# ChatMeNow Backend

RESTful API & real-time chat server for the ChatMeNow application.

## Tech Stack

- **Runtime:** Node.js 20 + Express
- **Database:** MongoDB (Mongoose)
- **Real-time:** Socket.IO
- **Storage:** AWS S3
- **Auth:** JWT + bcryptjs
- **Container:** Docker

## Getting Started

### Prerequisites

- Node.js 20+
- MongoDB
- AWS S3 bucket

### Install & Run

```bash
# Install dependencies
npm install

# Development (with hot-reload)
npm run dev

# Production
npm start
```

### Environment Variables

Create a `.env` file in the root:

```env
PORT=5000
MONGO_URI=your_mongodb_uri
JWT_SECRET=your_jwt_secret
API_KEY=your_api_key
ALLOWED_ORIGINS=http://localhost:3000

AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
S3_BUCKET_NAME=your_bucket
AWS_REGION=ap-southeast-1

LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
NEXT_PUBLIC_ENABLE_CALL=false
```

### Run project

```bash
make build      # Build Docker image
make run        # Run container (production)
make dev        # Run container (development, hot-reload)
make stop       # Stop container
make restart    # Restart container
make logs       # Tail container logs
make status     # Check container status
make clean      # Remove container & image
```

### LiveKit (SFU) Production Deployment

```bash
# Start backend + LiveKit
docker compose up -d --build

# Logs
docker compose logs -f backend
docker compose logs -f livekit
```

Reference files:
- `docker-compose.yml`
- `livekit.yaml`
- `nginx/livekit.conf`
- `docs/livekit-migration.md`

## CI/CD

GitHub Actions pipeline (`.github/workflows/ci-cd.yml`):

1. **CI** — Install, lint, test
2. **Docker** — Build & push image to GHCR
3. **Deploy** — SSH into server and run new container

### Required GitHub Secrets

| Secret            | Description                     |
| ----------------- | ------------------------------- |
| `SSH_HOST`        | Server IP                       |
| `SSH_USER`        | SSH username                    |
| `SSH_PRIVATE_KEY` | Private key content             |
| `SSH_PORT`        | SSH port (default: 22)          |
| `GHCR_TOKEN`      | GitHub PAT with `read:packages` |

## API Routes

| Prefix               | Description              |
| -------------------- | ------------------------ |
| `/api/auth`          | Register, login          |
| `/api/users`         | User profile             |
| `/api/posts`         | Posts & comments         |
| `/api/chat`          | Conversations & messages |
| `/api/notifications` | Notifications            |
| `/api/upload`        | File upload              |
| `/api/livekit-token` | Generate LiveKit token   |
