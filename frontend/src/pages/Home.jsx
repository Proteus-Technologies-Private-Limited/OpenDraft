import { useState, useEffect } from 'react';
import ArticleCard from '../components/ArticleCard';
import { articleAPI } from '../services/api';

function Home() {
  const [articles, setArticles] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [articlesRes, featuredRes] = await Promise.all([
          articleAPI.getAll(page, 10),
          articleAPI.getFeatured(),
        ]);
        setArticles(articlesRes.data.data);
        setFeatured(featuredRes.data.data);
      } catch (err) {
        console.error('Error fetching articles:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [page]);

  if (loading) {
    return <div className="text-center py-12">Loading articles...</div>;
  }

  return (
    <div>
      {/* Featured Section */}
      {featured.length > 0 && (
        <section className="mb-12">
          <h2 className="text-3xl font-bold mb-6">Featured Stories</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {featured.slice(0, 2).map(article => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        </section>
      )}

      {/* Latest Articles */}
      <section>
        <h2 className="text-3xl font-bold mb-6">Latest News</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {articles.map(article => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>

        {/* Pagination */}
        <div className="flex justify-center gap-4 mt-12">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn btn-primary disabled:opacity-50"
          >
            Previous
          </button>
          <span className="py-2">Page {page}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            className="btn btn-primary"
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}

export default Home;
