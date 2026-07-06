import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from "react";
import Editor, { Monaco } from "@monaco-editor/react";
import type { editor, Position, IRange } from "monaco-editor";
import { SQL_KEYWORDS, SQL_FUNCTIONS } from "./sqlKeywords";

// SQL 자동완성 provider는 앱 전체에 1회만 등록한다 — 에디터(탭)마다
// 등록하면 같은 제안이 열린 탭 수만큼 중복 노출된다. 테이블 목록은
// model별 Map으로 관리해 각 에디터가 자기 테이블만 제안받는다.
const modelTables = new Map<editor.ITextModel, string[]>();
let completionProviderRegistered = false;

function ensureCompletionProvider(monaco: Monaco) {
  if (completionProviderRegistered) return;
  completionProviderRegistered = true;

  monaco.languages.registerCompletionItemProvider("sql", {
    provideCompletionItems: (model: editor.ITextModel, position: Position) => {
      const word = model.getWordUntilPosition(position);
      const range: IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions = [
        // SQL Keywords
        ...SQL_KEYWORDS.map((keyword) => ({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword + " ",
          range,
          sortText: "1" + keyword, // Sort keywords first
        })),
        // SQL Functions
        ...SQL_FUNCTIONS.map((func) => ({
          label: func,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: func + " ",
          range,
          sortText: "2" + func, // Sort functions second
        })),
        // Table names for this editor's model
        ...(modelTables.get(model) ?? []).map((table) => ({
          label: table,
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: `\`${table}\` `,
          detail: "Table",
          range,
          sortText: "0" + table, // Sort tables at top
        })),
      ];

      return { suggestions };
    },
  });
}

export interface SelectionInfo {
  text: string;
  position: { top: number; left: number };
}

export interface ErrorInfo {
  lineNumber?: number;
  nearText?: string;
}

export interface QueryEditorHandle {
  goToLine: (line: number) => void;
}

interface QueryEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  onExecute?: (query: string) => void;
  onOpenHistory?: () => void;
  onToggleAI?: () => void;
  onSelectionChange?: (selection: SelectionInfo | null) => void;
  tables?: string[];
  errorInfo?: ErrorInfo | null;
}

/**
 * Find the SQL query at the given cursor offset.
 * Splits by semicolon and returns the query containing the cursor.
 */
function findQueryAtCursor(text: string, cursorOffset: number): string {
  // Split by semicolon but keep track of positions
  const queries: { start: number; end: number; text: string }[] = [];
  let currentStart = 0;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === ';') {
      queries.push({
        start: currentStart,
        end: i + 1,
        text: text.slice(currentStart, i + 1).trim(),
      });
      currentStart = i + 1;
    }
  }

  // Add remaining text (query without semicolon at end)
  if (currentStart < text.length) {
    const remaining = text.slice(currentStart).trim();
    if (remaining) {
      queries.push({
        start: currentStart,
        end: text.length,
        text: remaining,
      });
    }
  }

  // Find query containing cursor
  for (const q of queries) {
    if (cursorOffset >= q.start && cursorOffset <= q.end) {
      return q.text;
    }
  }

  // If cursor is at the very end or between queries, return closest
  if (queries.length > 0) {
    // Return last query if cursor is after everything
    return queries[queries.length - 1].text;
  }

  return text.trim();
}

export const QueryEditor = forwardRef<QueryEditorHandle, QueryEditorProps>(
  function QueryEditor({ value, onChange, onExecute, onOpenHistory, onToggleAI, onSelectionChange, tables = [], errorInfo }, ref) {
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  // 모델 참조를 별도 보관 — @monaco-editor/react가 자식 unmount에서
  // 에디터를 먼저 dispose하므로, 부모 cleanup 시점에 getModel()을
  // 다시 부르면 실패하거나 modelTables 엔트리가 누수된다
  const modelRef = useRef<editor.ITextModel | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tablesRef = useRef<string[]>(tables);
  const onSelectionChangeRef = useRef(onSelectionChange);

  // Theme state
  const [editorTheme, setEditorTheme] = useState<'vs-dark' | 'vs'>(() =>
    document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs'
  );

  // Observe theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setEditorTheme(document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Expose goToLine function via ref
  useImperativeHandle(ref, () => ({
    goToLine: (line: number) => {
      if (editorRef.current) {
        editorRef.current.revealLineInCenter(line);
        editorRef.current.setPosition({ lineNumber: line, column: 1 });
        editorRef.current.focus();
      }
    },
  }), []);

  // Handle error markers
  useEffect(() => {
    if (monacoRef.current && editorRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        if (errorInfo?.lineNumber) {
          // Validate lineNumber is within model bounds
          const totalLines = model.getLineCount();
          const validLineNumber = Math.min(Math.max(1, errorInfo.lineNumber), totalLines);

          // Only set marker if the line number was valid
          if (errorInfo.lineNumber >= 1 && errorInfo.lineNumber <= totalLines) {
            const markers: editor.IMarkerData[] = [{
              severity: monacoRef.current.MarkerSeverity.Error,
              message: errorInfo.nearText ? `Error near '${errorInfo.nearText}'` : 'SQL Error',
              startLineNumber: validLineNumber,
              startColumn: 1,
              endLineNumber: validLineNumber,
              endColumn: model.getLineMaxColumn(validLineNumber),
            }];
            monacoRef.current.editor.setModelMarkers(model, 'sql-error', markers);
          } else {
            // Line number out of bounds, clear markers
            monacoRef.current.editor.setModelMarkers(model, 'sql-error', []);
          }
        } else {
          // Clear error markers
          monacoRef.current.editor.setModelMarkers(model, 'sql-error', []);
        }
      }
    }
  }, [errorInfo]);

  // Keep the ref updated
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  // Update tablesRef when tables change
  useEffect(() => {
    tablesRef.current = tables;
    if (modelRef.current) {
      modelTables.set(modelRef.current, tables);
    }
  }, [tables]);

  const handleEditorMount = (editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    monacoRef.current = monaco;
    editorRef.current = editorInstance;

    // Clear error markers when content changes (prevents "Illegal value for lineNumber" errors)
    editorInstance.onDidChangeModelContent(() => {
      monaco.editor.setModelMarkers(editorInstance.getModel()!, 'sql-error', []);
    });

    // Add selection change listener
    editorInstance.onDidChangeCursorSelection(() => {
      const selection = editorInstance.getSelection();
      if (selection && !selection.isEmpty()) {
        const selectedText = editorInstance.getModel()?.getValueInRange(selection);
        if (selectedText && selectedText.trim().length > 0 && containerRef.current) {
          // Get the end position of the selection
          const endPosition = selection.getEndPosition();
          const coords = editorInstance.getScrolledVisiblePosition(endPosition);
          if (coords) {
            const containerRect = containerRef.current.getBoundingClientRect();
            const editorDomNode = editorInstance.getDomNode();
            const editorRect = editorDomNode?.getBoundingClientRect();
            if (editorRect) {
              onSelectionChangeRef.current?.({
                text: selectedText,
                position: {
                  top: coords.top + (editorRect.top - containerRect.top),
                  left: coords.left + (editorRect.left - containerRect.left),
                },
              });
            }
          }
        }
      } else {
        onSelectionChangeRef.current?.(null);
      }
    });

    // Helper to get query to execute (selected text or query at cursor)
    const getQueryToExecute = (): string => {
      const selection = editorInstance.getSelection();
      const model = editorInstance.getModel();

      if (selection && !selection.isEmpty() && model) {
        // Use selected text
        const selectedText = model.getValueInRange(selection);
        return selectedText.trim();
      }

      // Use query at cursor position
      if (model) {
        const position = editorInstance.getPosition();
        if (position) {
          const offset = model.getOffsetAt(position);
          const fullText = model.getValue();
          return findQueryAtCursor(fullText, offset);
        }
      }

      return model?.getValue().trim() || '';
    };

    // Add Ctrl+Enter / Cmd+Enter shortcut to execute query
    editorInstance.addAction({
      id: "execute-query",
      label: "Execute Query",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        const query = getQueryToExecute();
        if (query) {
          onExecute?.(query);
        }
      },
    });

    // Add Cmd+R / Ctrl+R shortcut to execute query
    editorInstance.addAction({
      id: "execute-query-r",
      label: "Execute Query (R)",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyR],
      run: () => {
        const query = getQueryToExecute();
        if (query) {
          onExecute?.(query);
        }
      },
    });

    // Add Cmd+H / Ctrl+H shortcut to open history
    editorInstance.addAction({
      id: "open-history",
      label: "Open History",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH],
      run: () => {
        onOpenHistory?.();
      },
    });

    // Add Cmd+K / Ctrl+K shortcut to toggle AI panel
    editorInstance.addAction({
      id: "toggle-ai-panel",
      label: "Toggle AI Panel",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: () => {
        onToggleAI?.();
      },
    });

    // SQL autocomplete: 전역 provider 1회 등록 + 이 에디터의 테이블 목록 연결
    ensureCompletionProvider(monaco);
    const model = editorInstance.getModel();
    if (model) {
      modelRef.current = model;
      modelTables.set(model, tablesRef.current);
    }
  };

  // Cleanup: 이 에디터의 테이블 매핑만 해제 (provider는 전역 공유라 유지)
  useEffect(() => {
    return () => {
      if (modelRef.current) {
        modelTables.delete(modelRef.current);
        modelRef.current = null;
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="h-full relative">
      <Editor
        height="100%"
        defaultLanguage="sql"
        theme={editorTheme}
        value={value}
        onChange={onChange}
        onMount={handleEditorMount}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: "on",
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          suggest: {
            showKeywords: true,
            showFunctions: true,
            showClasses: true,
          },
        }}
      />
    </div>
  );
});
