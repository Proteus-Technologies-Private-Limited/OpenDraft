import { Routes, Route } from 'react-router-dom';
import ScreenplayEditor from './components/ScreenplayEditor';
import ProjectList from './components/ProjectList';
import ProjectView from './components/ProjectView';
import Toast from './components/Toast';
import './styles/screenplay.css';

function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<ScreenplayEditor />} />
        <Route path="/projects" element={<ProjectList />} />
        <Route path="/project/:projectId" element={<ProjectView />} />
        <Route path="/project/:projectId/edit/:scriptId" element={<ScreenplayEditor />} />
        <Route path="/project/:projectId/history/:scriptId/:commitHash" element={<ScreenplayEditor />} />
        <Route path="/collab/:collabToken" element={<ScreenplayEditor />} />
      </Routes>
      <Toast />
    </>
  );
}

export default App;
