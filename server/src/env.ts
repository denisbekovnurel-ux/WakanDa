import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Загружаем server/.env до импорта логгера и модулей приложения: они читают
// настройки из process.env при инициализации. Существующие переменные окружения
// имеют приоритет — process.loadEnvFile не перезаписывает их.
const envFile = join(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
