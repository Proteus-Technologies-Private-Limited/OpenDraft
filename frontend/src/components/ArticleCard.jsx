import { Link } from 'react-router-dom';

function ArticleCard({ article }) {
  return (
    <article className="article-card">
      <img
        src={article.image || '/placeholder.jpg'}
        alt={article.title}
        className="w-full h-48 object-cover rounded-lg mb-4"
      />
      <div className="flex gap-2 mb-3">
        <span className="inline-block bg-secondary text-white px-3 py-1 rounded-full text-sm">
          {article.category}
        </span>
      </div>
      <h3 className="text-2xl font-bold mb-2 hover:text-secondary transition">
        <Link to={`/article/${article.slug}`}>
          {article.title}
        </Link>
      </h3>
      <p className="text-gray-600 mb-4 line-clamp-2">
        {article.excerpt}
      </p>
      <div className="flex justify-between items-center text-sm text-gray-500">
        <span>{article.author}</span>
        <span>{new Date(article.createdAt).toLocaleDateString()}</span>
      </div>
    </article>
  );
}

export default ArticleCard;
