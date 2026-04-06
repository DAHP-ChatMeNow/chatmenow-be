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

exports.getAllPostsForAdmin = async (req, res) => {
  try {
    const result = await postService.getAllPostsForAdmin(req.query || {});

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

exports.getPostStatsForAdmin = async (req, res) => {
  try {
    const stats = await postService.getPostStatsForAdmin(req.query || {});

    res.status(200).json({
      success: true,
      stats,
      ...stats,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getPostDetailForAdmin = async (req, res) => {
  try {
    const post = await postService.getPostDetailForAdmin(req.params.id);

    res.status(200).json({
      success: true,
      post,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getPostLikesForAdmin = async (req, res) => {
  try {
    const result = await postService.getPostLikesForAdmin(
      req.params.id,
      req.query || {},
    );

    res.status(200).json({
      success: true,
      users: result.users,
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

exports.getPostCommentsForAdmin = async (req, res) => {
  try {
    const result = await postService.getPostCommentsForAdmin(
      req.params.id,
      req.query || {},
    );

    res.status(200).json({
      success: true,
      comments: result.comments,
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

exports.updatePostPrivacyForAdmin = async (req, res) => {
  try {
    const { privacy } = req.body || {};
    const post = await postService.updatePostPrivacyForAdmin(
      req.params.id,
      privacy,
    );

    res.status(200).json({
      success: true,
      message: "Đã cập nhật quyền riêng tư bài viết",
      post,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.deletePostForAdmin = async (req, res) => {
  try {
    const result = await postService.deletePostForAdmin(req.params.id);

    res.status(200).json({
      success: true,
      message: "Đã xóa bài viết",
      ...result,
    });
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
      aiSuggestion: result.aiSuggestion || null,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.askAiAboutPost = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.params;
    const { content, conversationId } = req.body || {};

    const result = await postService.askAiAboutPost(
      userId,
      postId,
      content,
      conversationId,
    );

    res.status(201).json({
      success: true,
      conversation: result.conversation,
      userMessage: result.userMessage,
      aiMessage: result.aiMessage,
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
    const { content, replyToCommentId } = req.body;

    const newComment = await postService.addComment(
      userId,
      postId,
      content,
      replyToCommentId,
    );

    res.status(201).json(newComment);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};
