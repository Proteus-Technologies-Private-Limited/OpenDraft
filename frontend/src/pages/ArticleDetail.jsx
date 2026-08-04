import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { articleAPI, commentAPI } from '../services/api';

function ArticleDetail() {
  const { slug } = useParams();
  const [article, setArticle] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');

  useEffect(() => {
    const fetchArticle = async () => {
      try {
        setLoading(true);
        const res = await articleAPI.getBySlug(slug);
        setArticle(res.data.data);
        
        // Fetch comments
        if (res.data.data?.id) {
          const commentsRes = await commentAPI.getByArticle(res.data.data.id);
          setComments(commentsRes.data.data);
        }
      } catch (err) {
        console.error('Error fetching article:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchArticle();
  }, [slug]);

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    try {
      await commentAPI.create({
        articleId: article.id,
        text: commentText,
      });
      setCommentText('');
      // Refetch comments
      const res = await commentAPI.getByArticle(article.id);
      setComments(res.data.data);
    } catch (err) {
      console.error('Error posting comment:', err);
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading article...</div>;
  }

  if (!article) {
    return <div className="text-center py-12">Article not found</div>;
  }

  return (
    <article className="max-w-3xl mx-auto">
      {/* Article Header */}
      <div className="mb-8">
        <Link to="/" className="text-secondary hover:underline">← Back to Home</Link>
        <h1 className="text-4xl font-bold my-4">{article.title}</h1>
        <div className="flex gap-4 text-gray-600">
          <span>{article.author}</span>
          <span>•</span>
          <span>{new Date(article.createdAt).toLocaleDateString()}</span>
          <span>•</span>
          <span className="bg-secondary text-white px-3 py-1 rounded-full">
            {article.category}
          </span>
        </div>
      </div>

      {/* Featured Image */}
      <img
        src={article.image || '/placeholder.jpg'}
        alt={article.title}
        className="w-full h-96 object-cover rounded-lg mb-8"
      />

      {/* Article Content */}
      <div className="prose prose-lg max-w-none mb-12">
        <p className="text-lg text-gray-600 mb-6">{article.excerpt}</p>
        <div className="text-gray-800 leading-relaxed">
          {article.content || 'Full article content would appear here.'}
        </div>
      </div>

      {/* Comments Section */}
      <section className="border-t pt-8">
        <h2 className="text-2xl font-bold mb-6">Comments ({comments.length})</h2>

        {/* Comment Form */}
        <form onSubmit={handleCommentSubmit} className="card p-6 mb-8">
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Share your thoughts..."
            className="input-field mb-4 h-24"
            required
          />
          <button type="submit" className="btn btn-primary">
            Post Comment
          </button>
        </form>

        {/* Comments List */}
        <div className="space-y-4">
          {comments.length === 0 ? (
            <p className="text-gray-500">No comments yet. Be the first!</p>
          ) : (
            comments.map(comment => (
              <div key={comment.id} className="card p-4">
                <div className="flex justify-between mb-2">
                  <span className="font-bold">{comment.author}</span>
                  <span className="text-gray-500 text-sm">
                    {new Date(comment.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-gray-700">{comment.text}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </article>
  );
}

export default ArticleDetail;
