import { createRoot } from "react-dom/client";
import App from "../ui/App";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Unframed side panel root was not found.");
}

createRoot(root).render(<App />);
