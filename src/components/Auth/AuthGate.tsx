import { useAuth } from '../../auth/AuthContext';
import { AppStoreProvider } from '../../store/AppStore';
import App from '../../App';
import { AuthScreen } from './AuthScreen';
import { PendingScreen } from './PendingScreen';
import { AuthBrand } from './Brand';
import { LanguageSwitcher } from '../LanguageSwitcher';

function SplashScreen() {
  return (
    <div className="auth-shell">
      <LanguageSwitcher className="lang-switch--auth" />
      <div className="auth-card auth-card--splash">
        <AuthBrand />
        <div className="pending-pulse" aria-hidden="true">
          <span className="pending-pulse-ring" />
          <span className="pending-pulse-dot" />
        </div>
      </div>
    </div>
  );
}

export function AuthGate() {
  const { ready, user } = useAuth();

  if (!ready) return <SplashScreen />;
  if (!user) return <AuthScreen />;
  if (user.status === 'pending') return <PendingScreen />;
  if (user.status === 'blocked') return <PendingScreen blocked />;

  return (
    <AppStoreProvider key={user.id}>
      <App />
    </AppStoreProvider>
  );
}
