import { useRef, useState } from 'react';
import { useTerminal } from '../hooks/useTerminal';

interface Props {
  sessionId: string;
  sessionName: string;
  sessionColor: string;
  onClose: () => void;
}

export function TerminalPanel({ sessionId, sessionName, sessionColor, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [promptInput, setPromptInput] = useState('');
  const { connected, sendApprove, sendReject, sendPrompt } = useTerminal({
    sessionId,
    containerRef,
  });

  const handleSend = () => {
    if (promptInput.trim()) {
      sendPrompt(promptInput);
      setPromptInput('');
    }
  };

  return (
    <div className="flex flex-col h-full border border-slate-700/50 rounded-lg overflow-hidden bg-slate-900">
      {/* Tab Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/80 border-b border-slate-700/50 shrink-0">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: sessionColor }}
        />
        <span className="text-sm font-medium text-slate-200 flex-1 truncate">
          {sessionName}
        </span>
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-emerald-400' : 'bg-red-400'}`}
          title={connected ? 'Connected' : 'Disconnected'}
        />
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-red-400 text-xs px-1 transition-colors"
          title="Close terminal"
        >
          X
        </button>
      </div>

      {/* Terminal */}
      <div ref={containerRef} className="flex-1 min-h-0 xterm-container" />

      {/* Quick Actions Bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/60 border-t border-slate-700/50 shrink-0">
        <button
          onClick={sendApprove}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-xs font-medium text-white transition-colors min-w-[44px] min-h-[36px]"
        >
          Y
        </button>
        <button
          onClick={sendReject}
          className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-xs font-medium text-white transition-colors min-w-[44px] min-h-[36px]"
        >
          N
        </button>
        <input
          value={promptInput}
          onChange={e => setPromptInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSend();
          }}
          placeholder="Send prompt..."
          className="flex-1 bg-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-blue-500 min-h-[36px]"
        />
        <button
          onClick={handleSend}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium text-white transition-colors min-w-[44px] min-h-[36px]"
        >
          Send
        </button>
      </div>
    </div>
  );
}
