import { Link } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';

function Layout({ children }) {
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 container my-8">
        {children}
      </main>
      <Footer />
    </div>
  );
}

export default Layout;
