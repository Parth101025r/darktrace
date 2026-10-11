import './ui.css';

const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const LABELS = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  running: 'Running',
  paused: 'Paused',
  stopped: 'Stopped',
  idle: 'Idle',
  online: 'Online',
  offline: 'Offline',
};

/**
 * Badge
 * Use ONE of: severity ('critical'|'high'|'medium'|'low')
 *             status   ('running'|'paused'|'stopped'|'idle'|'online'|'offline')
 * Optional: children (custom text), dot (default true), pulse (auto on running/critical)
 */
export default function Badge({ severity, status, children, dot = true, pulse, className = '' }) {
  const kind = severity || status || 'idle';
  const type = SEVERITIES.includes(kind) ? 'sev' : 'status';
  const shouldPulse = pulse ?? (kind === 'running' || kind === 'critical');
  const cls = ['dt-badge', `dt-badge--${type}-${kind}`, shouldPulse && 'is-pulsing', className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={cls}>
      {dot && <span className="dt-badge__dot" aria-hidden="true" />}
      {children ?? LABELS[kind] ?? kind}
    </span>
  );
}
