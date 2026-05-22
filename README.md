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
