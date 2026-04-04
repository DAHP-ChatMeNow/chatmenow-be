const postService = require("../service/post.service");

exports.getNewsFeed = async (req, res) => {
  try {
    const result = await postService.getNewsFeed(req.user.userId, req.query);

    res.status(200).json({
      success: true,
      posts: result.posts,
      total: result.total,
      page: result.page,
      limit: result.limit,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.createPost = async (req, res) => {
  try {
    const userId = req.user.userId;
    const files = req.files || [];
    const populatedPost = await postService.createPost(userId, req.body, files);

    res.status(201).json(populatedPost);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getMyPosts = async (req, res) => {
  try {
    const result = await postService.getMyPosts(req.user.userId, req.query);

    res.status(200).json({
      success: true,
      posts: result.posts,
      total: result.total,
      page: result.page,
      limit: result.limit,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getPostDetail = async (req, res) => {
  try {
    const post = await postService.getPostDetail(req.params.id);
    res.status(200).json(post);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.toggleLikePost = async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.userId;

    const result = await postService.toggleLikePost(userId, postId);

    res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.unlikePost = async (req, res) => {
  try {
    const result = await postService.unlikePost(req.user.userId, req.params.id);
    res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const result = await postService.getComments(postId);

    res.status(200).json({
      success: true,
      comments: result.comments,
      total: result.total,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.addComment = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.params;
    const { content } = req.body;

    const newComment = await postService.addComment(userId, postId, content);

    res.status(201).json(newComment);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};
