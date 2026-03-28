import React from 'react';

interface DiffViewerProps {
  diff: string;
}

const DiffViewer: React.FC<DiffViewerProps> = ({ diff }) => {
  if (!diff) {
    return <div className="diff-viewer-empty">No diff to display</div>;
  }

  const lines = diff.split('\n');

  return (
    <div className="diff-viewer">
      <pre className="diff-content">
        {lines.map((line, i) => {
          let className = 'diff-line';
          if (line.startsWith('+++') || line.startsWith('---')) {
            className += ' diff-file-header';
          } else if (line.startsWith('+')) {
            className += ' diff-added';
          } else if (line.startsWith('-')) {
            className += ' diff-removed';
          } else if (line.startsWith('@@')) {
            className += ' diff-hunk-header';
          } else if (line.startsWith('diff ')) {
            className += ' diff-file-header';
          }
          return (
            <div key={i} className={className}>
              {line}
            </div>
          );
        })}
      </pre>
    </div>
  );
};

export default DiffViewer;
