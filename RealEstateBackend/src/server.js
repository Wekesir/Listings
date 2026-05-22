require("dotenv").config();
const app = require("./app");
const http = require("http");
const properties = require("./data/properties");
const { waitForDatabase, initializeDatabase, syncDemoListingOwners } = require("./config/db");
const { initRealtime } = require("./realtime/socket");

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await waitForDatabase();
    await initializeDatabase();
    await syncDemoListingOwners(properties);

    const server = http.createServer(app);
    initRealtime(server, app.sessionMiddleware);
    server.listen(PORT, () => {
      console.log(`Backend API running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start backend:", error.message);
    process.exit(1);
  }
}

startServer();
