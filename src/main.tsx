import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGate } from "./components/Auth/AuthGate";
import { FeedbackProvider } from "./components/Feedback";
import { TodayProvider } from "./hooks/TodayProvider";
import { migrateLegacyHash } from "./router/legacyHash";
import { installGlobalErrorReporting, reportClientError } from "./utils/reportClientError";

// Старые ссылки вида `/#daily` до старта роутера переводим в `/daily`,
// чтобы закладки и уведомления, отправленные до перехода, не открывали главную.
const legacyTarget = migrateLegacyHash(window.location);
if (legacyTarget) window.history.replaceState(null, "", legacyTarget);

installGlobalErrorReporting();

createRoot(document.getElementById("root")!).render(
  // ErrorBoundary — снаружи всех провайдеров: падение любого из них должно
  // показывать экран восстановления, а не пустую страницу.
  <ErrorBoundary>
    <FeedbackProvider>
      <TodayProvider>
        <BrowserRouter>
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
        </BrowserRouter>
      </TodayProvider>
    </FeedbackProvider>
  </ErrorBoundary>
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Не удалось зарегистрировать Service Worker:', error);
      reportClientError(error, { source: 'window' });
    });
  });
}
