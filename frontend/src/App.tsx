import { Routes, Route } from 'react-router-dom';
import ScreenplayEditor from './components/ScreenplayEditor';
import TreatmentEditor from './components/TreatmentEditor';
import ProjectList from './components/ProjectList';
import ProjectView from './components/ProjectView';
import SettingsPage from './components/SettingsPage';
import Toast from './components/Toast';
import DemoBanner from './components/DemoBanner';
import AuthGate from './components/AuthGate';
import AuthBootstrap from './components/AuthBootstrap';
import StorageFallbackDialog from './components/StorageFallbackDialog';
import SaveErrorDialog from './components/SaveErrorDialog';
import OneDriveWarningDialog from './components/OneDriveWarningDialog';
import VerifyEmailRoute from './components/VerifyEmailRoute';
import ResetPasswordRoute from './components/ResetPasswordRoute';
import { pluginRegistry } from './plugins/registry';
import './styles/screenplay.css';
import './styles/avScript.css';

function App() {
  const pluginRoutes = pluginRegistry.getRoutes();

  // Plugins (e.g. Pro) can swap built-in route components without
  // forking this file. Each lookup returns the registered override or
  // falls back to the core component.
  const ProjectViewC =
    pluginRegistry.getRouteOverride('/project/:projectId') ?? ProjectView;
  const ProjectListC =
    pluginRegistry.getRouteOverride('/projects') ?? ProjectList;
  const SettingsPageC =
    pluginRegistry.getRouteOverride('/settings') ?? SettingsPage;

  return (
    <>
      <DemoBanner />
      <Routes>
        <Route path="/" element={<ScreenplayEditor />} />
        <Route path="/verify" element={<VerifyEmailRoute />} />
        <Route path="/reset-password" element={<ResetPasswordRoute />} />
        <Route path="/projects" element={<ProjectListC />} />
        <Route path="/project/:projectId" element={<ProjectViewC />} />
        <Route path="/project/:projectId/edit/:scriptId" element={<ScreenplayEditor />} />
        <Route path="/project/:projectId/treatment/:scriptId" element={<TreatmentEditor />} />
        <Route path="/project/:projectId/history/:scriptId/:commitHash" element={<ScreenplayEditor />} />
        <Route path="/collab/:collabToken" element={<ScreenplayEditor />} />
        <Route path="/settings" element={<SettingsPageC />} />
        {pluginRoutes.map((r) => (
          <Route key={r.path} path={r.path} element={<r.component />} />
        ))}
      </Routes>
      <Toast />
      <AuthGate />
      <AuthBootstrap />
      <StorageFallbackDialog />
      <SaveErrorDialog />
      <OneDriveWarningDialog />
    </>
  );
}

export default App;
