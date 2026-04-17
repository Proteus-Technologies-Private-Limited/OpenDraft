import { Routes, Route } from 'react-router-dom';
import ScreenplayEditor from './components/ScreenplayEditor';
import TreatmentEditor from './components/TreatmentEditor';
import ProjectList from './components/ProjectList';
import ProjectView from './components/ProjectView';
import SettingsPage from './components/SettingsPage';
import Toast from './components/Toast';
import DemoBanner from './components/DemoBanner';
import { pluginRegistry } from './plugins/registry';
import './styles/screenplay.css';

function App() {
  const pluginRoutes = pluginRegistry.getRoutes();

  return (
    <>
      <DemoBanner />
      <Routes>
        <Route path="/" element={<ScreenplayEditor />} />
        <Route path="/projects" element={<ProjectList />} />
        <Route path="/project/:projectId" element={<ProjectView />} />
        <Route path="/project/:projectId/edit/:scriptId" element={<ScreenplayEditor />} />
        <Route path="/project/:projectId/treatment/:scriptId" element={<TreatmentEditor />} />
        <Route path="/project/:projectId/history/:scriptId/:commitHash" element={<ScreenplayEditor />} />
        <Route path="/collab/:collabToken" element={<ScreenplayEditor />} />
        <Route path="/settings" element={<SettingsPage />} />
        {pluginRoutes.map((r) => (
          <Route key={r.path} path={r.path} element={<r.component />} />
        ))}
      </Routes>
      <Toast />
    </>
  );
}

export default App;
