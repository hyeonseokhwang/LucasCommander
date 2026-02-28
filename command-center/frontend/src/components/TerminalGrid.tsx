import { TerminalPanel } from './TerminalPanel';
import type { ActiveSession } from '../types';

interface Props {
  sessions: ActiveSession[];
  onClose: (id: string) => void;
}

export function TerminalGrid({ sessions, onClose }: Props) {
  const count = sessions.length;

  const gridClass =
    count === 0
      ? ''
      : count === 1
        ? 'grid-cols-1 grid-rows-1'
        : count === 2
          ? 'grid-cols-2 grid-rows-1'
          : count === 3
            ? 'grid-cols-2 grid-rows-2'
            : 'grid-cols-2 grid-rows-2';

  if (count === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        <div className="text-center">
          <div className="text-4xl mb-4">{'>'}_</div>
          <p className="text-lg">No active terminals</p>
          <p className="text-sm mt-1">Spawn a session from the sidebar</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex-1 grid ${gridClass} gap-2 p-2 min-h-0`}>
      {sessions.map(session => (
        <TerminalPanel
          key={session.id}
          sessionId={session.id}
          sessionName={session.name}
          sessionColor={session.color}
          onClose={() => onClose(session.id)}
        />
      ))}
    </div>
  );
}
