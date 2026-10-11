import { createRoot } from "react-dom/client";
import "./index.css";
import { AuthProvider } from "./auth/AuthContext.jsx";
import { AuthGate } from "./components/Auth/AuthGate.jsx";

createRoot(document.getElementById("root")).render(
  <AuthProvider>
    <AuthGate />
  </AuthProvider>
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Не удалось зарегистрировать Service Worker:', error);
    });
  });
}
