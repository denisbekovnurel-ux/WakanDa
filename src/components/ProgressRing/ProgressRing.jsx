import './ProgressRing.css';

export function ProgressRing({ percent, size = 100, ariaLabel = 'Прогресс' }) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - safePercent / 100);

  return (
    <div className="progress-ring" style={{ width: size, height: size }} role="progressbar" aria-label={ariaLabel} aria-valuemin="0" aria-valuemax="100" aria-valuenow={safePercent}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="progress-ring-track" cx="50" cy="50" r={radius} />
        <circle className="progress-ring-value" cx="50" cy="50" r={radius} strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <span className="progress-ring-label">{safePercent}%</span>
    </div>
  );
}
