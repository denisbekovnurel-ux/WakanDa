import { createRoot } from "react-dom/client";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { AuthProvider } from "./auth/AuthContext.jsx";
import { AuthGate } from "./components/Auth/AuthGate.jsx";
import { FeedbackProvider } from "./components/Feedback.jsx";
import { TodayProvider } from "./hooks/TodayProvider.jsx";

createRoot(document.getElementById("root")).render(
  // ErrorBoundary — снаружи всех провайдеров: падение любого из них должно
  // показывать экран восстановления, а не пустую страницу.
  <ErrorBoundary>
    <FeedbackProvider>
      <TodayProvider>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </TodayProvider>
    </FeedbackProvider>
  </ErrorBoundary>
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Не удалось зарегистрировать Service Worker:', error);
    });
  });
}
