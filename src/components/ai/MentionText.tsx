import React from "react";

interface MentionTextProps {
  text: string;
  onMentionClick?: (tableName: string) => void;
}

export default function MentionText({ text, onMentionClick }: MentionTextProps) {
  const parts: React.ReactNode[] = [];
  const regex = /@(\w+)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before mention
    if (match.index > lastIndex) {
      parts.push(
        <span key={`text-${lastIndex}`}>
          {text.slice(lastIndex, match.index)}
        </span>
      );
    }

    // Add highlighted mention (clickable)
    const mentionName = match[1];
    const isAll = mentionName.toLowerCase() === "all";
    parts.push(
      <span
        key={`mention-${match.index}`}
        onClick={(e) => {
          if (!isAll && onMentionClick) {
            e.stopPropagation();
            onMentionClick(mentionName);
          }
        }}
        className={`rounded px-1 mx-0.5 ${
          isAll
            ? "bg-amber-500/30 text-amber-400"
            : "bg-blue-500/30 text-blue-400 cursor-pointer hover:bg-blue-500/50 transition-colors"
        }`}
      >
        @{mentionName}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(
      <span key={`text-${lastIndex}`}>
        {text.slice(lastIndex)}
      </span>
    );
  }

  if (parts.length === 0) {
    return <>{text}</>;
  }

  return <>{parts}</>;
}
