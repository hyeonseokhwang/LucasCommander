import { useRef, useState } from 'react';
import { useTerminal } from '../hooks/useTerminal';

interface Props {
  sessionId: string;
  sessionName: string;
  sessionColor: string;
  onClose: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onPopout?: () => void;
  isMaximized?: boolean;
}

export function TerminalPanel({
  sessionId, sessionName, sessionColor,
  onClose, onMinimize, onMaximize, onPopout, isMaximized,
}: Props) {
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
      {/* Title Bar — draggable handle */}
      <div
        className="window-drag-handle flex items-center gap-1.5 px-2 py-1 bg-slate-800/80 border-b border-slate-700/50 shrink-0 cursor-move select-none"
      >
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: sessionColor }}
        />
        <span className="text-xs font-medium text-slate-300 flex-1 truncate">
          {sessionName}
        </span>
        <div
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? 'bg-emerald-400' : 'bg-red-400'}`}
        />
        {onPopout && (
          <button
            onClick={onPopout}
            className="text-slate-500 hover:text-blue-400 text-[10px] px-1 transition-colors"
            title="Pop out to new window"
          >
            &#x29C9;
          </button>
        )}
        {onMinimize && (
          <button
            onClick={onMinimize}
            className="text-slate-500 hover:text-yellow-400 text-[10px] px-1 transition-colors"
            title="Minimize"
          >
            &#x2500;
          </button>
        )}
        {onMaximize && (
          <button
            onClick={onMaximize}
            className="text-slate-500 hover:text-emerald-400 text-[10px] px-1 transition-colors"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? '\u29C3' : '\u25A1'}
          </button>
        )}
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-red-400 text-[10px] px-1 transition-colors"
          title="Close"
        >
          &#x2715;
        </button>
      </div>

      {/* Terminal */}
      <div ref={containerRef} className="flex-1 min-h-0 xterm-container" />

      {/* Quick Actions */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-slate-800/60 border-t border-slate-700/50 shrink-0">
        <button
          onClick={sendApprove}
          className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-xs font-medium text-white transition-colors"
        >
          Y
        </button>
        <button
          onClick={sendReject}
          className="px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-xs font-medium text-white transition-colors"
        >
          N
        </button>
        <input
          value={promptInput}
          onChange={e => setPromptInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
          placeholder="Send prompt..."
          className="flex-1 bg-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={handleSend}
          className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium text-white transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
