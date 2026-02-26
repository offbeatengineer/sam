import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initializeStoreSubscriptions } from "@/stores/storeSubscriptions";

// Initialize cross-store subscriptions before rendering
initializeStoreSubscriptions();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
