import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installCrashHandlers } from "./dx/logger";
import { StoreProvider } from "./state/store";
import "./theme/theme.css";

installCrashHandlers();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </React.StrictMode>,
);
