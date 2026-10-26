import { fetchPushKey, subscribePush, unsubscribePush } from '../api/pushApi';

const DEVICE_KEY = 'wakanda-push-device-id';
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** Поддерживает ли браузер Web Push (не только Notification). */
export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator
  );
}

/** Стабильный идентификатор этого браузера: нужен, чтобы не отдать чужую подписку. */
function getDeviceId() {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved && DEVICE_ID_RE.test(saved)) return saved;
  } catch {
    // приватный режим/запрет storage — ниже сгенерируем временный id
  }
  const id = crypto.randomUUID();
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch {
    // id проживёт до перезагрузки; подписка всё равно обновится на сервере
  }
  return id;
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
    // В dev service worker не регистрируется. Без этой проверки `ready`
    // висел бы вечно, а не возвращал «не поддерживается».
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (!registrations.length) return { ok: false, reason: 'unsupported' };
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
    await subscribePush(token, subscription.toJSON(), -new Date().getTimezoneOffset(), getDeviceId());
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'error', error };
  }
}

/** Отменяет подписку и на сервере, и в браузере. */
export async function disablePushSubscription(token) {
  if (!pushSupported()) return { ok: true };
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (!registrations.length) return { ok: true };
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
