import { fetchPushKey, subscribePush, unsubscribePush } from '../api/pushApi';

/** Поддерживает ли браузер Web Push (не только Notification). */
export function pushSupported() {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof window !== 'undefined' &&
    'Notification' in window
  );
}

/** VAPID-ключ приходит в base64url — PushManager ждёт Uint8Array. */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

/**
 * Оформляет подписку на фоновые уведомления и сохраняет её на сервере.
 * Вызывается после того, как пользователь разрешил уведомления.
 */
export async function ensurePushSubscription(token) {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.pushManager) return { ok: false, reason: 'unsupported' };
    const { publicKey } = await fetchPushKey();
    if (!publicKey) return { ok: false, reason: 'no-key' };
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await subscribePush(token, subscription.toJSON(), -new Date().getTimezoneOffset());
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'error', error };
  }
}

/** Отменяет подписку и на сервере, и в браузере. */
export async function disablePushSubscription(token) {
  if (!pushSupported()) return { ok: true };
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return { ok: true };
    await unsubscribePush(token, subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
