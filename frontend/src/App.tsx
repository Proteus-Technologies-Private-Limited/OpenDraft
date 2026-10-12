import { Routes, Route, Navigate } from 'react-router-dom';
import ScreenplayEditor from './components/ScreenplayEditor';
import TreatmentEditor from './components/TreatmentEditor';
import SettingsPage from './components/SettingsPage';
import Toast from './components/Toast';
import StorageFallbackDialog from './components/StorageFallbackDialog';
import SaveErrorDialog from './components/SaveErrorDialog';
import OneDriveWarningDialog from './components/OneDriveWarningDialog';
import LinkedFileSync from './components/LinkedFileSync';
import { pluginRegistry } from './plugins/registry';
import './styles/screenplay.css';
import './styles/avScript.css';
import './styles/tableRead.css';

function App() {
  const pluginRoutes = pluginRegistry.getRoutes();

  // Plugins (e.g. Pro) can swap built-in route components without
  // forking this file. Each lookup returns the registered override or
  // falls back to the core component.
  const SettingsPageC =
    pluginRegistry.getRouteOverride('/settings') ?? SettingsPage;

  return (
    <>
      <Routes>
        <Route path="/" element={<ScreenplayEditor />} />
        {/* The project screens are gone; old links land in the editor. */}
        <Route path="/projects" element={<Navigate to="/" replace />} />
        <Route path="/project/:projectId" element={<Navigate to="/" replace />} />
        <Route path="/project/:projectId/edit/:scriptId" element={<ScreenplayEditor />} />
        <Route path="/project/:projectId/treatment/:scriptId" element={<TreatmentEditor />} />
        <Route path="/project/:projectId/history/:scriptId/:commitHash" element={<ScreenplayEditor />} />
        <Route path="/settings" element={<SettingsPageC />} />
        {pluginRoutes.map((r) => (
          <Route key={r.path} path={r.path} element={<r.component />} />
        ))}
      </Routes>
      <Toast />
      <StorageFallbackDialog />
      <SaveErrorDialog />
      <OneDriveWarningDialog />
      <LinkedFileSync />
    </>
  );
}

export default App;
