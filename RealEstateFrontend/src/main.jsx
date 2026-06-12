import React from "react";
import ReactDOM from "react-dom/client";
// global.css must load BEFORE App so page-level stylesheets
// (home-revamp, browse-revamp, detail-revamp) can override it.
import "./styles/global.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
