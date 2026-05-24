# KenReal Estates

Full-stack real estate shortlisting web app with:

- `RealEstateFrontend` (React + Bootstrap)
- `RealEstateBackend` (Node.js + Express)
- MySQL and phpMyAdmin via Docker

## Prerequisites

- Docker
- Docker Compose
- Node.js 18+ (for running frontend locally)

## Run Full Stack with Docker

From the project root:

```bash
docker compose up --build
```

This starts:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:5000`
- MySQL (host port): `localhost:3307`
- phpMyAdmin: `http://localhost:8080`

## Use phpMyAdmin in Browser

1. Open `http://localhost:8080`
2. Login with:
   - Server: `mysql`
   - Username: `realestate_user`
   - Password: `realestate_pass`
3. In the left sidebar, open database: `realestate`
4. Inspect tables:
   - `users` (created by backend startup)
5. Use tabs:
   - **Browse**: view rows
   - **Structure**: columns/indexes
   - **Insert**: add records
   - **SQL**: run queries (e.g. `SELECT * FROM users;`)

## Run Frontend Locally

In a second terminal:

```bash
cd RealEstateFrontend
npm install
npm run dev
```

Frontend dev URL is usually shown as `http://localhost:5173`.

## Social Signup + Email Verification Setup

To enable Google/Apple signup and email verification codes:

1. Copy backend env template:
   ```bash
   cp RealEstateBackend/.env.example RealEstateBackend/.env
   ```
2. Set OAuth credentials in `RealEstateBackend/.env`:
   - `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
   - `APPLE_OAUTH_CLIENT_ID`, `APPLE_OAUTH_TEAM_ID`, `APPLE_OAUTH_KEY_ID`, `APPLE_OAUTH_PRIVATE_KEY`
3. Set SMTP credentials:
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
4. Keep callback URLs aligned with your backend host:
   - `GOOGLE_OAUTH_CALLBACK_URL`
   - `APPLE_OAUTH_CALLBACK_URL`
5. Ensure frontend base URL is set:
   - `APP_FRONTEND_URL` (typically `http://localhost:5173`)

If OAuth/SMTP values are not set, social buttons or verification email delivery will not fully function.

Admin users can now choose the active outbound email provider from `/settings` -> `Email Delivery`.
For MVP, set provider to `resend` and configure `RESEND_API_KEY` + `RESEND_FROM`.

## Useful Docker Commands

Stop containers:

```bash
docker compose down
```

Stop and remove DB volume (deletes MySQL data):

```bash
docker compose down -v
```

## Troubleshooting

- **Port already in use**
  - If `3307`, `5000`, `8080`, or `5173` are busy, stop conflicting apps or change ports in `docker-compose.yml`.

- **Backend cannot connect to MySQL**
  - Make sure containers are up: `docker compose ps`
  - Check MySQL health/logs: `docker compose logs mysql`
  - Restart stack: `docker compose down && docker compose up --build`

- **phpMyAdmin login fails**
  - Use:
    - Server: `mysql`
    - Username: `realestate_user`
    - Password: `realestate_pass`
  - Confirm MySQL container is healthy before logging in.

- **Stale or broken database state**
  - Reset containers and DB volume:
    ```bash
    docker compose down -v
    docker compose up --build
    ```

- **Frontend cannot reach backend**
  - Confirm backend is running on `http://localhost:5000`
  - If frontend runs outside Docker, keep Vite proxy pointing to `localhost:5000`.
