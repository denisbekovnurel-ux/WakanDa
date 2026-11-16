import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGate } from "./components/Auth/AuthGate";
import { FeedbackProvider } from "./components/Feedback";
import { PwaInstallProvider } from "./pwa/PwaInstallProvider";
import { TodayProvider } from "./hooks/TodayProvider";
import { migrateLegacyHash } from "./router/legacyHash";
import { installGlobalErrorReporting, reportClientError } from "./utils/reportClientError";
import { installViewportTracking } from "./utils/viewport";

// Старые ссылки вида `/#daily` до старта роутера переводим в `/daily`,
// чтобы закладки и уведомления, отправленные до перехода, не открывали главную.
const legacyTarget = migrateLegacyHash(window.location);
if (legacyTarget) window.history.replaceState(null, "", legacyTarget);

installGlobalErrorReporting();
// iOS Safari: держим --vvh и класс keyboard-open в актуальном состоянии.
installViewportTracking();

createRoot(document.getElementById("root")!).render(
  // ErrorBoundary — снаружи всех провайдеров: падение любого из них должно
  // показывать экран восстановления, а не пустую страницу.
  <ErrorBoundary>
    <FeedbackProvider>
      <PwaInstallProvider>
        <TodayProvider>
          <BrowserRouter>
            <AuthProvider>
              <AuthGate />
            </AuthProvider>
          </BrowserRouter>
        </TodayProvider>
      </PwaInstallProvider>
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
