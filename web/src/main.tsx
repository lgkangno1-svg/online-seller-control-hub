import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./beta.css";
import "./manager.css";
import "./connections.css";
import "./registration.css";
import "./sellerUpload.css";
import "./activity.css";
import "./billing.css";
import "./admin.css";
import "./setup-guide.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
