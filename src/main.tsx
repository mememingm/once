import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import "../assets/ux/mock-data.js";
import "../styles.css";
import "../assets/ux/workspace.css";
import "../assets/ux/product-ui.css";
import "./react.css";
import "./font-faces.css";
import "./design-system.css";
import "./once.css";
import "./typography.css";
import { TooltipProvider } from "./components/ui/tooltip";
import { queryClient } from "./lib/api";
import { AppProvider } from "./app/AppProvider";
import { App, ErrorBoundary } from "./app/App";
const root = document.getElementById("app");
if (!root) throw new Error("ONCE root element missing");
root.removeAttribute("aria-busy");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <TooltipProvider delayDuration={350}>
            <AppProvider><App /></AppProvider>
          </TooltipProvider>
        </HashRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
