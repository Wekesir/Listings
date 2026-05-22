import { io } from "socket.io-client";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

let socketInstance = null;

function resolveSocketEndpoint() {
  if (!API_BASE_URL) {
    return undefined;
  }
  return API_BASE_URL;
}

export function getRealtimeSocket() {
  if (socketInstance) {
    return socketInstance;
  }
  socketInstance = io(resolveSocketEndpoint(), {
    withCredentials: true,
    transports: ["websocket", "polling"]
  });
  return socketInstance;
}

export function disconnectRealtimeSocket() {
  if (!socketInstance) return;
  socketInstance.disconnect();
  socketInstance = null;
}
