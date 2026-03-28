import React from 'react';
import { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';

interface SceneNavigatorProps {
  editor: Editor | null;
  scrollContainer?: HTMLDivElement | null;
}

const SceneNavigator: React.FC<SceneNavigatorProps> = ({ editor, scrollContainer }) => {
  const { scenes, navigatorOpen } = useEditorStore();

  if (!navigatorOpen) return null;

  const goToScene = (sceneIndex: number) => {
    if (!editor) return;
    const { doc } = editor.state;
    let currentScene = -1;
    let targetPos = 0;

    doc.descendants((node, pos) => {
      if (node.type.name === 'sceneHeading') {
        currentScene++;
        if (currentScene === sceneIndex) {
          targetPos = pos;
          return false;
        }
      }
      return true;
    });

    editor.chain().focus().setTextSelection(targetPos + 1).run();

    requestAnimationFrame(() => {
      const coords = editor.view.coordsAtPos(targetPos + 1);
      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const scrollTo = scrollContainer.scrollTop + (coords.top - containerRect.top) - 60;
        scrollContainer.scrollTo({ top: scrollTo, behavior: 'smooth' });
      }
    });
  };

  return (
    <div className="scene-navigator">
      <div className="navigator-header">
        <span className="navigator-title">Navigator</span>
        <span className="scene-count">{scenes.length} scenes</span>
      </div>
      <div className="navigator-list">
        {scenes.length === 0 ? (
          <div className="navigator-empty">
            No scenes yet. Start writing a scene heading (INT. or EXT.)
          </div>
        ) : (
          scenes.map((scene, index) => (
            <div
              key={scene.id}
              className="navigator-scene"
              onClick={() => goToScene(index)}
            >
              <div
                className="scene-color-dot"
                style={{ backgroundColor: scene.color || '#4a9eff' }}
              />
              <div className="scene-info">
                <div className="scene-heading-text">
                  {scene.sceneNumber != null && (
                    <span className="scene-number">{scene.sceneNumber}. </span>
                  )}
                  {scene.heading}
                </div>
                {scene.synopsis && (
                  <div className="scene-synopsis">{scene.synopsis}</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default SceneNavigator;
