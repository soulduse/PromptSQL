import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from "react";
import Editor, { Monaco } from "@monaco-editor/react";
import type { editor, Position, IRange } from "monaco-editor";
import { SQL_KEYWORDS, SQL_FUNCTIONS } from "./sqlKeywords";

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const providerRef = useRef<{ dispose: () => void } | null>(null);
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

    // Register SQL autocomplete provider
    providerRef.current = monaco.languages.registerCompletionItemProvider("sql", {
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
          // Table names (use ref to always get latest tables)
          ...tablesRef.current.map((table) => ({
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
  };

  // Cleanup provider on unmount
  useEffect(() => {
    return () => {
      providerRef.current?.dispose();
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
